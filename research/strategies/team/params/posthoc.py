"""POST-HOC checks (written after walk.py's results; NOT pre-registered - see REPORT.md). They do not hunt for a new
winner: they stress-test the variant that passed the pre-registered test (V5, t-statistic objective) and split its gain.

  P1 V5 + 2-year window        P2 V5 + expanding window      P3 V5 half-yearly     P4 V5 without neighbourhood avg
  P5 V5 chosen once on 2021-01-01, then frozen   (is the gain adaptation, or a one-time re-tune?)
  P6 V5 + hysteresis 1 SE      (fewer switches)
  P7 V5 on the two trend rules only, the dip rules at today's settings   ("adopt partly")
  P8-P11 the same stress tests for V4 (made% objective), which also passed: hysteresis, 2-year, expanding, half-yearly
Plus: the fixed-grid landscape on 2021-26 (look-ahead, context only), V5 per year, and time in the trade.

    cd research/strategies && python team/params/posthoc.py
"""
import numpy as np
import pandas as pd

import engine as E
import evaluate as EV
import walk as W

V5 = {**W.BASE, "obj": "t"}
POST = {
    "P1 V5 2-year window": dict(win=2),
    "P2 V5 expanding window": dict(win=None),
    "P3 V5 half-yearly": dict(freq="H"),
    "P4 V5 no neighbourhood avg": dict(smooth=False),
    "P5 V5 choose once, freeze": dict(freeze=True),
    "P6 V5 hysteresis 1 SE": dict(hyst=True),
}
V4 = {**W.BASE, "obj": "made"}
POST4 = {   # added after V4 was also found to pass: the same stress tests for it
    "P8 V4 hysteresis 1 SE": dict(hyst=True),
    "P9 V4 2-year window": dict(win=2),
    "P10 V4 expanding window": dict(win=None),
    "P11 V4 half-yearly": dict(freq="H"),
}


def stream(g, st, spec, rules=E.RULES):
    parts = []
    for rule in E.RULES:
        if rule in rules:
            parts.append(E.run(st, rule, W.as_schedule(W.schedule_for(g[g.rule == rule], spec))))
        else:
            parts.append(E.run(st, rule, E.fixed(E.TODAY)))
    return pd.concat(parts, ignore_index=True).assign(take=True)


def time_in_trade(d, lab):
    d = d[d.signal_date >= EV.START]
    out = []
    for rule in E.RULES + ["ALL"]:
        x = d if rule == "ALL" else d[d.rule == rule]
        out.append({"variant": lab, "rule": rule, "avg days": round(x.days.mean(), 1),
                    "net per 100 trade-days %": round(100 * x.net.sum() / x.days.sum() * 100, 2)})
    return pd.DataFrame(out)


if __name__ == "__main__":
    pd.set_option("display.width", 220)
    g = E.grid_trades()
    st = E.load()
    rows = []
    for name, over in POST.items():
        d = stream(g, st, {**V5, **over})
        rows.append(EV.report(d, name).assign(variant=name))
    for name, over in POST4.items():
        d = stream(g, st, {**V4, **over})
        rows.append(EV.report(d, name).assign(variant=name))
    d7 = stream(g, st, V5, rules=("strong_trend", "sma_trend"))
    rows.append(EV.report(d7, "P7 V5 trend rules only").assign(variant="P7 V5 trend rules only"))
    pd.concat(rows).to_csv(E.OUT / "posthoc_summary.csv", index=False)
    d6 = stream(g, st, {**V5, "hyst": True})
    # streams for the team, with team_trades' signal-day features (take = True for every trade)
    feats = pd.read_parquet(E.ROOT / "data" / "team_features.parquet").rename(columns={"date": "signal_date"})
    for tag, d in (("V5", pd.read_parquet(E.OUT / "stream_V5.parquet")), ("P6", d6), ("P7", d7)):
        d.merge(feats, on=["symbol", "signal_date"], how="left").to_parquet(E.OUT / f"team_stream_{tag}.parquet", index=False)

    v5 = pd.read_parquet(E.OUT / "stream_V5.parquet")
    base = EV.baseline()
    print("\n=== time in the trade (2021-26): longer holds inflate avg% and sum% per trade")
    print(pd.concat([time_in_trade(base, "static"), time_in_trade(v5, "V5"), time_in_trade(d7, "P7")]).pivot(
        index="rule", columns="variant").to_string())
    print("\n=== per year, ALL rules and per rule: static vs V5")
    for rule in [None] + E.RULES:
        b = base if rule is None else base[base.rule == rule]
        v = v5 if rule is None else v5[v5.rule == rule]
        print(f"\n-- {rule or 'ALL'}")
        print(pd.concat({"static": W.per_year(b), "V5": W.per_year(v[v.signal_date >= EV.START])}, axis=1).to_string())
    print("\n=== fixed-grid landscape, 2021-26 and 2024-26 (LOOK-AHEAD, context only): where does today's point rank?")
    for rule in E.RULES:
        x = g[(g.rule == rule) & (g.signal_date >= EV.START)]
        r = x.groupby("cfg").net.agg(n="size", avg="mean", sum="sum", made=lambda s: (s > 0).mean())
        r24 = x[x.signal_date >= EV.RECENT].groupby("cfg").net.agg(avg24="mean", sum24="sum")
        r = r.join(r24)
        r["t"] = x.groupby("cfg").net.apply(lambda s: s.mean() / s.std() * np.sqrt(len(s)))
        r.index = [E.label(rule, k) + (" <- today" if k == E.TODAY else "") for k in r.index]
        r = r.sort_values("t", ascending=False)
        r[["avg", "sum", "made", "avg24", "sum24"]] = (r[["avg", "sum", "made", "avg24", "sum24"]] * 100).round(2)
        print(f"\n-- {rule}: today's rank by t {list(r.index).index(E.label(rule, E.TODAY) + ' <- today') + 1}/27")
        print(r.round(2).head(6).to_string())
        print(r.round(2).loc[[E.label(rule, E.TODAY) + " <- today"]].to_string(header=False))
