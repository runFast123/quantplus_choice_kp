"""Round-2 checks (not new candidates): (1) robustness of R2: bucket window 20 / 60 and per year; (2) critique checks of
the other candidates under the SAME display bar and matched rule x year null: metalabel's tiers (from its saved
cohort + forward-calibrated LR predictions, read-only) and regime's market state as a label.

    cd research/strategies/team/health && python round2_checks.py
"""
import numpy as np
import pandas as pd

import round2 as R
from round2 import E, RULES, prep, shuffle, risk, DRAWS

pd.set_option("display.width", 200)
ML = E.D.parent / "team" / "metalabel" / "out"


def gap_test(d0, col, order, name, rules=None):
    """made% of the best minus the worst label group (>= 30 trades), matched rule x year null, both periods."""
    rows = []
    d0 = d0 if rules is None else d0[d0.rule.isin(rules)]
    for per, lo in (("2021-26", E.START), ("2024-26", E.RECENT)):
        d, cells, q, o = prep(d0, lo)
        lab, win = d[col].to_numpy(), (d.net > 0).to_numpy()

        def g(l):
            m = [100 * win[l == k].mean() for k in order if (l == k).sum() >= 30]
            return max(m) - min(m) if len(m) >= 2 else np.nan
        real = g(lab)
        rng = np.random.default_rng(5)
        sims = np.array([g(shuffle(lab, cells, rng)) for _ in range(DRAWS)])
        made = {k: f"{100 * win[lab == k].mean():.1f} ({(lab == k).sum()})" for k in order if (lab == k).any()}
        rows.append({"label": name, "period": per, **made, "gap": round(real, 1), "null": round(np.nanmean(sims), 1),
                     "p": round(np.mean(sims >= real), 3)})
    return rows


if __name__ == "__main__":
    # (1) R2 robustness
    rows = []
    for nb in (20, 30, 60):
        R.NB = nb
        d = R.card(True, "wx")
        disp = R.display_test(d, f"R2 n={nb}")
        rk = R.risk_test(R.as_risk(d), f"R2 n={nb}")
        rows.append({"n": nb, "gap21": disp[0]["gap"], "p21": disp[0]["p"], "gap24": disp[1]["gap"], "p24": disp[1]["p"],
                     "worstQ": rk["worst Q"], "pQ": rk["p(null>=)"], "maxDD": rk["max DD"], "pDD": rk["p DD"],
                     "sum21 risk": E.report(R.as_risk(d), "", show=False).query("rule=='ALL'")["sum%"].tolist()})
        if nb == 30:
            d30 = R.as_risk(d)
    R.NB = 30
    print("=== R2 sensitivity to the bucket window (display gap / p, risk worst quarter / drawdown / p; static -974 / -1764)")
    print(pd.DataFrame(rows).to_string(index=False))
    b = d30[(d30.signal_date >= E.START)]
    py = b.assign(y=b.signal_date.dt.year, x=b.net * b["size"]).groupby("y").agg(
        risk_sum=("x", lambda v: round(100 * v.sum())), static_sum=("net", lambda v: round(100 * v.sum())))
    wq = b.assign(y=b.signal_date.dt.year, q=b.signal_date.dt.to_period("Q"), x=b.net * b["size"]).groupby(["y", "q"])
    py["risk worst Q"] = wq.x.sum().groupby("y").min().mul(100).round()
    py["static worst Q"] = wq.net.sum().groupby("y").min().mul(100).round()
    print("\n=== R2 risk layer per year (sum% and worst quarter)\n" + py.to_string())

    # (2a) metalabel tiers: LR, complete-cohort training, forward calibration (its Amendment B, the basis of V21/V26)
    p = pd.read_parquet(ML / "pred_lr_e5_d1_wNone_None_h0_cohort_fwd.parquet")
    c = pd.read_parquet(ML / "cuts_lr_e5_d1_wNone_None_h0_cohort_fwd.parquet")
    m = p.merge(c, left_on=["qstart", "rule"], right_on=["Q", "rule"], how="left")
    has = m.p.notna() & m.cut_lo.notna()
    m["tier"] = "Normal"
    m.loc[has & (m.p < m.cut_lo), "tier"] = "Low"
    m.loc[has & (m.p >= m.cut_hi) & (m.cut_hi > m.cut_lo + 1e-12), "tier"] = "High"
    m["exit_date"] = pd.to_datetime(m.exit_date)
    out = []
    for r in RULES:
        out += gap_test(m, "tier", ["High", "Normal", "Low"], f"C2 tier {r}", rules=[r])
    out += gap_test(m, "tier", ["High", "Normal", "Low"], "C2 tier dips", rules=["rsi_dip", "kk_dip"])
    # (2b) regime's market state as a label (C3)
    s = E.baseline()
    s["state"] = s.signal_date.map(R.G.label(R.G.market(), "R1")).fillna("na")
    st = ["up-calm", "up-nervous", "down-calm", "down-nervous"]
    out += gap_test(s, "state", st, "C3 state ALL")
    for r in RULES:
        out += gap_test(s, "state", st, f"C3 state {r}", rules=[r])
    print("\n=== critique checks: label separation (made% per group (trades)), matched rule x year null")
    print(pd.DataFrame(out).to_string(index=False))
