# ROUND-3 PLAN (researcher "regime"), written before any round-3 number was computed. Rules: team/ROUND3.md.
#
# Object under test: D*'s rsi_dip tier = metalabel R2 (LR, complete cohorts, forward calibration, shown only in quarters
# whose forward self-test AUC >= 0.55), rebuilt READ-ONLY from metalabel/out/r2_pred.parquet + r2_cuts.parquet with the
# exact logic of metalabel/round2.py label(): shown = p and cuts known & oof_auc >= 0.55 & cut_hi > cut_lo;
# High if p >= cut_hi, Low if p < cut_lo, else Normal. Universes: top 300 and the independent ranks 301-500.
#
# (a) Is High one kind of stock or day?
#   Mix: share of High, Low and all rsi_dip signals by sector, year, weather (sunny / mixed / stormy) and size third
#   (point-in-time traded-value rank inside the year's list, same ranking as fair.pit_universe).
#   Stratified: High - Low made% inside sunny days and inside non-sunny days; inside each size third.
#   Two one-feature rules (no more), same tertile idea, evaluated on the SAME signals:
#     S1 "biggest stocks": High = top third of that year's list by traded value, Low = bottom third (direction fixed
#        now: bigger = High; on ranks 301-500 the thirds are taken inside that band).
#     S2 "the checker's top feature": the one BASE feature with the largest |standardised coefficient| in an LR
#        (C = 0.05, median-impute, standardise) fitted on rsi_dip trades signalled before 2020-12-04 (2021-01-01 minus
#        embargo 7 + hold 21 days), i.e. before any scored quarter; its sign fixes the direction; High / Low = above the
#        67th / below the 33rd percentile of that feature in each quarter's complete-cohort training rsi trades.
#   Each scored (i) on the quarters where the tier is shown and (ii) on all quarters, both periods, both universes;
#   null = labels shuffled within year, 1,000 draws. A rule "matches" the tier if its High - Low gap is within 3 points
#   of the tier's (or larger) in both periods on the top 300.
# (b) The 2025 reversal and the gate: per quarter, gate on/off, n High / Low, High - Low made% (both universes); per
#   year. "Live record" a beginner would see: at each quarter start, the tier's own complete-cohort record (High vs Low
#   made% over all earlier shown quarters, signals older than 28 days). Count quarters where that record showed
#   High > Low by >= 5 points but the quarter's own High - Low gap was negative, and how many signals were in them.
"""Round 3 for researcher "regime": stress test of D*'s rsi_dip tier (plan above). Read-only outside team/regime/."""
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")
HERE = Path(__file__).resolve().parent
TEAM = HERE.parent
sys.path.insert(0, str(TEAM))
import evaluate as E  # noqa: E402

pd.set_option("display.width", 220)
ML = TEAM / "metalabel" / "out"
BASE = ["d200", "d50", "d20", "slope200", "rsi14", "rsi2", "atrpct", "volratio", "rs_rank", "r5", "r20", "r126",
        "dist_hi252", "clv", "gap", "sector_rank", "nifty_d200", "nifty_r20", "vix", "vix_chg5", "wx",
        "breadth50", "breadth200"]
LAG = pd.Timedelta(days=28)                       # embargo 7 + rsi_dip holding span 21
PERIODS = (("2021-26", E.START), ("2024-26", E.RECENT))
RNG = np.random.default_rng(31)


def tiers():
    pred, cuts = pd.read_parquet(ML / "r2_pred.parquet"), pd.read_parquet(ML / "r2_cuts.parquet")
    d = pred[pred.rule == "rsi_dip"].merge(cuts, left_on=["qstart", "rule"], right_on=["Q", "rule"], how="left")
    has = d.p.notna() & d.cut_lo.notna()
    d["shown"] = has & (d.oof_auc >= 0.55) & (d.cut_hi > d.cut_lo + 1e-12)
    d["tier"] = np.where(d.shown & (d.p >= d.cut_hi), "High", np.where(d.shown & (d.p < d.cut_lo), "Low", "Normal"))
    d = d[(d.signal_date >= E.START) & (d.signal_date < E.END)].reset_index(drop=True)
    t = E.load()
    feats = pd.concat([t[t.rule == "rsi_dip"].assign(uni="top300"),
                       pd.read_parquet(ML / "r2_ext_trades.parquet").query("rule == 'rsi_dip'")])
    d = d.merge(feats[["uni", "symbol", "signal_date"] + [c for c in BASE if c != "wx"]],
                on=["uni", "symbol", "signal_date"], how="left")
    return d


