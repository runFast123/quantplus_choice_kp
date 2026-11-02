# ROUND-2 PLAN (researcher "regime"), written before any round-2 number was computed. Rules: team/ROUND2.md.
#
# Complete cohorts everywhere: at quarter start Q a rule learns only from signals with
#   signal_date < Q - 7 days (embargo) - HOLD[rule]   (HOLD = 100 calendar days trend, 21 dips; metalabel Amendment A)
# and the code asserts every such trade has exit_date < Q. Matched null = shuffle the label/skip WITHIN rule x year,
# 1,000 draws; p = share of draws at least as good. Episode null = the same shuffle WITHIN rule x month (timing removed).
#
# New variants (3, no more):
#  N1  C3 display, trend x fear (R1: Nifty vs 200-day x VIX vs its 1-year median). Per rule and state, shrunk made%
#      p_k = (wins_k + 50 p_r) / (n_k + 50) on complete cohorts. Label "better here" if p_k > p_r, "worse here" if
#      p_k < p_r (no record -> excluded, counted). Display bar: per rule, made%(better) - made%(worse) >= 5 points in
#      BOTH periods and p < 0.05 vs the rule x year null. Honesty check: Brier score of the displayed p_k vs the plain
#      rule record p_r on the out-of-sample signals (if p_k is no better, "X % in markets like today" misleads).
#  N2  same as N1 with the house weather (sunny / mixed / stormy) instead of trend x fear: a complete-cohort stand-in for
#      C1's grouping.
#  N3  filter, dip rules only: skip a dip signal only if metalabel's LR checker (cached cohort+forward predictions,
#      out/pred_lr_..._cohort_fwd) puts it below its training 20th percentile (V26's rule) AND N1 says "worse here".
#      Filter bar: rsi_dip and kk_dip made% up in both periods, sum% >= 90 % of static in both, p < 0.05 vs the
#      rule x year random-skip null.
#
# Checks on other members' strongest claims (not variants; their code / cached outputs, read-only):
#  H1  health V8 (rule x weather, as published): worst quarter and max drawdown vs (a) its own trade-level rule x year
#      null and (b) an episode null that moves V8's cuts between whole MONTHS within rule x year (each month gets
#      another month's average size). Also: how many separate quarters carry the cut.
#  H2  C1 rebuilt on complete cohorts (V8 logic, last 30 complete-cohort trades in today's weather, fallback last 50):
#      made%, sum%, worst quarter, drawdown vs static and the same two nulls.
#  M1  metalabel dip tiers (LR, cohort + forward): High - Low made% per rule and period vs the rule x year null and the
#      rule x month null; share of rule-months (>= 3 High and >= 3 Low) where High beat Low. V26's skip vs both nulls.
"""Round 2 for researcher "regime": the C3 display test, the episode checks on health and metalabel, and the 3
pre-registered variants above. Scoring with team/evaluate.py; writes only into team/regime/. Run from this folder."""
import importlib.util
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
TEAM = HERE.parent
sys.path.insert(0, str(TEAM))
import evaluate as E  # noqa: E402

pd.set_option("display.width", 220)
_spec = importlib.util.spec_from_file_location("regime_regimes", HERE / "regimes.py")
G = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(G)

HOLD = {"strong_trend": 100, "sma_trend": 100, "rsi_dip": 21, "kk_dip": 21}
EMB = 7
M_PRIOR = 50
DRAWS = 1000
QS = pd.date_range("2021-01-01", "2026-10-01", freq="QS")
DIPS = ["rsi_dip", "kk_dip"]
PERIODS = (("2021-26", E.START), ("2024-26", E.RECENT))

T = E.load()
T["y"] = (T.net > 0).astype(int)
OOS = T[(T.signal_date >= E.START) & (T.signal_date < E.END)].reset_index(drop=True)
MKT = G.market()


# ------------------------------------------------------------------ N1 / N2: state record on complete cohorts
def state_labels(states):
    """For each OOS signal: shrunk made% of its rule in today's state (p_k), the rule's record (p_r), label 1/0/-1."""
    st_all = states.reindex(T.signal_date).to_numpy()
    st_oos = states.reindex(OOS.signal_date).to_numpy()
    pk, pr, lab = np.full(len(OOS), np.nan), np.full(len(OOS), np.nan), np.full(len(OOS), -1)
    for q0 in QS:
        q1 = q0 + pd.offsets.QuarterBegin(startingMonth=1)
        for r in E.RULES:
            cut = q0 - pd.Timedelta(days=EMB + HOLD[r])
            m = ((T.rule == r) & (T.signal_date < cut)).to_numpy()
            assert (T.exit_date[m] < q0).all(), "a cohort trade was still open at the quarter start"
            if m.sum() < 20:
                continue
            y, s = T.y.to_numpy()[m], st_all[m]
            p_r = y.mean()
            g = pd.Series(y).groupby(s)
            p_state = ((g.sum() + M_PRIOR * p_r) / (g.size() + M_PRIOR)).to_dict()
            ix = np.flatnonzero(((OOS.rule == r) & (OOS.signal_date >= q0) & (OOS.signal_date < q1)).to_numpy())
            for i in ix:
                k = st_oos[i]
                pr[i] = p_r
                if k in p_state:
                    pk[i] = p_state[k]
                    lab[i] = 1 if p_state[k] > p_r + 1e-12 else (0 if p_state[k] < p_r - 1e-12 else -1)
    return pk, pr, lab


