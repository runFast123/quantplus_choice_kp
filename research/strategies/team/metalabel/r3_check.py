"""Round 3 check (2): buildability of the rsi_dip tier with the standalone tier_model.py.
  a. walk-forward with tier_model (rsi_dip-only forward blocks) vs the round-2 R2 labels (blocks over all rules):
     agreement, High - Low gap, matched null; top 300 and ranks 301-500. Nothing re-tuned.
  b. coefficient stability over the 24 quarterly fits (sign agreement with the final model).
  c. the production model: fit on every complete-cohort rsi_dip trade as of 2026-11-01 -> out/rsi_dip_tier_model.json;
     standardised coefficients, largest first; JSON round-trip check.
  d. live-history check: rsi14 / rsi2 / atr14 recomputed from only the last 760 sessions vs the research values."""
import numpy as np
import pandas as pd

import round2 as R
import tier_model as T

M, E = R.M, R.E
OUT = R.OUT
TODAY = pd.Timestamp("2026-11-01")
pd.set_option("display.width", 220)

t300 = M.load()
hr = R.hr_table(t300)
t300["hr_rule"] = [hr[(r, q)] for r, q in zip(t300.rule, t300.qstart)]
rsi = t300[t300.rule == "rsi_dip"].copy()
pred = pd.read_parquet(OUT / "r2_pred.parquet")
cuts = pd.read_parquet(OUT / "r2_cuts.parquet")
ext = pd.read_parquet(OUT / "r2_ext_trades.parquet")
ext = ext[ext.rule == "rsi_dip"].copy()
ext["qstart"] = ext.signal_date.dt.to_period("Q").dt.start_time
ext["hr_rule"] = [hr[(r, q)] for r, q in zip(ext.rule, ext.qstart)]
n300 = t300.groupby(["rule", "signal_date"]).size()
ext["n_same_day"] = np.log1p([n300.get((r, d), 0) + 1 for r, d in zip(ext.rule, ext.signal_date)])
ext["y"] = (ext.net > 0).astype(int)

# ---------------- a. walk-forward with the standalone model
rows, coefs = [], []
for Q in M.QS:
    Qn = Q + pd.offsets.QuarterBegin(startingMonth=1)
    m = T.fit(rsi, asof=Q)
    if "coef" in m:
        coefs.append(pd.Series(m["coef"], index=T.FEATURES, name=Q))
    for uni, te in (("top300", rsi), ("r301_500", ext)):
        te = te[(te.signal_date >= Q) & (te.signal_date < Qn) & (te.signal_date < E.END)]
        if len(te):
            s = T.score(m, te)
            rows.append(te[["rule", "symbol", "signal_date", "net", "y"]].assign(uni=uni, p_new=s.p, tier_new=s.tier,
                                                                               shown=m["shown"]))
new = pd.concat(rows, ignore_index=True)
old = []
for uni in ("top300", "r301_500"):
    d = R.label(pred[(pred.uni == uni) & (pred.rule == "rsi_dip")].drop(columns="uni"), cuts)
    old.append(d[["rule", "symbol", "signal_date", "tier", "p"]].assign(uni=uni))
cmp = new.merge(pd.concat(old), on=["uni", "rule", "symbol", "signal_date"], how="left")
cmp["tier_new_n"] = cmp.tier_new.replace("none", "Normal")
rng = np.random.default_rng(0)
print("a. standalone tier_model (rsi_dip-only blocks) vs round-2 R2 (blocks over all rules)")
for uni in ("top300", "r301_500"):
    c = cmp[cmp.uni == uni]
    print(f"  {uni}: tier identical for {100 * (c.tier_new_n == c.tier).mean():.1f} % of {len(c)} signals; "
          f"shown in {c.groupby(c.signal_date.dt.to_period('Q')).shown.first().mean():.2f} of quarters")
    for per, lo in (("2021-26", E.START), ("2024-26", E.RECENT)):
        for lab, col in (("round-2 R2 ", "tier"), ("tier_model ", "tier_new_n")):
            g = c[c.signal_date >= lo].assign(tier=c[col])
            by = g.groupby("tier").y.agg(["size", "mean"])
            gap, med, p, nh, nl = R.null_gap(g.assign(rule="rsi_dip"), "rsi_dip", lo, rng)
            print(f"    {per} {lab}: " + " ".join(f"{k} {100 * v['mean']:.1f}% ({int(v['size'])})" for k, v in by.iterrows())
                  + f" | High-Low {gap:+.1f} (null p = {p:.3f})")

# ---------------- b. coefficient stability
cf = pd.DataFrame(coefs)

# ---------------- c. production model as of today
final = T.fit(rsi, asof=TODAY)
T.save(final, OUT / "rsi_dip_tier_model.json")
back = T.load(OUT / "rsi_dip_tier_model.json")
x = rsi.tail(200)
assert np.allclose(T.score(final, x).p, T.score(back, x).p), "JSON round-trip changed the scores"
print(f"\nc. production model: n_train {final['n_train']} (signals through {final['trained_through']}), "
      f"self-test AUC {final['self_test_auc']:.3f} on {final['n_selftest']} forward scores, shown {final['shown']}, "
      f"Platt a {final['platt_a']:.3f} b {final['platt_b']:+.3f}, cut-offs p {final['cut_lo']:.3f} / {final['cut_hi']:.3f}")
co = pd.Series(final["coef"], index=T.FEATURES)
tab = pd.DataFrame({"coef (per 1 sd)": co.round(3), "abs": co.abs(),
                    "mean over 24 quarterly fits": cf.mean().round(3),
                    "same sign as final, share of quarters": (np.sign(cf) == np.sign(co)).mean().round(2)})
tab = tab.sort_values("abs", ascending=False).drop(columns="abs")
print(tab.to_string())
print("  intercept", round(final["intercept"], 3))

# ---------------- d. warm-up check for live history (~760 sessions)
cand = pd.read_parquet(R.ROOT / "data" / "candles.parquet")
cand["date"] = pd.to_datetime(cand.date)


def ind(f):
    c, h, l = f.close, f.high, f.low
    d = c.diff()

    def rs(n):
        g = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
        q = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
        return 100 - 100 / (1 + g / q.replace(0, np.nan))
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    return pd.DataFrame({"date": f.date, "rsi14": rs(14), "rsi2": rs(2),
                         "atrpct": tr.ewm(alpha=1 / 14, adjust=False, min_periods=14).mean() / c})


last = rsi[rsi.signal_date >= "2026-01-01"]
diffs = []
for s, g in last.groupby("symbol"):
    f = cand[cand.symbol == s].dropna(subset=["open", "high", "low", "close"]).sort_values("date")
    f = f[(f.close > 0) & (f.open > 0)]
    full, short = ind(f).set_index("date"), ind(f.tail(760).reset_index(drop=True)).set_index("date")
    for dte in g.signal_date:
        diffs.append((full.loc[dte] - short.loc[dte]).abs())
dd = pd.DataFrame(diffs)
print(f"\nd. features from the last 760 sessions only vs full history, {len(dd)} rsi_dip signals in 2026: max |diff| "
      + ", ".join(f"{k} {v:.2e}" for k, v in dd.max().items()))
