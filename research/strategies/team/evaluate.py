"""The one scorer every team member uses (team/BRIEF.md). Out of sample only: signal_date 2021-01-01 .. 2026-10-31.

    from evaluate import report, baseline
    report(decisions, "my method")        # decisions: trades frame + bool column `take` (+ optional `size` in [0, 1])

For each rule and overall, for 2021-26 and 2024-26:
  kept       share of the static rule's trades taken (by count; if you re-ran a rule, vs the static count)
  trades     trades taken
  made%      trades taken that made money (net > 0, after the 0.5 % cost)      <- accuracy
  avg%       average net per trade taken                                         <- quality
  sum%       sum of net returns of the trades taken (x size) = profit captured    <- what you gave up
  worst5%    5th percentile net of trades taken                                   <- tail risk
  vs static  made% and sum% minus the static rule's, same rows
"""
from pathlib import Path

import numpy as np
import pandas as pd

D = Path(__file__).resolve().parents[1] / "data"
START, END, RECENT = pd.Timestamp("2021-01-01"), pd.Timestamp("2026-11-01"), pd.Timestamp("2024-01-01")
RULES = ["strong_trend", "sma_trend", "rsi_dip", "kk_dip"]


def load():
    t = pd.read_parquet(D / "team_trades.parquet")
    t["signal_date"] = pd.to_datetime(t.signal_date)
    for c in ("entry_date", "exit_date"):
        t[c] = pd.to_datetime(t[c])
    return t


def baseline():
    t = load()
    t = t[(t.signal_date >= START) & (t.signal_date < END)].copy()
    t["take"] = True
    return t


def _block(g, static_n):
    taken = g[g["take"]]
    size = taken["size"] if "size" in taken else pd.Series(1.0, index=taken.index)
    if not len(taken):
        return {"kept": 0.0, "trades": 0, "made%": np.nan, "avg%": np.nan, "sum%": 0.0, "worst5%": np.nan}
    return {
        "kept": round(len(taken) / max(static_n, 1), 2),
        "trades": int(len(taken)),
        "made%": round(100 * (taken.net > 0).mean(), 1),
        "avg%": round(100 * (taken.net * size).sum() / size.sum(), 2),
        "sum%": round(100 * (taken.net * size).sum(), 0),
        "worst5%": round(100 * taken.net.quantile(0.05), 1),
    }


def report(decisions: pd.DataFrame, name: str = "method", show: bool = True) -> pd.DataFrame:
    d = decisions.copy()
    d["signal_date"] = pd.to_datetime(d.signal_date)
    d = d[(d.signal_date >= START) & (d.signal_date < END)]
    if "take" not in d:
        raise ValueError("decisions needs a boolean column `take`")
    d["take"] = d["take"].astype(bool)
    if "size" in d:
        d["size"] = d["size"].clip(0, 1).fillna(0)
    base = baseline()
    rows = []
    for period, lo in (("2021-26", START), ("2024-26", RECENT)):
        for rule in RULES + ["ALL"]:
            g = d[d.signal_date >= lo] if rule == "ALL" else d[(d.signal_date >= lo) & (d.rule == rule)]
            b = base[base.signal_date >= lo] if rule == "ALL" else base[(base.signal_date >= lo) & (base.rule == rule)]
            r = _block(g, len(b))
            s = _block(b, len(b))
            r.update({"period": period, "rule": rule, "vs static made%": round(r["made%"] - s["made%"], 1) if r["trades"] else np.nan,
                      "vs static sum%": round(r["sum%"] - s["sum%"], 0)})
            rows.append(r)
    out = pd.DataFrame(rows)[["period", "rule", "kept", "trades", "made%", "avg%", "sum%", "worst5%", "vs static made%", "vs static sum%"]]
    if show:
        print(f"\n=== {name}")
        print(out.to_string(index=False))
    return out


if __name__ == "__main__":
    report(baseline(), "static rules (today)")
