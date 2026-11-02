"""Production handoff (no new research): the exact inputs of the D*** rsi_dip_tier/3 fit, and a reproduction check
that refits from the exported CSV alone."""
import json
from pathlib import Path

import numpy as np
import pandas as pd

import tier_model as T

HERE = Path(__file__).resolve().parent
OUT, DATA = HERE / "out", HERE.parents[1] / "data"

t = pd.read_parquet(DATA / "team_trades.parquet")
t = t[t.rule == "rsi_dip"].copy()
t["signal_date"] = pd.to_datetime(t.signal_date)
t = t.sort_values(["signal_date", "symbol"], kind="mergesort").reset_index(drop=True)
t["quarter"] = t.signal_date.dt.to_period("Q").dt.start_time
ranked = T.pit_ranked(pd.read_parquet(DATA / "candles.parquet"))
pit = {y: set(r) for y, r in ranked.items()}
feat = pd.read_parquet(DATA / "team_features.parquet", columns=["symbol", "date", "rsi2", "d200"])
setups = T.setup_count(feat, pit)
own = (t.rsi2 < 10) & (t.d200 > 0)
t["n_same_day"] = T.n_same_day(t.signal_date.map(setups).fillna(0).to_numpy() + np.where(own, 0, 1))
qs = pd.date_range("2019-07-01", "2026-10-01", freq="QS")
hr = {q: T.hr_rule(t, q) for q in qs}
t["hr_rule"] = t.quarter.map(hr)

rows = t[["symbol", "signal_date", "net"] + T.FEATURES]
rows.to_csv(OUT / "rsi_dip_training_rows.csv", index=False, date_format="%Y-%m-%d")
pd.DataFrame({"quarter_start": [q.date() for q in qs], "hr_rule": [hr[q] for q in qs]}).to_csv(
    OUT / "rsi_dip_hr_rule_by_quarter.csv", index=False)
pd.DataFrame([(y, s, i + 1) for y, r in ranked.items() for i, s in enumerate(r)], columns=["year", "symbol", "rank"]) \
    .to_csv(OUT / "pit_top300.csv", index=False)
print(f"training rows {len(rows)} ({rows.signal_date.min().date()} .. {rows.signal_date.max().date()}); "
      f"own row is a setup: {100 * own.mean():.1f} %; hr quarters {len(qs)} ({sum(np.isnan(v) for v in hr.values())} NaN); "
      f"pit rows {sum(len(r) for r in ranked.values())}")

# reproduction check from the CSV alone
csv = pd.read_csv(OUT / "rsi_dip_training_rows.csv", parse_dates=["signal_date"])
single = T.load(OUT / "rsi_dip_tier_model.json")
byq = {m["valid_from"]: m for m in json.load(open(OUT / "rsi_dip_tier_models_by_quarter.json", encoding="utf-8"))}
KEYS = ["coef", "intercept", "median", "mean", "sd", "platt_a", "platt_b", "cut_lo", "cut_hi", "self_test_auc", "n_train",
        "shown"]


def diff(a, b):
    return max(float(np.max(np.abs(np.asarray(a[k], float) - np.asarray(b[k], float)))) for k in KEYS)


for asof, ref, lab in (("2026-11-01", single, "rsi_dip_tier_model.json"),
                       ("2026-10-01", byq["2026-10-01"], "models_by_quarter[2026-10-01]"),
                       ("2025-07-01", byq["2025-07-01"], "models_by_quarter[2025-07-01]")):
    m = T.fit(csv, asof=asof)
    print(f"fit(csv, asof={asof}) vs {lab}: max |diff| over {', '.join(KEYS[:3])}... = {diff(m, ref):.1e}; "
          f"n_train {m['n_train']}, platt_a {m['platt_a']:.6f}, cut-offs {m['cut_lo']:.6f} / {m['cut_hi']:.6f}")
m10 = T.fit(csv, asof="2026-10-01")
print(f"fit(asof=2026-10-01) vs rsi_dip_tier_model.json: max |diff| {diff(m10, single):.1e} (different training cut-off)")
