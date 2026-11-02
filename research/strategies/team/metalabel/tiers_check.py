"""Robustness of the confidence tier on the dip rules (V18 HGB and V19 LR, forward-calibrated): per year, and with
quartile instead of tertile cut-offs. Read-only on the cached walk-forward predictions in out/."""
import numpy as np
import pandas as pd

import meta as M

pd.set_option("display.width", 200)
for kind in ("hgb", "lr"):
    pred, cuts = M.walk(kind=kind, cohort=True, fwd=True)
    d = M.decide(pred, cuts, policy="all")
    d = d[d.rule.isin(["rsi_dip", "kk_dip"])].assign(year=lambda x: x.signal_date.dt.year)
    print(f"\n== {kind.upper()} dip rules: made% (n) by tier and year")
    g = d.groupby(["rule", "year", "tier"]).agg(n=("y", "size"), made=("y", "mean"), avg=("net", "mean"))
    g["cell"] = [f"{100*m:.0f}% ({n}) {100*a:+.1f}" for n, m, a in zip(g.n, g.made, g.avg)]
    print(g.cell.unstack("tier").to_string())
    # reliability on dip rules only
    x = d[d.p.notna()].copy()
    x["bucket"] = pd.cut(x.p, [0, .55, .6, .65, .7, .75, .8, 1])
    print("dip reliability:\n", x.groupby("bucket", observed=True).agg(n=("y", "size"), mean_p=("p", "mean"),
                                                                       made=("y", "mean")).round(3).to_string())
    # quartile tiers: top quarter vs bottom quarter (cut-offs from training OOF quantiles 25/75 are not stored;
    # use the stored 20 / 40 % cuts and the 67 % cut as a coarse check)
    for lo in ("cut_20", "cut_40"):
        low = d[d.p.notna() & (d.p < d[lo])]
        print(f"  below training {lo}: n {len(low)} made {100*low.y.mean():.1f}% avg {100*low.net.mean():+.2f}%")
t = M.load()
print("\nshared-dataset caveat: trend trades by signal year, made% (trades still open at the end are not in the file)")
print(t[t.rule.isin(["strong_trend", "sma_trend"])].groupby([t.signal_date.dt.year, "rule"]).y.agg(["size", "mean"])
      .round(2).unstack().tail(3).to_string())
