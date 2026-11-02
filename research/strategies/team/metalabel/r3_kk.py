"""Round 3 check (1): is the kk_dip tier's failure on ranks 301-500 real, or too few trades to judge?
Nothing re-tuned: the round-2 R2 labels (r2_pred / r2_cuts, forward-AUC gate 0.55) are reused as they are.
Reports, per universe and period: trades per tier, made% per tier, the High - Low gap with
  - a 95 % Wald interval (trades treated as independent),
  - a 95 % month-cluster bootstrap interval (whole months resampled, 2,000 draws: one episode counts once),
  - the smallest gap the sample could detect (80 % power, two-sided 5 %),
and the difference between the two universes' gaps (bootstrap, months resampled within each universe)."""
import numpy as np
import pandas as pd

import round2 as R

E = R.E
pred, cuts = pd.read_parquet(R.OUT / "r2_pred.parquet"), pd.read_parquet(R.OUT / "r2_cuts.parquet")
rng = np.random.default_rng(0)
DRAWS = 2000


def gap(g):
    h, l = g[g.tier == "High"].y, g[g.tier == "Low"].y
    return 100 * (h.mean() - l.mean()) if len(h) and len(l) else np.nan


def boot(g):
    months = g.signal_date.dt.to_period("M")
    groups = [x for _, x in g.groupby(months)]
    out = []
    for _ in range(DRAWS):
        s = pd.concat([groups[i] for i in rng.integers(0, len(groups), len(groups))])
        out.append(gap(s))
    return np.array(out)


rows, boots = [], {}
for uni in ("top300", "r301_500"):
    d = R.label(pred[(pred.uni == uni) & (pred.signal_date < E.END)].drop(columns="uni"), cuts)
    for per, lo in (("2021-26", E.START), ("2024-26", E.RECENT)):
        g = d[(d.rule == "kk_dip") & (d.signal_date >= lo)]
        n = g.tier.value_counts()
        m = g.groupby("tier").y.mean()
        nh, nl, ph, pl = n.get("High", 0), n.get("Low", 0), m.get("High"), m.get("Low")
        se = np.sqrt(ph * (1 - ph) / nh + pl * (1 - pl) / nl)
        pbar = (ph * nh + pl * nl) / (nh + nl)
        mde = 100 * 2.8 * np.sqrt(pbar * (1 - pbar) * (1 / nh + 1 / nl))
        b = boot(g)
        boots[(uni, per)] = b
        rows.append({"universe": uni, "period": per, "n High": nh, "n Normal": n.get("Normal", 0), "n Low": nl,
                     "months": g.signal_date.dt.to_period("M").nunique(),
                     "months with High": g[g.tier == "High"].signal_date.dt.to_period("M").nunique(),
                     "made High": round(100 * ph, 1), "made Low": round(100 * pl, 1), "gap": round(gap(g), 1),
                     "Wald 95%": f"[{100 * (ph - pl) - 196 * se:+.1f}, {100 * (ph - pl) + 196 * se:+.1f}]",
                     "month-boot 95%": f"[{np.nanpercentile(b, 2.5):+.1f}, {np.nanpercentile(b, 97.5):+.1f}]",
                     "detectable gap (80% power)": round(mde, 1)})
pd.set_option("display.width", 250)
print(pd.DataFrame(rows).to_string(index=False))
for per in ("2021-26", "2024-26"):
    diff = boots[("top300", per)] - boots[("r301_500", per)]
    print(f"top300 gap - r301_500 gap, {per}: median {np.nanmedian(diff):+.1f}, 95 % [{np.nanpercentile(diff, 2.5):+.1f}, "
          f"{np.nanpercentile(diff, 97.5):+.1f}], share <= 0: {np.nanmean(diff <= 0):.3f}")
