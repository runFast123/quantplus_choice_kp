"""Runs the 10 pre-registered variants (PLAN.md) and scores each with team/evaluate.py.
Writes regime/results.csv (one row per variant x period x rule) and regime/switch_log.csv. Run from this folder."""
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import evaluate as E   # noqa: E402
import regimes as G    # noqa: E402
import walk as W       # noqa: E402

pd.set_option("display.width", 200)


def p1(plans, mkt, cache, d="R1", m_prior=50, min_n=20):
    """V9: per quarter, rule, regime: alt plan if its shrunk mean beats the default's, then D1 on the chosen plan."""
    out = []
    for q0 in W.QUARTERS:
        q1 = q0 + pd.offsets.QuarterBegin(startingMonth=1)
        lab = W.labels_for(mkt, d, q0, cache)
        pp = plans.assign(reg=lab.reindex(plans.signal_date).to_numpy())
        now = pp[(pp.signal_date >= q0) & (pp.signal_date < q1)].copy()
        now["take"] = False
        for r in W.RULES:
            cl = pp[(pp.rule == r) & (pp.exit_date < q0)]
            dflt, alt = cl[cl.plan == "default"], cl[cl.plan == "alt"]
            mu = dflt.net.mean()
            def shr(x):
                g = x.groupby("reg").net
                return pd.DataFrame({"n": g.size(), "s": (g.sum() + m_prior * mu) / (g.size() + m_prior)})
            sd, sa = shr(dflt), shr(alt)
            for k in set(now[now.rule == r].reg):
                n_d = sd.n.get(k, 0)
                n_a = sa.n.get(k, 0)
                s_d = sd.s.get(k, mu)
                s_a = sa.s.get(k, mu)
                use_alt = n_d >= min_n and n_a >= min_n and s_a > s_d
                s_c, n_c = (s_a, n_a) if use_alt else (s_d, n_d)
                if n_c >= min_n and s_c < 0:
                    continue
                plan = "alt" if use_alt else "default"
                now.loc[(now.rule == r) & (now.reg == k) & (now.plan == plan), "take"] = True
        out.append(now)
    return pd.concat(out)


BASE = None


def storm_switch(t, storm):
    """V12: per rule and quarter, storm-exit plan if, on the same signals closed before the quarter under both plans,
    its mean beat the default plan's. Dip rules and every trend signal unchanged otherwise."""
    out, picks = [t[t.rule.isin(["rsi_dip", "kk_dip"]) & (t.signal_date >= W.QUARTERS[0])].assign(take=True)], []
    for q0 in W.QUARTERS:
        q1 = q0 + pd.offsets.QuarterBegin(startingMonth=1)
        for r in ("strong_trend", "sma_trend"):
            a = t[(t.rule == r) & (t.exit_date < q0)]
            b = storm[(storm.rule == r) & (storm.exit_date < q0)]
            pair = a.merge(b, on=["symbol", "signal_date"], suffixes=("", "_s"))
            use = len(pair) >= 20 and pair.net_s.mean() > pair.net.mean()
            picks.append({"q": q0, "rule": r, "storm": use, "pairs": len(pair),
                          "diff": round(100 * (pair.net_s.mean() - pair.net.mean()), 2) if len(pair) else None})
            src = storm if use else t
            out.append(src[(src.rule == r) & (src.signal_date >= q0) & (src.signal_date < q1)].assign(take=True))
    return pd.concat(out), pd.DataFrame(picks)


def summary(rep, name):
    global BASE
    if BASE is None:
        BASE = E.report(E.baseline(), show=False).set_index(["period", "rule"])
    a = rep.set_index(["period", "rule"])
    return {"variant": name,
            **{f"{p} {c}": a.loc[(p, "ALL"), c] for p in ("2021-26", "2024-26") for c in ("kept", "made%", "avg%", "sum%")},
            "gain made 21-26": a.loc[("2021-26", "ALL"), "vs static made%"],
            "sum kept 21-26": round(a.loc[("2021-26", "ALL"), "sum%"] / BASE.loc[("2021-26", "ALL"), "sum%"], 3),
            "sum kept 24-26": round(a.loc[("2024-26", "ALL"), "sum%"] / BASE.loc[("2024-26", "ALL"), "sum%"], 3)}


if __name__ == "__main__":
    t = E.load()
    mkt = G.market()
    cache = {}
    reps, sums, logs = [], [], []
    base = E.report(E.baseline(), "static rules (today)")
    reps.append(base.assign(variant="static"))
    variants = [(f"V{i + 1} {d} {G.NAMES[d]} + D1", d, "D1") for i, d in enumerate(G.ALL_DEFS)]
    variants += [("V7 R1 + D2 half-edge", "R1", "D2"), ("V8 R1 + D3 coin-flip", "R1", "D3")]
    for name, d, rule in variants:
        dec, log = W.run(t, d, rule, mkt=mkt, cache=cache)
        rep = E.report(dec, name)
        reps.append(rep.assign(variant=name))
        sums.append(summary(rep, name))
        logs.append(log.assign(variant=name))
    plans = pd.read_parquet(HERE / "plan_trades.parquet")
    plans = pd.concat([t.assign(plan="default")[list(plans.columns.drop("plan")) + ["plan"]],
                       plans[plans.plan == "alt"]], ignore_index=True)
    dec = p1(plans, mkt, cache)
    name = "V9 R1 + D1 + P1 plan switch"
    rep = E.report(dec, name)
    reps.append(rep.assign(variant=name))
    sums.append(summary(rep, name))
    dec, picks = W.nested(t, mkt=mkt, cache=cache)
    name = "V10 nested choice of definition + D1"
    rep = E.report(dec, name)
    reps.append(rep.assign(variant=name))
    sums.append(summary(rep, name))
    print(picks.pivot(index="q", columns="rule", values="pick").to_string())
    # ---- post-hoc variants (PLAN.md addendum)
    name = "V11 R1 + D1, evidence in months (post-hoc)"
    dec, log = W.run(t, "R1", "D1", m_prior=6, min_n=6, mkt=mkt, cache=cache, unit="months")
    rep = E.report(dec, name)
    reps.append(rep.assign(variant=name))
    sums.append(summary(rep, name))
    logs.append(log.assign(variant=name))
    name = "V13 R1 + D1, two strikes (post-hoc, beyond 12)"
    dec, log = W.run(t, "R1", "D1", mkt=mkt, cache=cache, unit="two_strikes")
    rep = E.report(dec, name)
    reps.append(rep.assign(variant=name))
    sums.append(summary(rep, name))
    logs.append(log.assign(variant=name))
    storm = pd.read_parquet(HERE / "storm_trades.parquet")
    dec, spicks = storm_switch(t, storm)
    name = "V12 storm exit for trend rules (post-hoc)"
    rep = E.report(dec, name)
    reps.append(rep.assign(variant=name))
    sums.append(summary(rep, name))
    print(spicks.pivot(index="q", columns="rule", values="diff").to_string())
    spicks.to_csv(HERE / "storm_picks.csv", index=False)
    pd.concat(reps).to_csv(HERE / "results.csv", index=False)
    pd.concat(logs).to_csv(HERE / "switch_log.csv", index=False)
    picks.to_csv(HERE / "nested_picks.csv", index=False)
    s = pd.DataFrame(sums)
    s.to_csv(HERE / "summary.csv", index=False)
    print("\n" + s.to_string(index=False))
