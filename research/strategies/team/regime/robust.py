"""Robustness + diagnostics for the primary method (V2 = R1 + D1) and the post-hoc V13. Not new variants.
  1. sensitivity: m in {20, 50, 100}, min_n in {10, 20, 40}, VIX median window 126 vs 252
  2. per-year made% / sum% vs static
  3. persistence: each rule x R1 regime, design years (2019-20) vs 2021-23 vs 2024-26
  4. hindsight ceiling: switch off every (rule, regime) cell whose 2021-26 mean is < 0 (look-ahead, upper bound only)"""
import sys
from pathlib import Path
import pandas as pd
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent)); sys.path.insert(0, str(HERE))
import evaluate as E, regimes as G, walk as W

pd.set_option("display.width", 220)
t = E.load(); mkt = G.market(); cache = {}


def allrow(dec):
    r = E.report(dec, show=False).set_index(["period", "rule"])
    return {f"{p} {c}": r.loc[(p, "ALL"), c] for p in ("2021-26", "2024-26") for c in ("made%", "vs static made%", "sum%")}


print("## 1. sensitivity (ALL)")
rows = []
for m in (20, 50, 100):
    for mn in (10, 20, 40):
        rows.append({"cfg": f"V2 m={m} min_n={mn}", **allrow(W.run(t, "R1", "D1", m, mn, mkt=mkt, cache=cache)[0])})
m126 = G.market(vmed_window=126)
rows.append({"cfg": "V2 VIX median 126", **allrow(W.run(t, "R1", "D1", mkt=m126, cache={})[0])})
for m in (3, 12):
    rows.append({"cfg": f"V11 months m=min={m}", **allrow(W.run(t, "R1", "D1", m, m, mkt=mkt, cache=cache, unit="months")[0])})
for m in (20, 100):
    rows.append({"cfg": f"V13 two strikes m={m}", **allrow(W.run(t, "R1", "D1", m, 20, mkt=mkt, cache=cache, unit="two_strikes")[0])})
for lo, hi in ((0.35, 0.65), (0.45, 0.75)):
    rows.append({"cfg": f"V3 breadth {lo}/{hi}", **allrow(W.run(t, "R2", "D1", mkt=mkt, cache={}, label_kw={"b_lo": lo, "b_hi": hi})[0])})
print(pd.DataFrame(rows).to_string(index=False))

print("\n## 2. per year, ALL rules (made% / sum%)")
v2 = W.run(t, "R1", "D1", mkt=mkt, cache=cache)[0]
v13 = W.run(t, "R1", "D1", mkt=mkt, cache=cache, unit="two_strikes")[0]
b = E.baseline()
yr = []
for y in range(2021, 2027):
    row = {"year": y}
    for lab, d in (("static", b), ("V2", v2[v2["take"]]), ("V13", v13[v13["take"]])):
        g = d[d.signal_date.dt.year == y]
        row[f"{lab} made%"] = round(100 * (g.net > 0).mean(), 1)
        row[f"{lab} sum%"] = round(100 * g.net.sum())
    yr.append(row)
print(pd.DataFrame(yr).to_string(index=False))

print("\n## 3. persistence: rule x R1 regime (made% / avg% / n)")
lab = G.label(mkt, "R1")
tt = t.assign(reg=lab.reindex(t.signal_date).to_numpy(),
              per=pd.cut(t.signal_date, pd.to_datetime(["2019-01-01", "2021-01-01", "2024-01-01", "2027-01-01"]),
                         labels=["2019-20", "2021-23", "2024-26"], right=False))
p = tt.groupby(["rule", "reg", "per"], observed=True).net.agg(
    made=lambda x: round(100 * (x > 0).mean()), avg=lambda x: round(100 * x.mean(), 2), n="size").unstack("per")
print(p.to_string())

print("\n## 4. hindsight ceiling (LOOK-AHEAD: cells with negative 2021-26 mean switched off)")
oos = t[t.signal_date >= "2021-01-01"]
rows = []
for d in G.FIXED:
    l = G.label(mkt, d)
    o = oos.assign(reg=l.reindex(oos.signal_date).to_numpy())
    cm = o.groupby(["rule", "reg"]).net.mean()
    bad = set(cm[cm < 0].index)
    o["take"] = [(r, k) not in bad for r, k in zip(o.rule, o.reg)]
    rows.append({"definition": f"{d} {G.NAMES[d]}", "cells off": len(bad), **allrow(o)})
print(pd.DataFrame(rows).to_string(index=False))