def perm_cells(keys):
    return [np.asarray(v) for v in pd.Series(np.arange(len(keys[0]))).groupby(keys).groups.values()]


def gap_test(y, lab, cells, rng, hi=1, lo=0, draws=DRAWS):
    """made%(lab==hi) - made%(lab==lo) and its null (lab shuffled within cells). Returns gap, null mean, p."""
    def gap(l):
        a, b = y[l == hi], y[l == lo]
        return 100 * (a.mean() - b.mean()) if len(a) and len(b) else np.nan
    real = gap(lab)
    sims = np.empty(draws)
    for j in range(draws):
        l2 = lab.copy()
        for ix in cells:
            l2[ix] = lab[rng.permutation(ix)]
        sims[j] = gap(l2)
    return real, np.nanmean(sims), np.mean(sims >= real - 1e-12)


def display_test(name, states, lab_name=("better", "worse")):
    pk, pr, lab = state_labels(states)
    rng = np.random.default_rng(2)
    rows = []
    for r in E.RULES:
        for per, lo in PERIODS:
            sel = ((OOS.rule == r) & (OOS.signal_date >= lo)).to_numpy()
            y, l = OOS.y.to_numpy()[sel], lab[sel]
            d = OOS[sel]
            cy = perm_cells([d.signal_date.dt.year.to_numpy()])
            cm = perm_cells([d.signal_date.dt.to_period("M").astype(str).to_numpy()])
            g, nm, p = gap_test(y, l, cy, rng)
            _, nm2, p2 = gap_test(y, l, cm, rng, draws=300)
            ok = ~np.isnan(pk[sel])
            b_state = np.mean((pk[sel][ok] - y[ok]) ** 2)
            b_rule = np.mean((pr[sel][ok] - y[ok]) ** 2)
            rows.append({"rule": r, "period": per, f"n {lab_name[0]}": int((l == 1).sum()),
                         f"n {lab_name[1]}": int((l == 0).sum()), "n none": int((l == -1).sum()),
                         f"made {lab_name[0]}": round(100 * y[l == 1].mean(), 1) if (l == 1).any() else np.nan,
                         f"made {lab_name[1]}": round(100 * y[l == 0].mean(), 1) if (l == 0).any() else np.nan,
                         "gap": round(g, 1), "null yr": round(nm, 1), "p yr": round(p, 3), "p month": round(p2, 3),
                         "Brier state": round(b_state, 4), "Brier rule": round(b_rule, 4)})
    out = pd.DataFrame(rows)
    print(f"\n=== {name}: display test (complete cohorts, m = {M_PRIOR}); passes if gap >= 5 in both periods and p yr < 0.05")
    print(out.to_string(index=False))
    return lab, out


# ------------------------------------------------------------------ metalabel tiers (cached, read-only)
def metalabel_frame():
    tag = "lr_e5_d1_wNone_None_h0_cohort_fwd"
    pred = pd.read_parquet(TEAM / "metalabel" / "out" / f"pred_{tag}.parquet")
    cuts = pd.read_parquet(TEAM / "metalabel" / "out" / f"cuts_{tag}.parquet")
    d = pred.merge(cuts, left_on=["qstart", "rule"], right_on=["Q", "rule"], how="left")
    has = d.p.notna() & d.cut_lo.notna()
    d["skip20"] = has & (d.p < d.cut_20)
    d["tier"] = "Normal"
    d.loc[has & (d.p < d.cut_lo), "tier"] = "Low"
    d.loc[has & (d.p >= d.cut_hi) & (d.cut_hi > d.cut_lo + 1e-12), "tier"] = "High"
    d = OOS[["rule", "symbol", "signal_date"]].merge(d[["rule", "symbol", "signal_date", "p", "skip20", "tier"]],
                                                     on=["rule", "symbol", "signal_date"], how="left")
    assert len(d) == len(OOS)
    return d


