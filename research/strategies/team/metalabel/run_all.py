"""Runs every pre-registered variant (PLAN.md) and the robustness checks. Scores only with team/evaluate.py.

    cd research/strategies/team/metalabel && python run_all.py > out/run_all.txt
"""
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

import meta as M
E = M.E

VARIANTS = [  # (id, label, walk kwargs, decide kwargs)
    (1, "PRIMARY  HGB + skip (profit-max cut)", dict(kind="hgb"), dict(policy="profit")),
    (2, "LR + skip (profit-max cut)", dict(kind="lr"), dict(policy="profit")),
    (3, "TREE d3 + skip (profit-max cut)", dict(kind="tree"), dict(policy="profit")),
    (4, "HGB + skip bottom 20 %", dict(kind="hgb"), dict(policy="20")),
    (5, "LR + skip bottom 20 %", dict(kind="lr"), dict(policy="20")),
    (6, "HGB take all, Low tier half size", dict(kind="hgb"), dict(policy="all", size_tier=True)),
    (7, "HGB skip (profit) + Low half size", dict(kind="hgb"), dict(policy="profit", size_tier=True)),
    (8, "HGB |net|-weighted + skip (profit)", dict(kind="hgb", wcol="absnet"), dict(policy="profit")),
    (9, "HGB no derived feats + skip (profit)", dict(kind="hgb", derived=False), dict(policy="profit")),
    (10, "HGB rolling 3y window + skip (profit)", dict(kind="hgb", window_years=3), dict(policy="profit")),
    ("11a", "HGB embargo 0 + skip (profit)", dict(kind="hgb", emb_sessions=0), dict(policy="profit")),
    ("11b", "HGB embargo 20 + skip (profit)", dict(kind="hgb", emb_sessions=20), dict(policy="profit")),
    (12, "INFO ONLY daily hit-rate HGB + skip (profit)", dict(kind="hgb", daily_hr=True), dict(policy="profit")),
    # Amendment A (PLAN.md): complete-cohort training
    (13, "COHORT HGB + skip (profit-max cut)", dict(kind="hgb", cohort=True), dict(policy="profit")),
    (14, "COHORT LR + skip (profit-max cut)", dict(kind="lr", cohort=True), dict(policy="profit")),
    (15, "COHORT HGB + skip bottom 20 %", dict(kind="hgb", cohort=True), dict(policy="20")),
    (16, "COHORT LR + skip bottom 20 %", dict(kind="lr", cohort=True), dict(policy="20")),
    (17, "COHORT HGB take all, Low tier half size", dict(kind="hgb", cohort=True), dict(policy="all", size_tier=True)),
    # Amendment B (PLAN.md): forward-only OOF + monotone calibration (+ cohort training)
    (18, "FWD HGB + skip (profit-max cut)", dict(kind="hgb", cohort=True, fwd=True), dict(policy="profit")),
    (19, "FWD LR + skip (profit-max cut)", dict(kind="lr", cohort=True, fwd=True), dict(policy="profit")),
    (20, "FWD HGB + skip bottom 20 %", dict(kind="hgb", cohort=True, fwd=True), dict(policy="20")),
    (21, "FWD LR + skip bottom 20 %", dict(kind="lr", cohort=True, fwd=True), dict(policy="20")),
    (22, "FWD HGB take all, Low tier half size", dict(kind="hgb", cohort=True, fwd=True),
     dict(policy="all", size_tier=True)),
    (23, "FWD HGB exit-based training + skip (profit)", dict(kind="hgb", fwd=True), dict(policy="profit")),
    # Amendment C: the checker acts on a rule only when its own forward check in training shows skill (AUC >= .55)
    (24, "FWD HGB + self-gated skip 20 %", dict(kind="hgb", cohort=True, fwd=True), dict(policy="20", gate_auc=0.55)),
    (25, "FWD LR + self-gated skip 20 %", dict(kind="lr", cohort=True, fwd=True), dict(policy="20", gate_auc=0.55)),
]


def line(rep, period):
    a = rep[(rep.period == period) & (rep.rule == "ALL")].iloc[0]
    per = rep[(rep.period == period) & (rep.rule != "ALL")].set_index("rule")["vs static sum%"]
    return (f"kept {a.kept:.2f} made {a['made%']:.1f} ({a['vs static made%']:+.1f}) avg {a['avg%']:+.2f} "
            f"sum {a['sum%']:.0f} ({a['vs static sum%']:+.0f}) | per-rule dsum " +
            " ".join(f"{r[:5]} {v:+.0f}" for r, v in per.items()))


def calib(pred, cuts):
    d = pred.merge(cuts[["Q", "rule", "base"]], left_on=["qstart", "rule"], right_on=["Q", "rule"])
    d = d[d.p.notna()]
    rows = []
    for name, g in [("ALL", d)] + [(r, d[d.rule == r]) for r in M.RULES]:
        b = ((g.p - g.y) ** 2).mean()
        b0 = ((g.base - g.y) ** 2).mean()
        rows.append({"rule": name, "n": len(g), "AUC": round(roc_auc_score(g.y, g.p), 3),
                     "Brier": round(b, 4), "Brier_base": round(b0, 4), "BSS%": round(100 * (1 - b / b0), 1),
                     "mean_p": round(g.p.mean(), 3), "made": round(g.y.mean(), 3)})
    return pd.DataFrame(rows)


def reliability(pred):
    d = pred[pred.p.notna()].copy()
    d["bucket"] = pd.cut(d.p, [0, .4, .5, .6, .7, .8, 1.0])
    return d.groupby("bucket", observed=True).agg(n=("y", "size"), mean_p=("p", "mean"), made=("y", "mean"),
                                                  avg_net=("net", "mean")).round(3)


