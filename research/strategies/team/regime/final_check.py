"""Final ratification check (regime): the rsi_dip tier shown whenever the calibration slope > 0 (D**), per year and
quarter, from params' saved round-3 outputs (read-only). Same quarter count and 2025 view as round3.py."""
import pandas as pd, numpy as np
from pathlib import Path
P = Path(__file__).resolve().parent.parent / "params" / "out"
t = pd.read_parquet(P / "round3_rsi_tier.parquet")
c = pd.read_csv(P / "round3_quarters.csv", parse_dates=["Q"])
d = t.merge(c, left_on="q", right_on="Q", how="left", suffixes=("", "_q"))
on = (d.slope > 0) & (d.cut_hi > d.cut_lo + 1e-12)
d["tierS"] = np.where(on & (d.p >= d.cut_hi), "High", np.where(on & (d.p < d.cut_lo), "Low", "Normal"))
d["onS"], d["yr"] = on, d.signal_date.dt.year
g = lambda x: 100 * x.mean() if len(x) else np.nan
print("quarters shown (slope>0):", int(c[(c.slope > 0) & (c.cut_hi > c.cut_lo + 1e-12)].shape[0]), "of", len(c))
for lab, col, onc in (("D** slope>0", "tierS", "onS"), ("old AUC gate", "tier", "shown")):
    x = d[d[onc]]
    print(f"\n{lab}: per year (n High, made High / Low / all, gap)")
    for y, gg in x.groupby("yr"):
        h, l = gg.y[gg[col] == "High"], gg.y[gg[col] == "Low"]
        print(f"  {y}: n {len(h):3d}  High {g(h):5.1f}  Low {g(l):5.1f}  all {g(gg.y):5.1f}  gap {g(h) - g(l):+.1f}")
    q = x.groupby("q").apply(lambda gg: g(gg.y[gg[col] == "High"]) - g(gg.y[gg[col] == "Low"]), include_groups=False)
    nh = x.groupby("q").apply(lambda gg: (gg[col] == "High").sum(), include_groups=False)
    print(f"  quarters High>Low: {(q > 0).sum()} of {q.notna().sum()}; with >=5 High: "
          f"{((q > 0) & (nh >= 5)).sum()} of {(q.notna() & (nh >= 5)).sum()}")
    print("  per quarter gap (n High):", {str(k.date()): f"{v:+.0f} ({nh[k]})" for k, v in q.items()})
