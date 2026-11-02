"""Compares what migration 39 computed on the live copy (check_live.mjs -> data/sql_checks.json) with the research.

  RSI dip check   the SQL features, chance and label of every RSI dip signal that is also in the research record
                  (metalabel/out/rsi_dip_tier_walk.csv: the same stocks, days and quarterly models): per-feature
                  differences, how closely the chances agree, and how often the label is the same.
  Strong trend    health's rule (health/ROUND3.md, the production spec) recomputed in Python on the SQL's own grades:
                  every label must match.
Run from research/strategies/team:  python check_live.py
"""
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
D = HERE.parent / "data"
sql = json.loads((D / "sql_checks.json").read_text(encoding="utf-8"))
checks = pd.DataFrame(sql["checks"])
print("checks by rule and label:\n", checks.groupby(["strategy", "label"]).size().unstack(fill_value=0), "\n")

# ------------------------------------------------------------------ RSI dip
FEATURES = ["d200", "d50", "d20", "slope200", "rsi14", "rsi2", "atrpct", "volratio", "rs_rank", "r5", "r20", "r126",
            "dist_hi252", "clv", "gap", "sector_rank", "nifty_d200", "nifty_r20", "vix", "vix_chg5", "wx",
            "breadth50", "breadth200", "hr_rule", "n_same_day"]
rsi = checks[checks.strategy == "rsi_dip"].copy()
feat = pd.DataFrame([d.get("features", {}) for d in rsi.detail], index=rsi.index)
rsi = rsi.join(feat.reindex(columns=FEATURES).add_prefix("sql_"))
walk = pd.read_csv(HERE / "metalabel" / "out" / "rsi_dip_tier_walk.csv")
m = rsi.merge(walk, left_on=["symbol", "signal_day"], right_on=["symbol", "signal_date"], how="inner")
print(f"RSI dip: {len(rsi)} SQL checks, {len(walk)} research signals, {len(m)} in both "
      f"({m.signal_day.min()} .. {m.signal_day.max()})")
rows = []
for f in FEATURES:
    a, b = m[f"sql_{f}"].astype(float), m[f].astype(float)
    ok = a.notna() & b.notna()
    rows.append({"feature": f, "both": int(ok.sum()), "sql_missing": int((a.isna() & b.notna()).sum()),
                 "median_abs_diff": float((a - b)[ok].abs().median()) if ok.any() else math.nan,
                 "p95_abs_diff": float((a - b)[ok].abs().quantile(0.95)) if ok.any() else math.nan,
                 "corr": float(a[ok].corr(b[ok])) if ok.sum() > 2 else math.nan})
print(pd.DataFrame(rows).round(4).to_string(index=False))
lab = m.tier.str.lower()
print(f"\nchance: corr {m.score.astype(float).corr(m.p):.4f}, median abs diff {(m.score.astype(float) - m.p).abs().median():.4f}")
print(f"label the same: {100 * (m.label == lab).mean():.1f} %  ({int((m.label == lab).sum())} of {len(m)})")
print(pd.crosstab(m.label.rename("sql"), lab.rename("research")), "\n")

# ------------------------------------------------------------------ Strong trend
o = pd.DataFrame(sql["outcomes"])
o["signal_day"] = pd.to_datetime(o.signal_day)
g = o[o.stop_hit_20.notna() & ((o.stop_hit_20 & o.stop.notna()) | o.r20.notna())].copy()
g["grade"] = np.where(g.stop_hit_20.astype(bool), g.stop / g.entry_price - 1, g.r20) - 0.005
g = g.sort_values(["signal_day", "symbol"], ascending=[False, False])
st = checks[checks.strategy == "strong_trend"].copy()
wx = {r["symbol"] + r["signal_day"]: r["weather"] for r in sql["outcomes"]}
exp = []
for r in st.itertuples():
    day = pd.Timestamp(r.signal_day)
    w = r.detail.get("weather")
    old = g[g.signal_day < day - pd.Timedelta(days=42)]
    b = old[old.weather == w].head(30) if w else old.head(0)
    if len(b) < 30:
        b = old.head(50)
    n = len(b)
    if n < 20:
        exp.append("none")
        continue
    mean, sd = b.grade.mean(), b.grade.std(ddof=1)
    t = mean / (sd / math.sqrt(n)) if sd > 0 else (-math.inf if mean < 0 else 0)
    exp.append("weak" if mean < 0 and t < -1 else "ok")
st["expected"] = exp
print(f"Strong trend: {len(st)} checks; label matches Python: {int((st.label == st.expected).sum())} of {len(st)}")
print(st.groupby(["label", "expected"]).size(), "\n")
print("training rows:", sql["training"])
