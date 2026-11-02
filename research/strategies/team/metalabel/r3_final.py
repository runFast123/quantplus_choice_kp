"""D*** reference run for production parity tests (rsi_dip_tier/3). Uses only tier_model.py and the shared data files
(team_trades, team_features for the setup count, candles for the point-in-time top 300).
  1. refit the production model on every complete-cohort rsi_dip trade as of 2026-11-01 -> out/rsi_dip_tier_model.json
  2. walk-forward, quarter by quarter from 2021Q1: fit at the quarter start, score that quarter's top-300 rsi_dip signals
     -> out/rsi_dip_tier_walk.csv (symbol, signal_date, quarter, p, tier, net + the 25 features)
  3. High - Low made% gap, 2021-26 and 2024-26, computed from that CSV.
  4. the model in force at each quarter start 2024Q1..2026Q4 -> out/rsi_dip_tier_models_by_quarter.json (backfill)."""
import json
from pathlib import Path

import numpy as np
import pandas as pd

import tier_model as T

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
TODAY = pd.Timestamp("2026-11-01")

t = pd.read_parquet(HERE.parents[1] / "data" / "team_trades.parquet")
t = t[t.rule == "rsi_dip"].copy()
t["signal_date"] = pd.to_datetime(t.signal_date)
t = t.sort_values(["signal_date", "symbol"], kind="mergesort").reset_index(drop=True)
t["quarter"] = t.signal_date.dt.to_period("Q").dt.start_time
pit = T.pit_top(pd.read_parquet(HERE.parents[1] / "data" / "candles.parquet"))
feat = pd.read_parquet(HERE.parents[1] / "data" / "team_features.parquet", columns=["symbol", "date", "rsi2", "d200"])
setups = T.setup_count(feat, pit)
own = (t.rsi2 < 10) & (t.d200 > 0)
t["n_same_day"] = T.n_same_day(t.signal_date.map(setups).fillna(0).to_numpy() + np.where(own, 0, 1))
hr = {q: T.hr_rule(t, q) for q in pd.date_range("2019-07-01", "2026-10-01", freq="QS")}
hr[TODAY] = T.hr_rule(t, TODAY)
t["hr_rule"] = t.quarter.map(hr)

# 1. production model (training rows keep the hr_rule of their own quarter)
final = T.fit(t, asof=TODAY)
T.save(final, OUT / "rsi_dip_tier_model.json")
print(f"model {final['version']}: n_train {final['n_train']} through {final['trained_through']}, shown {final['shown']}, "
      f"platt a {final['platt_a']:.3f}, cut-offs {final['cut_lo']:.3f} / {final['cut_hi']:.3f}, "
      f"self-test AUC {final['self_test_auc']:.3f} (record only)")

# 2. walk-forward reference file
rows, log = [], []
for Q in pd.date_range("2021-01-01", "2026-10-01", freq="QS"):
    m = T.fit(t, asof=Q)
    te = t[t.quarter == Q]
    s = T.score(m, te)
    rows.append(te.assign(p=s.p, tier=s.tier))
    log.append((Q.date(), m["n_train"], m["shown"], round(m.get("platt_a", np.nan), 3), round(m.get("self_test_auc", np.nan), 3)))
w = pd.concat(rows, ignore_index=True)
w["quarter"] = w.quarter.dt.to_period("Q").astype(str)
cols = ["symbol", "signal_date", "quarter", "p", "tier", "net"] + T.FEATURES
w[cols].to_csv(OUT / "rsi_dip_tier_walk.csv", index=False, date_format="%Y-%m-%d")
print(pd.DataFrame(log, columns=["Q", "n_train", "shown", "platt_a", "self_test_auc"]).to_string(index=False))

# 3. gaps from the CSV
c = pd.read_csv(OUT / "rsi_dip_tier_walk.csv", parse_dates=["signal_date"])
for per, lo in (("2021-26", "2021-01-01"), ("2024-26", "2024-01-01")):
    g = c[(c.signal_date >= lo) & (c.signal_date < "2026-11-01")]
    by = g.groupby("tier").net.agg(n="size", made=lambda x: 100 * (x > 0).mean())
    gap = by.loc["High", "made"] - by.loc["Low", "made"]
    print(f"{per}: " + "  ".join(f"{k} {v.made:.1f}% ({int(v.n)})" for k, v in by.iterrows())
          + f"  | High - Low {gap:+.1f} points")
    q = g[g.tier.isin(["High", "Low"])].groupby(["quarter", "tier"]).net.apply(lambda x: (x > 0).mean()).unstack()
    q = q.dropna()
    print(f"   quarters with both tiers: {len(q)}, High beat Low in {(q.High > q.Low).sum()}")

# 4. models in force at each quarter start, for an honest backfill of past live signals
by_q = []
for Q in pd.date_range("2024-01-01", "2026-10-01", freq="QS"):
    m = T.fit(t, asof=Q)
    m["valid_from"] = str(Q.date())
    m["valid_to"] = str((Q + pd.offsets.QuarterBegin(startingMonth=1) - pd.Timedelta(days=1)).date())
    by_q.append(m)
with open(OUT / "rsi_dip_tier_models_by_quarter.json", "w", encoding="utf-8") as fh:
    json.dump(by_q, fh, indent=1)
print("models by quarter:", [(m["valid_from"], m["shown"], round(m.get("platt_a", 0), 3)) for m in by_q])
