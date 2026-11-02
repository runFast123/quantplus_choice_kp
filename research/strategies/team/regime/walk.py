"""Walk-forward regime switch (PLAN.md). Each quarter, per rule and regime, learn from trades CLOSED before the quarter
starts; hide the rule in regimes where its shrunk record fails the decision rule; apply to that quarter's signals.

    import walk as W
    dec, log = W.run(trades, "R1", rule="D1", m=50, min_n=20)   # dec: trades + take; log: one row per quarter/rule/regime
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import evaluate as E   # noqa: E402
import regimes as G    # noqa: E402

RULES = E.RULES
QUARTERS = pd.date_range("2021-01-01", "2026-10-01", freq="QS")
PSEUDO = pd.date_range("2020-01-01", "2020-10-01", freq="QS")      # for the nested choice (V10) only


def labels_for(m, d, q0, cache, **kw):
    if d == "R5":
        if q0 not in cache:
            cache[q0] = G.kmeans_label(m, q0)
        return cache[q0]
    key = (d, tuple(sorted(kw.items())))
    if key not in cache:
        cache[key] = G.label(m, d, **kw)
    return cache[key]


def cell_table(closed, m_prior, min_n, unit="trades"):
    """unit="trades": evidence = number of closed trades (pre-registered). unit="months" (V11, added after the first
    results): evidence = number of distinct signal months, because trades cluster in time - 100 trades from one crash
    month are one episode, not 100 independent observations. m_prior and min_n are then in months."""
    mu, p = closed.net.mean(), (closed.net > 0).mean()
    g = closed.groupby("reg")
    tab = pd.DataFrame({"n": g.net.size(), "mean": g.net.mean(), "rate": g.net.apply(lambda x: (x > 0).mean()),
                        "months": g.signal_date.apply(lambda x: x.dt.to_period("M").nunique())})
    w = tab.months if unit == "months" else tab.n
    tab["s"] = (w * tab["mean"] + m_prior * mu) / (w + m_prior)
    tab["p"] = (w * tab.rate + m_prior * p) / (w + m_prior)
    tab["mu"], tab["p_r"], tab["eligible"] = mu, p, w >= min_n
    if unit == "two_strikes":            # V13: losing years (>= 10 trades, mean < 0) in that cell must be >= 2
        y = closed.assign(y=closed.signal_date.dt.year).groupby(["reg", "y"]).net.agg(["size", "mean"])
        bad = y[(y["size"] >= 10) & (y["mean"] < 0)].reset_index().groupby("reg").size()
        tab["bad_years"] = bad.reindex(tab.index).fillna(0).astype(int)
        tab["eligible"] &= tab.bad_years >= 2
    return tab


def decide(tab, rule):
    if rule == "D1":
        off = tab.s < 0
    elif rule == "D2":
        off = tab.s < 0.5 * tab.mu
    elif rule == "D3":
        off = tab.p < 0.50
    else:
        raise ValueError(rule)
    return off & tab.eligible


def run(t, d, rule="D1", m_prior=50, min_n=20, quarters=QUARTERS, mkt=None, cache=None, label_kw=None, unit="trades"):
    """t: trades frame (all dates, incl. pre-2021 history). Returns decisions for signals inside `quarters`."""
    mkt = G.market() if mkt is None else mkt
    cache = {} if cache is None else cache
    label_kw = label_kw or {}
    out, log = [], []
    for q0 in quarters:
        q1 = q0 + pd.offsets.QuarterBegin(startingMonth=1)
        lab = labels_for(mkt, d, q0, cache, **label_kw)
        tt = t.assign(reg=lab.reindex(t.signal_date).to_numpy())
        now = tt[(tt.signal_date >= q0) & (tt.signal_date < q1)].copy()
        now["take"] = True
        for r in RULES:
            closed = tt[(tt.rule == r) & (tt.exit_date < q0)]
            if not len(closed):
                continue
            tab = cell_table(closed, m_prior, min_n, unit)
            off = decide(tab, rule)
            for k, row in tab.iterrows():
                log.append({"q": q0, "rule": r, "reg": k, "n": int(row.n), "months": int(row.months), "mean": row["mean"], "s": row.s,
                            "p": row.p, "off": bool(off.get(k, False))})
            off_regs = set(off[off].index)
            now.loc[(now.rule == r) & now.reg.isin(off_regs), "take"] = False
        out.append(now)
    return pd.concat(out), pd.DataFrame(log)


def nested(t, m_prior=50, min_n=20, mkt=None, cache=None, defs=G.ALL_DEFS, fallback="R1"):
    """V10: per rule and quarter, pick the definition whose pseudo-out-of-sample record (2020Q1 .. Q-1, judged on
    trades closed before Q) had the best made% gain while keeping >= 90 % of that record's sum."""
    mkt = G.market() if mkt is None else mkt
    cache = {} if cache is None else cache
    allq = PSEUDO.append(QUARTERS)
    runs = {d: run(t, d, "D1", m_prior, min_n, allq, mkt, cache)[0] for d in defs}
    out, picks = [], []
    for q0 in QUARTERS:
        q1 = q0 + pd.offsets.QuarterBegin(startingMonth=1)
        for r in RULES:
            best, best_gain = fallback, 0.0
            for d in defs:
                h = runs[d]
                h = h[(h.rule == r) & (h.signal_date < q0) & (h.exit_date < q0)]
                if len(h) < 30 or (~h["take"]).sum() == 0:
                    continue
                k = h[h["take"]]
                if not len(k) or k.net.sum() < 0.9 * h.net.sum():
                    continue
                gain = (k.net > 0).mean() - (h.net > 0).mean()
                if gain > best_gain + 1e-12:
                    best, best_gain = d, gain
            picks.append({"q": q0, "rule": r, "pick": best, "gain": round(100 * best_gain, 2)})
            h = runs[best]
            out.append(h[(h.rule == r) & (h.signal_date >= q0) & (h.signal_date < q1)])
    return pd.concat(out), pd.DataFrame(picks)