def filter_test(name, skip):
    """skip: bool array over OOS. evaluate.py report + random-skip nulls (rule x year and rule x month) on made%."""
    dec = OOS.assign(take=~skip)
    rep = E.report(dec, name)
    rng = np.random.default_rng(3)
    rows = []
    for r in DIPS + ["ALL"]:
        for per, lo in PERIODS:
            sel = ((OOS.signal_date >= lo) & ((OOS.rule == r) if r != "ALL" else True)).to_numpy()
            y, tk, d = OOS.y.to_numpy()[sel], ~skip[sel], OOS[sel]
            real = 100 * y[tk].mean()
            res = {"rule": r, "period": per, "made": round(real, 1)}
            for lab, key, n in (("yr", d.signal_date.dt.year.astype(str), DRAWS),
                                ("month", d.signal_date.dt.to_period("M").astype(str), 300)):
                cells = perm_cells([d.rule.to_numpy(), key.to_numpy()])
                sims = np.empty(n)
                for j in range(n):
                    t2 = tk.copy()
                    for ix in cells:
                        t2[ix] = tk[rng.permutation(ix)]
                    sims[j] = 100 * y[t2].mean()
                res[f"null {lab}"] = round(sims.mean(), 1)
                res[f"p {lab}"] = round(np.mean(sims >= real - 1e-12), 3)
            rows.append(res)
    out = pd.DataFrame(rows)
    print(f"--- {name}: random-skip nulls on made% (same number skipped per cell)")
    print(out.to_string(index=False))
    return rep, out


def tier_test(ml):
    rng = np.random.default_rng(4)
    rows = []
    for r in DIPS:
        for per, lo in PERIODS:
            sel = ((OOS.rule == r) & (OOS.signal_date >= lo)).to_numpy()
            y, d = OOS.y.to_numpy()[sel], OOS[sel]
            lab = ml.tier.to_numpy()[sel]
            lab = np.where(lab == "High", 1, np.where(lab == "Low", 0, -1))
            g, nm, p = gap_test(y, lab, perm_cells([d.signal_date.dt.year.to_numpy()]), rng)
            mon = d.signal_date.dt.to_period("M").astype(str).to_numpy()
            _, nm2, p2 = gap_test(y, lab, perm_cells([mon]), rng, draws=300)
            wins = tot = 0
            for mth in np.unique(mon):
                k = mon == mth
                a, b = y[k & (lab == 1)], y[k & (lab == 0)]
                if len(a) >= 3 and len(b) >= 3:
                    tot += 1
                    wins += a.mean() > b.mean()
            yrs = d.signal_date.dt.year.to_numpy()
            yr_gaps = [round(100 * (y[(yrs == yy) & (lab == 1)].mean() - y[(yrs == yy) & (lab == 0)].mean()), 1)
                       for yy in np.unique(yrs)]
            rows.append({"rule": r, "period": per, "n High": int((lab == 1).sum()), "n Low": int((lab == 0).sum()),
                         "made High": round(100 * y[lab == 1].mean(), 1), "made Low": round(100 * y[lab == 0].mean(), 1),
                         "gap": round(g, 1), "p yr": round(p, 3), "null month": round(nm2, 1), "p month": round(p2, 3),
                         "months High>Low": f"{wins}/{tot}", "gap by year": yr_gaps})
    out = pd.DataFrame(rows)
    print("\n=== M1 metalabel dip tiers (LR, cohort + forward): High - Low made%")
    print(out.to_string(index=False))
    return out


# ------------------------------------------------------------------ health V8 and C1 on complete cohorts
def risk_stats(d):
    """health's own measures (robust2.stats): ALL made%, sum%, worst quarter, max drawdown in exit order."""
    w = d["size"].where(d["take"], 0.0).to_numpy()
    net = d.net.to_numpy()
    made = 100 * (net[d["take"].to_numpy()] > 0).mean()
    s = 100 * (net * w).sum()
    q = pd.Series(net * w).groupby(d.signal_date.dt.to_period("Q").to_numpy()).sum().min() * 100
    o = np.argsort(d.exit_date.to_numpy(), kind="stable")
    c = np.cumsum((net * w)[o])
    return made, s, q, 100 * (c - np.maximum.accumulate(c)).min()


