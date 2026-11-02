"""D** rule on my round-3 build (round3.py, blocks cut on rsi_dip trades only): the tier is shown whenever the forward
Platt slope is above 0, no AUC gate. Per calendar year, rsi_dip, top 300 -> out/round3_final_years.csv.

    cd research/strategies && python team/params/round3.py && python team/params/round3_final.py
"""
from pathlib import Path

import pandas as pd

OUT = Path(__file__).resolve().parent / "out"

d = pd.read_parquet(OUT / "round3_rsi_tier.parquet")
q = pd.read_csv(OUT / "round3_quarters.csv", parse_dates=["Q"])
d = d.merge(q[["Q", "slope"]], left_on="q", right_on="Q", how="left")
d["shown"] = d.slope.fillna(0) > 0
d.loc[~d.shown, "tier"] = "none"
d["year"] = d.signal_date.dt.year


def block(x, label):
    r = {"year": label, "signals": len(x), "tier shown %": round(100 * x.shown.mean(), 1)}
    for t in ("High", "Normal", "Low"):
        g = x[x.tier == t]
        r[f"{t} n"] = len(g)
        r[f"{t} made%"] = round(100 * g.y.mean(), 1) if len(g) else None
    r["High-Low"] = round(r["High made%"] - r["Low made%"], 1) if r["High n"] and r["Low n"] else None
    qq = [(qs, g) for qs, g in x.groupby("q") if (g.tier == "High").sum() >= 5 and (g.tier == "Low").sum() >= 5]
    wins = [qs for qs, g in qq if g.y[g.tier == "High"].mean() > g.y[g.tier == "Low"].mean()]
    r["quarters High>Low"] = f"{len(wins)} of {len(qq)}"
    r["eligible quarters"] = ", ".join(f"{qs.year}Q{(qs.month - 1) // 3 + 1}{'' if qs in wins else ' (lost)'}" for qs, _ in qq)
    return r


rows = [block(g, str(y)) for y, g in d.groupby("year")]
rows += [block(d, "2021-26"), block(d[d.signal_date >= "2024-01-01"], "2024-26")]
out = pd.DataFrame(rows)
out.to_csv(OUT / "round3_final_years.csv", index=False)
pd.set_option("display.width", 250)
print(out.to_string(index=False))
