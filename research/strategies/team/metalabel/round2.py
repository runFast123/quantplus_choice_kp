# =====================================================================================================================
# ROUND 2 PLAN — metalabel (pre-registered 2026-11-01, written before any run of this file; nothing below is re-tuned)
#
# Everything reuses the round-1 V26 machinery unchanged: logistic regression per rule (C = 0.05), complete-cohort
# training (signal_date < Q - 7 days embargo - holding span: 100 d trend / 21 d dip), forward-only 6-block OOF,
# monotone Platt calibration (slope clipped at >= 0), cut-offs from the training OOF only, quarterly retrain.
# Models are trained on team_trades.parquet (point-in-time top 300) ONLY.
#
# R1  V26 confirmatory test (filter). Dip rules only: skip a dip signal if p < the training 20th percentile; trend
#     signals always taken.
#     (a) top 300: evaluate.py rows + ROUND2 matched null: per (rule, year) skip the same number of that rule-year's
#         signals at random, 1,000 draws, seed 0; p = share of draws with made% >= the method's, per dip rule and
#         period.
#     (b) independent trades: the same two dip rules (exact record_dip.py code) on each year's point-in-time ranks
#         301-500 by traded value (same ranking code as fair.pit_universe), scored by the frozen quarterly models
#         trained on the top 300. Features from team_features.parquet; hr_rule = the top-300 checker's own value that
#         quarter; n_same_day = log(1 + top-300 same-rule signals that day + 1). Scored with evaluate._block (the
#         scorer's own function; report() is tied to the top-300 baseline). Same matched null.
#         Reproduction check first: the same code on ranks 1-300 must give team_trades' dip trades.
#     PASS (ROUND2 filter bar) only if, for BOTH dip rules: made% higher and sum% >= 90 % of static in 2021-26 AND
#     2024-26 on the top 300 AND on ranks 301-500, and the matched null p < 0.05 for each rule on the top 300 in both
#     periods and on ranks 301-500 in 2021-26.
# R2  C2 confidence tier (display, nothing hidden), all four rules. Tier from the same model: Low if p < training
#     33rd percentile, High if p >= 67th, else Normal; a rule's tier is shown in a quarter only if the checker's
#     forward self-test in training passed (forward-OOF AUC >= 0.55, the round-1 Amendment C gate); otherwise Normal.
#     Statistic: made%(High) - made%(Low) per rule, per period. Null: shuffle the labels within rule x year (counts
#     kept), 1,000 draws; p = share >= observed.
#     PASS (ROUND2 display bar a) per rule: gap >= 5 points in both periods and p < 0.05 in both; dip rules also on
#     ranks 301-500 (gap >= 5 and p < 0.05 in 2021-26).
# R3  C2 x C1: R2's label moved down one step (High -> Normal -> Low) when the rule x weather card, rebuilt on
#     complete cohorts and frozen at quarter start, is negative (mean net of the rule's last 30 complete-cohort trades
#     in the signal day's weather < 0; fewer than 30 -> the rule's last 50; fewer than 30 there -> no card).
#     Same statistic, null and bar as R2. Adopt R3 over R2 only if its High-Low gap is larger in both periods for
#     every rule where R2 passes (otherwise the simpler R2 wins).
# Read-only on everything outside team/metalabel/. Outputs: out/round2.txt, out/r2_ext_trades.parquet.
# =====================================================================================================================
"""Round 2 for metalabel: confirmatory test of V26, the C2 tier, and C2 x health card (see the plan above)."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

import meta as M

E = M.E
ROOT = Path(__file__).resolve().parents[2]            # research/strategies
sys.path.insert(0, str(ROOT))
import record_dip as RD  # noqa: E402  (import-safe: writes only under --live / __main__)

OUT = M.OUT
DIP = ["rsi_dip", "kk_dip"]
EMB = 7
RNG_DRAWS = 1000
START = pd.Timestamp("2019-07-01")                    # backtest.START


# ------------------------------------------------------------------ (b) independent trades: ranks 301-500
def stocks():
    raw = pd.read_parquet(ROOT / "data" / "candles.parquet")
    raw = raw.dropna(subset=["open", "high", "low", "close"])
    raw = raw[(raw.close > 0) & (raw.open > 0)]
    out = {}
    for s, f in raw[~raw.symbol.str.startswith("^")].groupby("symbol"):
        if len(f) >= 300:                              # backtest.stocks
            out[s] = f.sort_values("date").reset_index(drop=True)
    return out


def pit_ranks(st):
    """{year: [symbols ranked by median traded value over the 6 months before the year]} (fair.pit_universe)."""
    ranks = {}
    for y in range(2019, 2027):
        lo = pd.Timestamp(f"{y}-01-01") if y > 2019 else START
        tv = {}
        for s, f in st.items():
            w = f[(f.date < lo) & (f.date >= lo - pd.Timedelta(days=183))]
            if len(w) > 100:
                tv[s] = (w.close * w.volume).median()
        ranks[y] = sorted(tv, key=tv.get, reverse=True)
    return ranks


def dip_trades(st, ranks):
    rows = []
    for s, f in st.items():
        g = RD.frame(f[["date", "open", "high", "low", "close", "volume"]].copy())
        for rule in DIP:
            tr, _ = RD.trades(g, rule)
            for sd, ed, xd, e, px, how in tr:
                if px is None or sd < START:
                    continue
                r = ranks.get(sd.year, [])
                pos = r.index(s) if s in r else 10 ** 6
                uni = "top300" if pos < 300 else "r301_500" if pos < 500 else None
                if uni:
                    rows.append((rule, s, sd, ed, xd, px / e - 1 - RD.COST, how, uni))
    return pd.DataFrame(rows, columns=["rule", "symbol", "signal_date", "entry_date", "exit_date", "net", "how", "uni"])


def ext_frame(t300):
    fp = OUT / "r2_ext_trades.parquet"
    if fp.exists():
        return pd.read_parquet(fp)
    st = stocks()
    allt = dip_trades(st, pit_ranks(st))
    # reproduction check on ranks 1-300
    a = allt[allt.uni == "top300"]
    b = t300[t300.rule.isin(DIP)]
    m = a.merge(b, on=["rule", "symbol", "signal_date"], how="outer", indicator=True, suffixes=("", "_ref"))
    both = m[m._merge == "both"]
    print(f"reproduction ranks 1-300: mine {len(a)} ref {len(b)} matched {len(both)} "
          f"max|net diff| {(both.net - both.net_ref).abs().max():.1e}")
    x = allt[allt.uni == "r301_500"].copy()
    feats = pd.read_parquet(ROOT / "data" / "team_features.parquet")
    feats["date"] = pd.to_datetime(feats.date)
    x = x.merge(feats, left_on=["symbol", "signal_date"], right_on=["symbol", "date"], how="left").drop(columns="date")
    for c in ("entry_date", "exit_date", "signal_date"):
        x[c] = pd.to_datetime(x[c])
    x.to_parquet(fp, index=False)
    return x


# ------------------------------------------------------------------ the frozen quarterly LR checker (V19/V26 model)
def hr_table(t):
    """Complete-cohort hit rate (last 50) per (rule, quarter start), from the top-300 record (meta.hr_cohort)."""
    out = {}
    for r in M.RULES:
        a = t[t.rule == r].sort_values("signal_date")
        sd, y = a.signal_date.to_numpy(), a.y.to_numpy()
        for q in pd.date_range("2019-07-01", "2026-10-01", freq="QS"):
            idx = np.searchsorted(sd, np.datetime64(q - pd.Timedelta(days=EMB + M.HOLD[r])), side="left")
            n = min(idx, M.HR_N)
            out[(r, q)] = y[idx - n:idx].mean() if n >= 10 else np.nan
    return out


def card_table(t):
    """C1 rebuilt on complete cohorts, frozen at quarter start: {(rule, Q, wx): mean net or nan}."""
    out = {}
    for r in M.RULES:
        a = t[t.rule == r].sort_values("signal_date")
        for q in M.QS:
            done = a[a.signal_date < q - pd.Timedelta(days=EMB + M.HOLD[r])]
            fb = done.tail(50)
            for wx in (0.0, 1.0, 2.0):
                b = done[done.wx == wx].tail(30)
                out[(r, q, wx)] = b.net.mean() if len(b) >= 30 else (fb.net.mean() if len(fb) >= 30 else np.nan)
    return out


def walk_lr(t, ext):
    t = t.copy()
    hr = hr_table(t)
    t["hr_rule"] = [hr[(r, q)] for r, q in zip(t.rule, t.qstart)]
    t["hold"] = pd.to_timedelta(t.rule.map(M.HOLD), unit="D")
    ext = ext.copy()
    ext["y"] = (ext.net > 0).astype(int)
    ext["qstart"] = ext.signal_date.dt.to_period("Q").dt.start_time
    ext["hr_rule"] = [hr[(r, q)] for r, q in zip(ext.rule, ext.qstart)]
    n300 = t.groupby(["rule", "signal_date"]).size()
    ext["n_same_day"] = np.log1p([n300.get((r, d), 0) + 1 for r, d in zip(ext.rule, ext.signal_date)])
    feats = M.BASE + M.DERIVED
    res, cuts = [], []
    for Q in M.QS:
        Qn = Q + pd.offsets.QuarterBegin(startingMonth=1)
        tr = t[t.signal_date < Q - pd.Timedelta(days=EMB) - t.hold].sort_values("signal_date").reset_index(drop=True)
        assert (tr.exit_date < Q - pd.Timedelta(days=EMB)).all()
        oof = M.forward_oof("lr", tr, feats, EMB, None, True)
        cal = M.calibrators(tr.rule.to_numpy(), oof, tr.y.to_numpy(), monotone=True)
        p_oof = M.apply_cal(tr.rule.to_numpy(), oof, cal)
        for name, te in (("top300", t), ("r301_500", ext)):
            te = te[(te.signal_date >= Q) & (te.signal_date < Qn)].copy()
            if not len(te):
                continue
            te["p"] = M.apply_cal(te.rule.to_numpy(), M.raw_scores("lr", tr, te, feats), cal)
            te["uni"] = name
            res.append(te[["uni", "rule", "symbol", "signal_date", "exit_date", "net", "y", "wx", "p", "qstart"]])
        for r in M.RULES:
            m = (tr.rule == r).to_numpy() & ~np.isnan(p_oof)
            row = {"Q": Q, "rule": r, "n_train": int((tr.rule == r).sum())}
            if row["n_train"] >= M.MIN_RULE_TRAIN and m.sum() >= 50:
                pr = p_oof[m]
                row.update({"cut_20": np.quantile(pr, 0.2), "cut_lo": np.quantile(pr, 1 / 3),
                            "cut_hi": np.quantile(pr, 2 / 3), "oof_auc": M._auc(tr.y.to_numpy()[m], pr)})
            cuts.append(row)
    return pd.concat(res, ignore_index=True), pd.DataFrame(cuts)


# ------------------------------------------------------------------ decisions, labels, nulls
def label(d, cuts, card=None):
    d = d.merge(cuts, left_on=["qstart", "rule"], right_on=["Q", "rule"], how="left")
    has = d.p.notna() & d.cut_lo.notna()
    d["take"] = True
    dip = has & d.rule.isin(DIP)
    d.loc[dip, "take"] = d.p[dip] >= d.cut_20[dip]                               # R1 = V26
    shown = has & (d.oof_auc >= 0.55) & (d.cut_hi > d.cut_lo + 1e-12)           # R2 gate
    lvl = np.where(shown & (d.p >= d.cut_hi), 2, np.where(shown & (d.p < d.cut_lo), 0, 1))
    if card is not None:                                                          # R3
        neg = np.array([card.get((r, q, w), np.nan) < 0 for r, q, w in zip(d.rule, d.qstart, d.wx)])
        lvl = np.where(neg, np.maximum(lvl - 1, 0), lvl)
    d["tier"] = pd.Series(lvl, index=d.index).map({0: "Low", 1: "Normal", 2: "High"})
    return d


def made(x):
    return 100 * x.mean() if len(x) else np.nan


def null_skip(d, rule, lo, rng):
    g = d[(d.rule == rule) & (d.signal_date >= lo)].reset_index(drop=True)
    y, keep = g.y.to_numpy(), g["take"].to_numpy()
    grp = [(ix, int((~keep[ix]).sum())) for ix in g.groupby(g.signal_date.dt.year).indices.values()]
    real = made(y[keep])
    sims = []
    for _ in range(RNG_DRAWS):
        k = np.ones(len(g), bool)
        for ix, n in grp:
            if n:
                k[rng.choice(ix, n, replace=False)] = False
        sims.append(made(y[k]))
    sims = np.array(sims)
    return real, np.median(sims), (np.sum(sims >= real) + 1) / (RNG_DRAWS + 1)


def null_gap(d, rule, lo, rng):
    g = d[(d.rule == rule) & (d.signal_date >= lo)].reset_index(drop=True)
    y, tier = g.y.to_numpy(), g.tier.to_numpy()
    gap = made(y[tier == "High"]) - made(y[tier == "Low"])
    if np.isnan(gap):
        return gap, np.nan, np.nan, int((tier == "High").sum()), int((tier == "Low").sum())
    idx = list(g.groupby(g.signal_date.dt.year).indices.values())
    sims = []
    for _ in range(RNG_DRAWS):
        tt = tier.copy()
        for ix in idx:
            tt[ix] = rng.permutation(tt[ix])
        sims.append(made(y[tt == "High"]) - made(y[tt == "Low"]))
    sims = np.array(sims)
    sims = sims[~np.isnan(sims)]
    return gap, np.median(sims), (np.sum(sims >= gap) + 1) / (len(sims) + 1), int((tier == "High").sum()), \
        int((tier == "Low").sum())


def ext_rows(d):
    rows = []
    for per, lo in (("2021-26", E.START), ("2024-26", E.RECENT)):
        for r in DIP + ["DIP"]:
            g = d[(d.signal_date >= lo) & (d.signal_date < E.END) & ((d.rule == r) | (r == "DIP"))].copy()
            g["take"] = g["take"].astype(bool)
            s = g.assign(take=True)
            x, b = E._block(g, len(g)), E._block(s, len(g))
            rows.append({"period": per, "rule": r, **x, "static made%": b["made%"], "static sum%": b["sum%"],
                         "vs static made%": round(x["made%"] - b["made%"], 1),
                         "vs static sum%": round(x["sum%"] - b["sum%"], 0)})
    return pd.DataFrame(rows)


if __name__ == "__main__":
    pd.set_option("display.width", 220)
    t300 = M.load()
    ext = ext_frame(t300)
    print(f"ranks 301-500 dip trades: {len(ext)} ({ext[ext.signal_date >= E.START].groupby('rule').size().to_dict()} "
          f"from 2021); features missing {ext[M.BASE].isna().mean().max():.3f}")
    fp = OUT / "r2_pred.parquet"
    if fp.exists():
        pred, cuts = pd.read_parquet(fp), pd.read_parquet(OUT / "r2_cuts.parquet")
    else:
        pred, cuts = walk_lr(t300, ext)
        pred.to_parquet(fp, index=False)
        cuts.to_parquet(OUT / "r2_cuts.parquet", index=False)
    # check: top-300 p equals the round-1 cached V19/V26 predictions
    old = pd.read_parquet(OUT / "pred_lr_e5_d1_wNone_None_h0_cohort_fwd.parquet")
    chk = pred[pred.uni == "top300"].merge(old, on=["rule", "symbol", "signal_date"], suffixes=("", "_old"))
    print(f"top-300 p vs round-1 cache: {len(chk)} rows, max |diff| {(chk.p - chk.p_old).abs().max():.1e}")
    card = card_table(t300)
    top = pred[pred.uni == "top300"].drop(columns="uni")
    x5 = pred[pred.uni == "r301_500"].drop(columns="uni")
    rng = np.random.default_rng(0)

    print("\n######## R1 = V26 confirmatory (filter, dip rules only)")
    d1 = label(top, cuts)
    E.report(d1, "R1 (V26) top 300")
    for r in DIP:
        for per, lo in (("2021-26", E.START), ("2024-26", E.RECENT)):
            real, med, p = null_skip(d1, r, lo, rng)
            print(f"  matched null (rule x year) top300 {r} {per}: method made {real:.1f}  null median {med:.1f}  p = {p:.3f}")
    e1 = label(x5, cuts)
    print("\nR1 on ranks 301-500 (independent stocks; static = all their dip trades):")
    print(ext_rows(e1).to_string(index=False))
    for r in DIP:
        for per, lo in (("2021-26", E.START), ("2024-26", E.RECENT)):
            real, med, p = null_skip(e1[e1.signal_date < E.END], r, lo, rng)
            print(f"  matched null r301_500 {r} {per}: method made {real:.1f}  null median {med:.1f}  p = {p:.3f}")
    print("  per year r301_500 (made% kept - static, kept share):")
    for r in DIP:
        g = e1[(e1.rule == r) & (e1.signal_date >= E.START)]
        print("   ", r, " ".join(f"{yr}: {made(h.y[h['take']]) - made(h.y):+.1f} ({h['take'].mean():.2f})"
                                 for yr, h in g.groupby(g.signal_date.dt.year)))

    for name, crd in (("R2 C2 tier (gated by forward AUC >= .55)", None), ("R3 C2 x complete-cohort weather card", card)):
        print(f"\n######## {name}")
        for uni, base in (("top300", top), ("r301_500", x5)):
            d = label(base[base.signal_date < E.END], cuts, crd)
            for r in (M.RULES if uni == "top300" else DIP):
                for per, lo in (("2021-26", E.START), ("2024-26", E.RECENT)):
                    g = d[(d.rule == r) & (d.signal_date >= lo)]
                    by = g.groupby("tier").agg(n=("y", "size"), made=("y", "mean"), avg=("net", "mean"))
                    gap, med, p, nh, nl = null_gap(d, r, lo, rng)
                    cells = " ".join(f"{k} {100 * v.made:.1f}% ({v.n}, {100 * v.avg:+.2f})" for k, v in by.iterrows())
                    print(f"  {uni:8s} {r:12s} {per}: {cells} | High-Low {gap:+.1f} (null median {med:+.1f}, p = {p:.3f})")
        if crd is None:
            print("  quarters with the tier shown:", cuts.assign(on=cuts.oof_auc >= 0.55).groupby("rule").on.mean()
                  .round(2).to_dict())
