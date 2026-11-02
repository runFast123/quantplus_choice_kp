"""Why are most 2025-26 RSI dips labelled Low under D**? Read-only diagnosis of the D** walk (out/rsi_dip_tier_walk.csv);
refits the same quarterly models with tier_model.fit (nothing new is fitted or tuned).
  1. tier shares and made% per year;
  2. per quarter: share of the quarter's signals below cut_lo vs the share of the TRAINING trades below cut_lo when the
     same final model scores them (a scale gap between forward-OOF cut-offs and the final model), and the mean raw-score
     shift of the quarter's signals vs the training trades, split by feature (coef x mean standardised value);
  3. the walk's gaps if quarters whose Platt slope is a numerical zero (a < 1e-6) count as "no tier"."""
from pathlib import Path

import numpy as np
import pandas as pd

import tier_model as T

HERE = Path(__file__).resolve().parent
c = pd.read_csv(HERE / "out" / "rsi_dip_tier_walk.csv", parse_dates=["signal_date"])
c["y"] = c.net > 0
c["year"] = c.signal_date.dt.year
pd.set_option("display.width", 220)
print("1. per year: share of signals and made% by tier")
print(c.groupby(["year", "tier"]).y.agg(n="size", made="mean").assign(made=lambda x: (100 * x.made).round(1))
      .unstack("tier").to_string())

t = pd.read_parquet(HERE.parents[1] / "data" / "team_trades.parquet")
t = t[t.rule == "rsi_dip"].copy()
t["signal_date"] = pd.to_datetime(t.signal_date)
t = t.sort_values(["signal_date", "symbol"], kind="mergesort").reset_index(drop=True)
t["quarter"] = t.signal_date.dt.to_period("Q").dt.start_time
t["n_same_day"] = T.n_same_day(t.groupby("signal_date").symbol.transform("size"))
t["hr_rule"] = t.quarter.map({q: T.hr_rule(t, q) for q in t.quarter.unique()})

rows, contrib, flat = [], [], []
for Q in pd.date_range("2021-01-01", "2026-10-01", freq="QS"):
    m = T.fit(t, asof=Q)
    if m.get("platt_a", 0) < 1e-6:
        flat.append(str(Q.to_period("Q")))
    if Q < pd.Timestamp("2024-01-01") or "coef" not in m:
        continue
    tr = t[t.signal_date < Q - pd.Timedelta(days=28)]
    te = t[t.quarter == Q]
    z = lambda d: (np.where(np.isnan(d[T.FEATURES].to_numpy(float)), m["median"], d[T.FEATURES].to_numpy(float))
                   - np.array(m["mean"])) / np.array(m["sd"])
    p_tr, p_te = T.score(m, tr).p, T.score(m, te).p
    rows.append({"Q": str(Q.to_period("Q")), "n": len(te), "test below cut_lo": round((p_te < m["cut_lo"]).mean(), 2),
                 "train (final model) below cut_lo": round((p_tr < m["cut_lo"]).mean(), 2),
                 "test above cut_hi": round((p_te >= m["cut_hi"]).mean(), 2),
                 "raw shift test - train": round(float((z(te) @ np.array(m["coef"])).mean()
                                                       - (z(tr) @ np.array(m["coef"])).mean()), 3)})
    contrib.append(pd.Series(np.array(m["coef"]) * (z(te).mean(0) - z(tr).mean(0)), index=T.FEATURES, name=str(Q.to_period("Q"))))
print("\n2. quarters 2024-26")
print(pd.DataFrame(rows).to_string(index=False))
cc = pd.DataFrame(contrib)
y25 = cc.loc[[q for q in cc.index if q >= "2025Q1"]].mean().sort_values()
print("   mean raw-score shift 2025Q1-2026Q4 by feature (coef x change in standardised mean), most negative first:")
print("   " + ", ".join(f"{k} {v:+.3f}" for k, v in y25.head(8).items()) + f" | total {y25.sum():+.3f}")
print("   most positive:", ", ".join(f"{k} {v:+.3f}" for k, v in y25.tail(4).items()))
print("\n3. quarters with a numerically flat calibration (a < 1e-6):", flat)
for per, lo in (("2021-26", "2021-01-01"), ("2024-26", "2024-01-01")):
    g = c[c.signal_date >= lo].copy()
    g.loc[g.quarter.isin(flat), "tier"] = "none"
    by = g.groupby("tier").y.agg(["size", "mean"])
    print(f"   {per} with a < 1e-6 as 'none': High {100 * by.loc['High', 'mean']:.1f}% ({by.loc['High', 'size']}) "
          f"Low {100 * by.loc['Low', 'mean']:.1f}% ({by.loc['Low', 'size']}) | High - Low "
          f"{100 * (by.loc['High', 'mean'] - by.loc['Low', 'mean']):+.1f}")