def risk_nulls(d, name):
    d = d[(d.signal_date >= E.START) & (d.signal_date < E.END)].reset_index(drop=True)
    real = risk_stats(d)
    base = risk_stats(d.assign(take=True, size=1.0))
    rng = np.random.default_rng(5)
    w = d["size"].where(d["take"], 0.0).to_numpy()
    yr = d.signal_date.dt.year.to_numpy()
    mon = d.signal_date.dt.to_period("M").astype(str).to_numpy()
    cells = perm_cells([d.rule.to_numpy(), yr])            # (a) health's null: sizes shuffled within rule x year
    sa = []
    for _ in range(DRAWS):
        w2 = w.copy()
        for ix in cells:
            w2[ix] = w[rng.permutation(ix)]
        sa.append(risk_stats(d.assign(size=w2, take=w2 > 0)))
    key = pd.DataFrame({"rule": d.rule, "yr": yr, "mon": mon, "w": w})   # (b) episode null: months swap their sizes
    mm = key.groupby(["rule", "yr", "mon"]).w.mean()
    tr_month = [np.flatnonzero(((key.rule == r) & (key.mon == m)).to_numpy()) for (r, _, m) in mm.index]
    pos = mm.reset_index().groupby(["rule", "yr"]).indices
    vals = mm.to_numpy()
    sb = []
    for _ in range(DRAWS):
        w2 = np.empty(len(d))
        for ix in pos.values():
            for a, b in zip(ix, rng.permutation(ix)):
                w2[tr_month[a]] = vals[b]
        sb.append(risk_stats(d.assign(size=w2, take=w2 > 0)))
    sa, sb = np.array(sa), np.array(sb)
    rows = []
    for i, lab in ((2, "worst quarter"), (3, "max drawdown"), (1, "sum%")):
        rows.append({"measure": lab, "static": round(base[i]), name: round(real[i]), "trade null": round(sa[:, i].mean()),
                     "p trade": round(np.mean(sa[:, i] >= real[i]), 3), "month null": round(sb[:, i].mean()),
                     "p month": round(np.mean(sb[:, i] >= real[i]), 3)})
    out = pd.DataFrame(rows)
    print(f"--- {name}: made% {real[0]:.1f} (static {base[0]:.1f}); nulls (p = share of random at least as good)")
    print(out.to_string(index=False))
    q = d.assign(w=w, q=d.signal_date.dt.to_period("Q")).groupby("q").apply(
        lambda g: pd.Series({"static": 100 * g.net.sum(), name: 100 * (g.net * g.w).sum()}), include_groups=False)
    q["cut"] = q[name] - q["static"]
    print("    five worst static quarters:\n" + q.sort_values("static").head(5).round(0).to_string())
    return out


def load_health_v8():
    sys.path.insert(0, str(TEAM / "health"))
    spec = importlib.util.spec_from_file_location("health_robust", TEAM / "health" / "robust.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    sys.path.pop(0)
    return mod.v8()


def c1_cohort(n_bucket=30, N=50, t_pause=-1.0):
    """H2: health V8's status logic, but only trades whose holding span has fully passed (complete cohorts)."""
    out = []
    for r in E.RULES:
        g = T[T.rule == r].sort_values("signal_date")
        sd, net, wx = g.signal_date.to_numpy(), g.net.to_numpy(), g.wx.to_numpy()
        for i in np.flatnonzero((g.signal_date >= E.START).to_numpy()):
            done = sd < sd[i] - np.timedelta64(EMB + HOLD[r], "D")
            w = net[done & (wx == wx[i])][-n_bucket:]
            if len(w) < n_bucket:
                w = net[done][-N:]
                if len(w) < 20:
                    out.append((g.index[i], 1.0))
                    continue
            m, se = w.mean(), w.std(ddof=1) / np.sqrt(len(w))
            out.append((g.index[i], 0.0 if (m < 0 and m / se < t_pause) else (0.5 if m < 0 else 1.0)))
    s = pd.Series(dict(out))
    d = T.loc[s.index].assign(size=s.to_numpy())
    d["take"] = d["size"] > 0
    return d.sort_values("signal_date").reset_index(drop=True)


if __name__ == "__main__":
    E.report(E.baseline(), "static rules (today)")
    lab1, n1 = display_test("N1 trend x fear", G.label(MKT, "R1"))
    lab2, n2 = display_test("N2 house weather", G.label(MKT, "R0"))
    ml = metalabel_frame()
    m1 = tier_test(ml)
    print("\n=== metalabel V26 (skip dip signals below the training 20th percentile) vs both nulls")
    v26_skip = (ml.skip20.fillna(False).to_numpy() & OOS.rule.isin(DIPS).to_numpy())
    filter_test("V26 metalabel (replicated)", v26_skip)
    print("\n=== N3: skip a dip signal only if V26 skips it AND N1 says 'worse here'")
    rep3, f3 = filter_test("N3 V26 AND state worse", v26_skip & (lab1 == 0))
    print("\n=== H1 health V8 as published (closed-trade feedback)")
    h1 = risk_nulls(load_health_v8(), "V8")
    print("\n=== H2 C1 rebuilt on complete cohorts")
    c1 = c1_cohort()
    E.report(c1, "H2 C1 on complete cohorts")
    h2 = risk_nulls(c1, "C1 cohort")
    pd.concat([n1.assign(test="N1"), n2.assign(test="N2")]).to_csv(HERE / "round2_display.csv", index=False)
    m1.to_csv(HERE / "round2_tiers.csv", index=False)
    pd.concat([h1.assign(test="H1 V8"), h2.assign(test="H2 C1 cohort")]).to_csv(HERE / "round2_risk.csv", index=False)
