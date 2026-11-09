"""Secular trend (owner, 2026-11-09): Pring's Special K renamed, signal lengths 50 and 50, the zero line moved to -150.
Variants written down before running.

Secular trend = Special K (specialk.py: 12 smoothed rates of change, Pring's weights); signal line = SMA 50 of SMA 50.
The owner's rule: Secular trend crosses above its signal line while flat or rising (not lower than 5 sessions ago,
specialk.py K2), read against a -150 line instead of zero. Where the -150 line sits (2019-07..2026-10, research
stocks): 12 % of days are below it; 19 % of the owner's crosses (768 of 4,077) happen below it.
Two readings of "the -150 line", both tested:
  T0 the cross (flat or rising), no level                         (= specialk K2: the baseline)
  T1 T0 + Secular trend above -150 at the cross
  T2 T0 + Secular trend below -150 at the cross                    (a deep low turning up: fewer signals)
  T3 T1 + the stock above a rising 200-day average
  T4 T2 + the stock above a rising 200-day average
Exits (as in specialk.py): cross (back under the signal line), cross4 (with a 4 x ATR safety stop), hold60 (4 x ATR
stop, else the 60th session), trail (3 x ATR, then the highest close - 3 x ATR).
Choose on 2019-07..2023-12: the fewest losing trades among variants with at least 50 trades a year (the owner expects
few signals) and a positive average; report 2024-01..2026-10 for every variant. Yardsticks with the chosen plan:
a random day, and a random day on the same side of -150 (so the level itself is not mistaken for the rule's edge).
Point-in-time top 300 per year, 0.5 % round-trip cost, one trade per stock at a time.
"""
import json

import numpy as np
import pandas as pd

import backtest as B
import improve as I
import specialk as K

LEVEL = -150
base = lambda f: K.cross(f) & K.not_lower(5)(f)
above = lambda f: f.sk > LEVEL
below = lambda f: f.sk < LEVEL
anyday = lambda f: pd.Series(True, index=f.index)
# entry -> (rule, the yardstick's condition: same side of -150, same trend filter)
ENTRIES = {
    "T0 cross, no level": (base, anyday),
    "T1 above -150": (lambda f: base(f) & above(f), above),
    "T2 below -150": (lambda f: base(f) & below(f), below),
    "T3 T1+uptrend": (lambda f: base(f) & above(f) & K.trend(f), lambda f: above(f) & K.trend(f)),
    "T4 T2+uptrend": (lambda f: base(f) & below(f) & K.trend(f), lambda f: below(f) & K.trend(f)),
}


def yardstick(entry, exit_, cond):
    """Random days meeting `cond`, as many a year as the rule's signals, with the same plan; five seeds."""
    days = sum(int((f.sk_sig.notna() & cond(f)).fillna(False).sum()) for f in K.F.ALL.values())
    sig = sum(int(entry(f).fillna(False).sum()) for f in K.F.ALL.values())

    def rnd(seed):
        rng = np.random.default_rng(seed)
        return lambda f: pd.Series(rng.random(len(f)) < sig / days, index=f.index) & f.sk_sig.notna() & cond(f)

    return pd.concat([I.run_close_rule(rnd(s), exit_) for s in range(5)])


if __name__ == "__main__":
    K.attach()
    rows, kept = [], {}
    for en, (e, _) in ENTRIES.items():
        for xn, x in K.EXITS.items():
            t = I.run_close_rule(e, x)
            kept[(en, xn)] = t
            rows += [dict(entry=en, exit=xn, period=k, **v) for k, v in K.periods(t).items()]
            print(f"  {en:20s} {xn:7s} {I.summary(t)}", flush=True)
    out = pd.DataFrame(rows)
    out.to_csv(B.D / "secular_summary.csv", index=False)

    ins = out[(out.period == "2019_23") & (out.per_year >= 50) & (out.avg_pct > 0)]
    pick = ins.sort_values(["made_money_pct", "avg_pct"], ascending=False).iloc[0]
    en, xn = pick.entry, pick.exit
    t = kept[(en, xn)]
    print(f"\nchosen on 2019-23: {en} / {xn}")
    t.to_csv(B.D / "secular_chosen_trades.csv", index=False)
    yearly = {int(y): K.stats(g, 1) for y, g in t.groupby(t.date.dt.year)}
    for y, v in yearly.items():
        print(f"  {y}: {v}")
    rule, cond = ENTRIES[en]
    r_any = yardstick(rule, K.EXITS[xn], anyday)
    r_side = yardstick(rule, K.EXITS[xn], cond)
    print(f"  random day, same plan:                         {I.summary(r_any)}")
    print(f"  random day, same side of -150 and trend filter: {I.summary(r_side)}")
    for other in ("T1 above -150", "T2 below -150"):
        if other != en:
            print(f"  {other} with the same exit ({xn}): {I.summary(kept[(other, xn)])}")
    live = json.load(open(B.D / "final_report.json"))
    json.dump({"variants": rows, "chosen": {"entry": en, "exit": xn, **K.periods(t)}, "yearly": yearly,
               "random_any": K.periods(r_any), "random_same_side": K.periods(r_side),
               "live_rules": {k: v["new"] for k, v in live.items()}},
              open(B.D / "secular_report.json", "w"), indent=1, default=str)
    print("wrote data/secular_summary.csv and data/secular_report.json")