def auc_by_year(pred):
    d = pred[pred.p.notna()].assign(year=lambda x: x.signal_date.dt.year)
    out = {}
    for (r, yr), g in d.groupby(["rule", "year"]):
        out[(r, yr)] = round(roc_auc_score(g.y, g.p), 2) if g.y.nunique() == 2 else np.nan
    return pd.Series(out).unstack()


def tiers(dec):
    rows = []
    for period, lo in (("2021-26", E.START), ("2024-26", E.RECENT)):
        g = dec[dec.signal_date >= lo]
        for (r, tier), h in g.groupby(["rule", "tier"]):
            rows.append({"period": period, "rule": r, "tier": tier, "n": len(h), "made%": round(100 * h.y.mean(), 1),
                         "avg%": round(100 * h.net.mean(), 2), "sum%": round(100 * h.net.sum(), 0)})
        for tier, h in g.groupby("tier"):
            rows.append({"period": period, "rule": "ALL", "tier": tier, "n": len(h),
                         "made%": round(100 * h.y.mean(), 1), "avg%": round(100 * h.net.mean(), 2),
                         "sum%": round(100 * h.net.sum(), 0)})
    return pd.DataFrame(rows).pivot_table(index=["period", "rule"], columns="tier", values=["n", "made%", "avg%"])


def per_year(dec):
    base = E.baseline()
    rows = []
    for yr in range(2021, 2027):
        for r in M.RULES + ["ALL"]:
            g = dec[(dec.signal_date.dt.year == yr) & ((dec.rule == r) | (r == "ALL"))]
            b = base[(base.signal_date.dt.year == yr) & ((base.rule == r) | (r == "ALL"))]
            x, s = E._block(g, len(b)), E._block(b, len(b))
            rows.append({"year": yr, "rule": r, "kept": x["kept"], "made%": x["made%"],
                         "dmade": round(x["made%"] - s["made%"], 1), "sum%": x["sum%"],
                         "dsum": round(x["sum%"] - s["sum%"], 0)})
    return pd.DataFrame(rows)


def null_skip(dec, draws=500, seed=0):
    """Skip the same number of signals per (rule, quarter) at random; ALL 2021-26 made% / sum% change."""
    rng = np.random.default_rng(seed)
    d = dec.reset_index(drop=True)
    y, net = d.y.to_numpy(), d.net.to_numpy()
    groups = [(g.index.to_numpy(), int((~g["take"]).sum())) for _, g in d.groupby(["rule", "qstart"])]
    m0, s0 = 100 * y.mean(), 100 * net.sum()
    dm, ds = [], []
    for _ in range(draws):
        keep = np.ones(len(d), bool)
        for idx, k in groups:
            if k:
                keep[rng.choice(idx, k, replace=False)] = False
        dm.append(100 * y[keep].mean() - m0)
        ds.append(100 * net[keep].sum() - s0)
    real_m = 100 * y[d["take"].to_numpy()].mean() - m0
    real_s = 100 * net[d["take"].to_numpy()].sum() - s0
    return {"method dmade": round(real_m, 2), "null dmade p50/p95": (round(np.percentile(dm, 50), 2),
            round(np.percentile(dm, 95), 2)), "share null >= method": round(np.mean(np.array(dm) >= real_m), 3),
            "method dsum": round(real_s, 0), "null dsum p5/p50/p95": tuple(np.round(np.percentile(ds, [5, 50, 95])))}


if __name__ == "__main__":
    pd.set_option("display.width", 200)
    E.report(E.baseline(), "STATIC BASELINE")
    summary, decs = [], {}
    for vid, label, wk, dk in VARIANTS:
        pred, cuts = M.walk(**wk)
        dec = M.decide(pred, cuts, **dk)
        decs[vid] = (dec, pred, cuts)
        rep = E.report(dec, f"V{vid} {label}")
        cal = calib(pred, cuts).set_index("rule")
        summary.append((vid, label, line(rep, "2021-26"), line(rep, "2024-26"), cal.loc["ALL", "AUC"],
                        cal.loc["ALL", "BSS%"]))
    print("\n\n=== SUMMARY (ALL rules; made% and sum% vs static in brackets)")
    for vid, label, a, b, auc, bss in summary:
        print(f"V{vid:<4} {label:<46} OOS AUC {auc:.3f} BSS {bss:+.1f}%\n      2021-26 {a}\n      2024-26 {b}")

    for vid in (1, 2, 13, 14, 18, 19, 24, 25):
        dec, pred, cuts = decs[vid]
        print(f"\n\n######## ROBUSTNESS V{vid}")
        print("calibration (OOS):\n", calib(pred, cuts).to_string(index=False))
        print("reliability (OOS, all rules):\n", reliability(pred).to_string())
        print("AUC by rule x year:\n", auc_by_year(pred).to_string())
        print("chosen skip share q (profit-max) by rule, per quarter:\n",
              cuts.pivot(index="Q", columns="rule", values="q_profit").to_string())
        print("per year:\n", per_year(dec).pivot(index="year", columns="rule", values=["dmade", "dsum"]).to_string())
        print("tiers (OOS):\n", tiers(dec).round(2).to_string())
        print("null random skip:", null_skip(dec))
        kind = "hgb" if vid in (1, 13, 18, 24) else "lr"
        print("threshold sensitivity (fixed skip share):")
        for x in ("10", "20", "30", "40"):
            rep = E.report(M.decide(pred, cuts, policy=x), f"{kind} skip {x}%", show=False)
            print(f"  {kind} skip {x}%  2021-26 {line(rep, '2021-26')}\n               2024-26 {line(rep, '2024-26')}")