def size_rank():
    """Point-in-time traded-value position per (year, symbol), as fair.pit_universe / metalabel round2.pit_ranks."""
    raw = pd.read_parquet(TEAM.parent / "data" / "candles.parquet")
    raw = raw.dropna(subset=["open", "high", "low", "close"])
    raw = raw[(raw.close > 0) & (raw.open > 0) & ~raw.symbol.str.startswith("^")]
    raw["tv"] = raw.close * raw.volume
    n = raw.groupby("symbol").size()
    raw = raw[raw.symbol.isin(n[n >= 300].index)]
    out = {}
    for y in range(2021, 2027):
        lo = pd.Timestamp(f"{y}-01-01")
        w = raw[(raw.date < lo) & (raw.date >= lo - pd.Timedelta(days=183))]
        g = w.groupby("symbol").tv.agg(["size", "median"])
        g = g[g["size"] > 100].sort_values("median", ascending=False)
        out.update({(y, s): i for i, s in enumerate(g.index)})
    return out


def gap(y, lab):
    a, b = y[lab == "High"], y[lab == "Low"]
    return 100 * (a.mean() - b.mean()) if len(a) and len(b) else np.nan


def gap_null(d, col, draws=1000):
    y, lab, yr = d.y.to_numpy(), d[col].to_numpy(), d.signal_date.dt.year.to_numpy()
    real = gap(y, lab)
    cells = [np.flatnonzero(yr == v) for v in np.unique(yr)]
    sims = np.empty(draws)
    for j in range(draws):
        l2 = lab.copy()
        for ix in cells:
            l2[ix] = lab[RNG.permutation(ix)]
        sims[j] = gap(y, l2)
    return real, (np.sum(sims >= real) + 1) / (draws + 1)


def block(d, col, title):
    rows = []
    for uni in ("top300", "r301_500"):
        for scope in ("shown quarters", "all quarters"):
            for per, lo in PERIODS:
                g = d[(d.uni == uni) & (d.signal_date >= lo)]
                if scope == "shown quarters":
                    g = g[g.shown]
                g_, p = gap_null(g, col)
                rows.append({"universe": uni, "scope": scope, "period": per, "n High": int((g[col] == "High").sum()),
                             "n Low": int((g[col] == "Low").sum()),
                             "made High": round(100 * g.y[g[col] == "High"].mean(), 1),
                             "made Low": round(100 * g.y[g[col] == "Low"].mean(), 1), "gap": round(g_, 1), "p": round(p, 3)})
    out = pd.DataFrame(rows)
    print(f"\n=== {title}\n{out.to_string(index=False)}")
    return out


def share(d, by):
    x = pd.crosstab(d[by], d.tier, normalize="columns").mul(100).round(0)
    x["all rsi"] = (d[by].value_counts(normalize=True) * 100).round(0)
    return x


