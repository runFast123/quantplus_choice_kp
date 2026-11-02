"""ROUND 2 PLAN (researcher "health") -- pre-registered here, written before anything in this file was run.

Why: round-1 V8 learned from "the last 30 CLOSED trades", which for the 60-session trend rules are mostly stop-outs
(metalabel's closed-trades bias). Round 2 rebuilds the card on COMPLETE COHORTS only.

Complete cohort (all variants): on decision day d a trade of rule r is in the card only if
    signal_date < d - EMBARGO - SPAN[r],   EMBARGO = 7 calendar days (5 sessions), SPAN = the rule's maximum holding span
    SPAN: full result -> 100 days (trend, 60 sessions) / 21 days (dips, 10 sessions) [same as metalabel Amendment A];
          20-session grade (R2/R3 trend rules only) -> 35 days.
    The code asserts that every trade in the card had its grade known before d (grade date < d).
Card (fixed, from round 1): per rule x bucket, the 30 most recent cohort trades (by signal_date); fewer than 30 -> the
rule's 50 most recent cohort trades; fewer than 20 -> no judgement (Healthy). mean < 0 and t < -1 -> Weak;
mean < 0 -> On watch; else Healthy.  Tunables: 3 (bucket window 30, Weak at t < -1, fallback 50).

Variants (3, no more):
  R1  C1 as specified: buckets = house weather (wx on the signal day), card graded with each trade's full result.
  R2  R1, but the trend rules are graded at 20 sessions (the stop-out result if stopped by session 20, else the
      session-20 close vs entry open, after the 0.5 % cost; = signal_outcomes.r20 capped by the stop), so their cohort
      completes after 35 days instead of 100. Dips unchanged.
  R3  R2 with regime's market state as the bucket (Nifty vs its 200-day average x India VIX vs its 1-year median;
      regime/regimes.py label "R1", read-only import) instead of house weather.

Tests (fixed now; all 2021-26 and 2024-26; matched null = shuffle within rule x signal-year cells, 1,000 draws):
  Display (C1 bar a): labels on every signal, nothing hidden. gap = made% of the best minus the worst status group
    (groups with >= 30 trades). Pass: gap >= 5 points in both periods and p < 0.05 in both. Also shown: Healthy minus
    flagged (On watch + Weak), per rule.
  Risk layer (bar b): nothing hidden; flagged (On watch or Weak) signals get size 0.5. Pass: worst quarter (sum% by signal
    quarter) and max drawdown (cumulative sum% in exit order) both better than static AND better than the matched null
    (p < 0.05), 2021-26.
  Filter (common bar 1-2): Healthy 1, On watch 0.5, Weak skipped. Pass: every rule's made% higher in both periods, sum%
    >= 90 % of static in both, and ALL made% beats the matched null of random skips at p < 0.05.
Decision rule: C1 is "display" only if R1 passes Display or Risk. R2/R3 are alternatives; a pass by R2/R3 alone is
reported with a 3-tests caveat. evaluate.py scores every filter/risk version.

    cd research/strategies/team/health && python round2.py
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

import health as H
from health import E, RULES, T

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "regime"))
import regimes as G  # noqa: E402  (read-only: regime's state definition)

pd.set_option("display.width", 200)
EMB = 7
SPAN_FULL = {"strong_trend": 100, "sma_trend": 100, "rsi_dip": 21, "kk_dip": 21}
SPAN_20 = {"strong_trend": 35, "sma_trend": 35, "rsi_dip": 21, "kk_dip": 21}
TREND = ("strong_trend", "sma_trend")
NB, FALLBACK, TW = 30, 50, -1.0
DRAWS = 1000
LAB = {0: "Healthy", 1: "On watch", 2: "Weak"}


# ---------------------------------------------------------------- grades
def grades(fast):
    """Per trade: the grade the card learns from and the date that grade became known."""
    g = T[["tid", "rule", "symbol", "signal_date", "entry_date", "exit_date", "net", "days"]].copy()
    g["grade"], g["known"] = g.net, g.exit_date
    if fast:
        px = H._close_lookup()
        for i in np.flatnonzero(g.rule.isin(TREND).to_numpy() & (g.days > 20).to_numpy()):
            r = g.iloc[i]
            ds, o, c = px[r.symbol]
            j = np.searchsorted(ds, np.datetime64(r.entry_date))
            g.iat[i, g.columns.get_loc("grade")] = c[j + 19] / o[j] - 1 - H.COST
            g.iat[i, g.columns.get_loc("known")] = pd.Timestamp(ds[j + 19])
    return g


def buckets(kind):
    if kind == "wx":
        return T.wx.to_numpy()
    m = G.market()
    lab = G.label(m, "R1")
    return T.signal_date.map(lab).fillna("na").to_numpy()


def card(fast, kind):
    """Status of every trade from complete cohorts of its rule (x its bucket) only."""
    g = grades(fast)
    b = buckets(kind)
    span = SPAN_20 if fast else SPAN_FULL
    status = np.zeros(len(T), int)
    for r in RULES:
        idx = np.flatnonzero(T.rule.to_numpy() == r)
        o = idx[np.argsort(T.signal_date.to_numpy()[idx], kind="stable")]
        sd, gr, kn, bb = T.signal_date.to_numpy()[o], g.grade.to_numpy()[o], g.known.to_numpy()[o], b[o]
        for i in idx:
            d = T.signal_date.to_numpy()[i]
            k = np.searchsorted(sd, d - np.timedelta64(EMB + span[r], "D"), side="left")  # cohort: signal < cutoff
            assert (kn[:k] < d).all(), "a cohort trade's grade was not yet known"
            w = gr[:k][bb[:k] == b[i]][-NB:]
            if len(w) < NB:
                w = gr[:k][-FALLBACK:]
                if len(w) < H.MIN_N:
                    continue
            m, se = w.mean(), w.std(ddof=1) / np.sqrt(len(w))
            status[i] = 2 if (m < 0 and m / se < TW) else (1 if m < 0 else 0)
    return T.assign(status=status)


# ---------------------------------------------------------------- tests (numpy, for the 1,000-draw nulls)
def prep(d, lo):
    d = d[(d.signal_date >= lo) & (d.signal_date < E.END)].reset_index(drop=True)
    cells = [g.index.to_numpy() for _, g in d.groupby([d.rule, d.signal_date.dt.year])]
    q = d.signal_date.dt.to_period("Q").astype(str).factorize()[0]
    order = np.argsort(d.exit_date.to_numpy(), kind="stable")
    return d, cells, q, order


def shuffle(a, cells, rng):
    b = a.copy()
    for ix in cells:
        b[ix] = a[rng.permutation(ix)]
    return b


def gap(st, win):
    made = [100 * win[st == s].mean() for s in (0, 1, 2) if (st == s).sum() >= 30]
    return max(made) - min(made) if len(made) >= 2 else np.nan


def risk(size, net, q, order):
    x = net * size
    wq = 100 * np.bincount(q, weights=x).min()
    c = np.cumsum(x[order])
    return wq, 100 * (c - np.maximum.accumulate(c)).min()


def display_test(d0, name):
    rows = []
    for per, lo in (("2021-26", E.START), ("2024-26", E.RECENT)):
        d, cells, q, order = prep(d0, lo)
        st, win = d.status.to_numpy(), (d.net > 0).to_numpy()
        real = gap(st, win)
        rng = np.random.default_rng(1)
        sims = np.array([gap(shuffle(st, cells, rng), win) for _ in range(DRAWS)])
        made = {LAB[s]: f"{100 * win[st == s].mean():.1f} ({(st == s).sum()})" for s in (0, 1, 2) if (st == s).any()}
        hf = {r: round(100 * (win[(st == 0) & (d.rule == r)].mean() - win[(st > 0) & (d.rule == r)].mean()), 1)
              for r in RULES}
        rows.append({"variant": name, "period": per, **made, "gap": round(real, 1),
                     "null mean": round(np.nanmean(sims), 1), "p": round((sims >= real).mean(), 3),
                     "Healthy-flagged by rule": hf})
    return rows


def risk_test(d0, name):
    d, cells, q, order = prep(d0, E.START)
    size, net = np.where(d.status.to_numpy() > 0, 0.5, 1.0), d.net.to_numpy()
    real, base = risk(size, net, q, order), risk(np.ones(len(d)), net, q, order)
    rng = np.random.default_rng(2)
    sims = np.array([risk(shuffle(size, cells, rng), net, q, order) for _ in range(DRAWS)])
    return {"variant": name, "worst Q": round(real[0]), "static": round(base[0]), "null": round(sims[:, 0].mean()),
            "p(null>=)": round((sims[:, 0] >= real[0]).mean(), 3), "max DD": round(real[1]), "static DD": round(base[1]),
            "null DD": round(sims[:, 1].mean()), "p DD": round((sims[:, 1] >= real[1]).mean(), 3)}


def filter_null(d0, name):
    out = {"variant": name}
    for per, lo in (("21", E.START), ("24", E.RECENT)):
        d, cells, q, order = prep(d0, lo)
        take, win = d["take"].to_numpy(), (d.net > 0).to_numpy()
        real = 100 * win[take].mean()
        rng = np.random.default_rng(3)
        sims = np.array([100 * win[shuffle(take, cells, rng)].mean() for _ in range(DRAWS)])
        out |= {f"made{per}": round(real, 1), f"null{per}": round(sims.mean(), 1), f"p{per}": round((sims >= real).mean(), 3)}
    return out


def as_filter(d):
    d = d.copy()
    d["size"] = d.status.map({0: 1.0, 1: 0.5, 2: 0.0})
    d["take"] = d.status < 2
    return d


def as_risk(d):
    d = d.copy()
    d["size"] = np.where(d.status > 0, 0.5, 1.0)
    d["take"] = True
    return d


if __name__ == "__main__":
    E.report(E.baseline(), "static")
    V = {"R1 complete cohorts, weather": (False, "wx"),
         "R2 + trend graded at 20 sessions": (True, "wx"),
         "R3 R2 x regime trend-fear state": (True, "state")}
    disp, rk, fl = [], [], []
    for name, (fast, kind) in V.items():
        d = card(fast, kind)
        d[["tid", "rule", "signal_date", "status"]].to_csv(Path(__file__).with_name(f"round2_{name[:2]}.csv"), index=False)
        E.report(as_filter(d), f"{name} -- FILTER (Healthy 1 / On watch 0.5 / Weak skipped)")
        E.report(as_risk(d), f"{name} -- RISK LAYER (flagged = half size, nothing hidden)")
        disp += display_test(d, name)
        rk.append(risk_test(as_risk(d), name))
        fl.append(filter_null(as_filter(d), name))
    print("\n=== DISPLAY test: made% (trades) per label; gap = best - worst group; matched rule x year null")
    print(pd.DataFrame(disp).to_string(index=False))
    print("\n=== RISK LAYER test (2021-26): worst quarter / max drawdown vs static and matched null (p = share of null as good)")
    print(pd.DataFrame(rk).to_string(index=False))
    print("\n=== FILTER test: ALL made% vs random skips matched by rule x year")
    print(pd.DataFrame(fl).to_string(index=False))