if __name__ == "__main__":
    d = tiers()
    print("rsi_dip signals:", d.groupby("uni").size().to_dict(), "| tier counts:", d.groupby(["uni", "tier"]).size().to_dict())
    sec = pd.read_csv(TEAM.parent / "data" / "universe.csv").drop_duplicates("symbol").set_index("symbol").sector
    d["sector"] = d.symbol.map(sec).fillna("Other")
    d["year"] = d.signal_date.dt.year
    d["weather"] = d.wx.map({0: "stormy", 1: "mixed", 2: "sunny"})
    pos = size_rank()
    d["pos"] = [pos.get((y, s), np.nan) for y, s in zip(d.year, d.symbol)]
    band = np.where(d.uni == "top300", d.pos, d.pos - 300)
    span = np.where(d.uni == "top300", 300, 200)
    d["size3"] = np.where(band < span / 3, "big", np.where(band < 2 * span / 3, "mid", "small"))
    print("size rank missing:", int(d.pos.isna().sum()))

    # ---------------------------------------------------- (a) mix
    sh = d[d.shown & (d.uni == "top300")]
    for by in ("year", "weather", "size3", "sector"):
        print(f"\n--- top 300, shown quarters: share of each tier by {by} (%)\n" + share(sh, by).to_string())
    print("\n--- share of High by universe x year (all signals):")
    print(d.groupby(["uni", "year"]).tier.apply(lambda x: f"{(x == 'High').sum()}/{len(x)}").unstack().to_string())

    rows = []
    for uni in ("top300", "r301_500"):
        for per, lo in PERIODS:
            g = d[(d.uni == uni) & d.shown & (d.signal_date >= lo)]
            r = {"universe": uni, "period": per}
            for lab, m in (("sunny", g.weather == "sunny"), ("not sunny", g.weather != "sunny"),
                           ("big", g.size3 == "big"), ("mid", g.size3 == "mid"), ("small", g.size3 == "small")):
                gg = g[m]
                r[lab] = f"{gap(gg.y.to_numpy(), gg.tier.to_numpy()):+.1f} ({(gg.tier == 'High').sum()}/{(gg.tier == 'Low').sum()})"
            rows.append(r)
    print("\n--- tier High - Low made% INSIDE each group, shown quarters (n High / n Low)\n" + pd.DataFrame(rows).to_string(index=False))

    tier_tab = block(d, "tier", "D* tier (High - Low made%), null = shuffle within year")

    # ---------------------------------------------------- one-feature rules
    d["S1"] = np.where(d.size3 == "big", "High", np.where(d.size3 == "small", "Low", "Normal"))
    s1 = block(d, "S1", "S1 biggest stocks (High = top third by traded value, Low = bottom third)")

    t = E.load()
    tr = t[(t.rule == "rsi_dip") & (t.signal_date < E.START - LAG)]
    lr = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(C=0.05, max_iter=2000))
    lr.fit(tr[BASE], (tr.net > 0).astype(int))
    coef = pd.Series(lr[-1].coef_[0], BASE).sort_values(key=np.abs, ascending=False)
    top, sign = coef.index[0], np.sign(coef.iloc[0])
    print(f"\nS2: LR on {len(tr)} rsi_dip trades signalled before {(E.START - LAG).date()}; top standardised coefficients:")
    print(coef.head(6).round(3).to_string())
    z = sign * (d[top] if top != "wx" else d.wx)
    lab = np.full(len(d), "Normal", dtype=object)
    for q0, ix in d.groupby("qstart").groups.items():
        trq = t[(t.rule == "rsi_dip") & (t.signal_date < q0 - LAG)]
        zt = sign * trq[top]
        lo_, hi_ = np.nanquantile(zt, 1 / 3), np.nanquantile(zt, 2 / 3)
        zz = z.loc[ix].to_numpy()
        lab[np.asarray(ix)] = np.where(zz >= hi_, "High", np.where(zz < lo_, "Low", "Normal"))
    d["S2"] = lab
    s2 = block(d, "S2", f"S2 one feature: {'+' if sign > 0 else '-'}{top} (training tertiles each quarter)")
    print("\n--- overlap: share of the tier's High that S2 also calls High (shown quarters):",
          {u: round(100 * (g.S2[g.tier == "High"] == "High").mean()) for u, g in d[d.shown].groupby("uni")})

    # ---------------------------------------------------- (b) per quarter, per year, live record
    q = []
    for q0, g in d.groupby("qstart"):
        row = {"q": q0.to_period("Q"), "shown": bool(g.shown.any())}
        for uni in ("top300", "r301_500"):
            gg = g[g.uni == uni]
            row[f"{uni} H/L"] = f"{(gg.tier == 'High').sum()}/{(gg.tier == 'Low').sum()}"
            row[f"{uni} gap"] = round(gap(gg.y.to_numpy(), gg.tier.to_numpy()), 1)
        gb = g
        row["top500 gap"] = round(gap(gb.y.to_numpy(), gb.tier.to_numpy()), 1)
        past = d[d.shown & (d.signal_date < q0 - LAG)]
        row["live record H"] = round(100 * past.y[past.tier == "High"].mean(), 1) if (past.tier == "High").any() else np.nan
        row["live record L"] = round(100 * past.y[past.tier == "Low"].mean(), 1) if (past.tier == "Low").any() else np.nan
        q.append(row)
    q = pd.DataFrame(q)
    print("\n--- per quarter (top 500 = both universes)\n" + q.to_string(index=False))
    rec = q["live record H"] - q["live record L"]
    bad = q[q.shown & (rec >= 5) & (q["top500 gap"] < 0)]
    print(f"\nquarters where the public record said High beats Low by >= 5 but the quarter's own gap was negative: "
          f"{len(bad)} of {int(q.shown.sum())} shown -> {list(bad.q.astype(str))}")
    yr = d[d.shown].groupby(["year"]).apply(lambda g: pd.Series({
        "n High": int((g.tier == "High").sum()), "made High": round(100 * g.y[g.tier == "High"].mean(), 1),
        "made Low": round(100 * g.y[g.tier == "Low"].mean(), 1), "made all": round(100 * g.y.mean(), 1),
        "gap": round(gap(g.y.to_numpy(), g.tier.to_numpy()), 1)}), include_groups=False)
    print("\n--- per year, shown quarters, top 500\n" + yr.to_string())
    pd.concat([tier_tab.assign(rule="tier"), s1.assign(rule="S1"), s2.assign(rule="S2")]).to_csv(HERE / "round3_rules.csv", index=False)
    q.to_csv(HERE / "round3_quarters.csv", index=False)
