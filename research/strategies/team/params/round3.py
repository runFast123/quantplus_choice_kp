"""ROUND 3 (params): independent re-implementation of metalabel's rsi_dip confidence tier from the WRITTEN SPEC only
(team/metalabel/PLAN.md main section + Amendments A, B, C), not from its code. Written before any number was computed.

Disclosure: in round 2 I had read ~15 lines of metalabel's meta.py `decide()` (tier = Low if p < cut_lo, High if
p >= cut_hi and cut_hi > cut_lo) and the column names of its cuts file. Nothing else of its code was read.

Spec as I read it (my interpretation where the text is silent is marked *):
- Data: data/team_trades.parquet, rule rsi_dip (LR is one model per rule), label y = net > 0.
- Features: the 23 signal-day features + hr_rule + n_same_day.
    hr_rule = hit rate of the rule's last 50 complete-cohort trades by signal date, frozen per quarter: for a trade
              signalled in quarter q it uses trades with signal_date < q - 7 - 21 days and exit_date < q - 7 days.
              (* fewer than 50 -> the ones available; none -> missing, imputed.)
    n_same_day = log(1 + number of rsi_dip trades in the file with the same signal date). (* "signals" = rows of
              team_trades for that rule.)
- Model: median imputation -> standardise -> L2 logistic regression, C = 0.05 (* lbfgs, max_iter 2000).
- Outer loop: quarters 2021Q1 .. 2026Q4. Training at Q = rsi_dip trades with signal_date >= 2019-07-01,
  signal_date < Q - 28 days (embargo 7 + span 21) and exit_date < Q - 7 days. Fewer than 100 -> no model (no tier).
- Forward-only OOF (Amendment B): training sorted by signal date, split into 6 blocks (* equal counts); block k (2..6)
  scored by a model fitted on earlier blocks with the same purge relative to block k's first signal date
  (signal_date < first - 28 d, exit_date < first - 7 d); block 1 unscored.
- Platt on the OOF decision scores (logit), slope clipped at >= 0 (* slope < 0 -> every p = OOF base rate).
  Final model refit on all training trades; p = sigmoid(a x score + b).
- Tiers: cut-offs = 33rd / 67th percentiles of the calibrated OOF p; Low p < cut33, High p >= cut67 (only if cut67 >
  cut33), else Normal.
- Gate (Amendment C): the tier is shown in quarter Q only if the forward-OOF AUC >= 0.55.
Report, 2021-26 and 2024-26: share of quarters shown; High / Normal / Low made% and avg%; High - Low gap, gated and
ungated; replication passes if each gap is within +-3 points of metalabel's (+15.3 / +15.1 gated; 17.7 / 17.0 ungated).

    cd research/strategies && python team/params/round3.py
"""
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

HERE = Path(__file__).resolve().parent
D = HERE.parents[1] / "data"
FEATS = ["d200", "d50", "d20", "slope200", "rsi14", "rsi2", "atrpct", "volratio", "rs_rank", "r5", "r20", "r126",
         "dist_hi252", "clv", "gap", "sector_rank", "nifty_d200", "nifty_r20", "vix", "vix_chg5", "wx", "breadth50",
         "breadth200"]
X = FEATS + ["hr_rule", "n_same_day"]
EMB, SPAN = pd.Timedelta(days=7), pd.Timedelta(days=21)
QS = pd.date_range("2021-01-01", "2026-10-01", freq="QS")


def load():
    t = pd.read_parquet(D / "team_trades.parquet")
    for c in ("signal_date", "entry_date", "exit_date"):
        t[c] = pd.to_datetime(t[c])
    t = t[t.rule == "rsi_dip"].sort_values(["signal_date", "symbol"]).reset_index(drop=True)
    t["y"] = (t.net > 0).astype(int)
    t["n_same_day"] = np.log1p(t.groupby("signal_date").symbol.transform("size"))
    t["q"] = t.signal_date.dt.to_period("Q").dt.start_time
    hr = {}
    for q in t.q.unique():
        done = t[(t.signal_date < q - EMB - SPAN) & (t.exit_date < q - EMB)]
        hr[q] = done.y.tail(50).mean() if len(done) else np.nan
    t["hr_rule"] = t.q.map(hr)
    return t


def model():
    return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(C=0.05, max_iter=2000))


def complete(t, at):
    return t[(t.signal_date < at - EMB - SPAN) & (t.exit_date < at - EMB)]


def pooled_blocks(Q, tr):
    """DIAGNOSTIC (added after the numbers, to explain the gap to metalabel): the 6 forward blocks cut over the pooled
    complete-cohort training set of ALL four rules (as metalabel's code does), then mapped to rsi_dip rows."""
    a = pd.read_parquet(D / "team_trades.parquet")
    a["signal_date"] = pd.to_datetime(a.signal_date)
    hold = a.rule.map({"strong_trend": 100, "sma_trend": 100, "rsi_dip": 21, "kk_dip": 21})
    a = a[a.signal_date < Q - EMB - pd.to_timedelta(hold, unit="D")].sort_values(["signal_date", "rule", "symbol"])
    a = a.reset_index(drop=True)
    starts = [a.signal_date.iat[b[0]] for b in np.array_split(np.arange(len(a)), 6)]
    pos = a[a.rule == "rsi_dip"].set_index(["symbol", "signal_date"]).index
    order = pd.Series(np.flatnonzero((a.rule == "rsi_dip").to_numpy()), index=pos)
    bounds = [b[0] for b in np.array_split(np.arange(len(a)), 6)] + [len(a)]
    idx = order.reindex(pd.MultiIndex.from_arrays([tr.symbol, tr.signal_date])).to_numpy()
    blocks = [np.flatnonzero((idx >= bounds[k]) & (idx < bounds[k + 1])) for k in range(6)]
    return blocks, starts


def fit_quarter(t, Q, pooled=False):
    tr = complete(t, Q)
    if len(tr) < 100:
        return None
    blocks = np.array_split(np.arange(len(tr)), 6)
    if pooled:
        blocks, _ = pooled_blocks(Q, tr)
    oof_s, oof_y = [], []
    for k in range(1, 6):
        blk = tr.iloc[blocks[k]]
        if not len(blk):
            continue
        past = complete(tr.iloc[np.concatenate(blocks[:k])], blk.signal_date.min())
        if len(past) < 30 or past.y.nunique() < 2:
            continue
        m = model().fit(past[X], past.y)
        oof_s.append(m.decision_function(blk[X]))
        oof_y.append(blk.y.to_numpy())
    s, y = np.concatenate(oof_s), np.concatenate(oof_y)
    auc = roc_auc_score(y, s)
    pl = LogisticRegression(C=1e6, max_iter=2000).fit(s.reshape(-1, 1), y)
    a, b = float(pl.coef_[0, 0]), float(pl.intercept_[0])
    if a < 0:
        a, b = 0.0, float(np.log(y.mean() / (1 - y.mean())))
    p_oof = 1 / (1 + np.exp(-(a * s + b)))
    if pooled:                                   # metalabel measures the gate's AUC on calibrated p (0.5 if clipped)
        auc = roc_auc_score(y, p_oof) if a > 0 else 0.5
    lo, hi = np.percentile(p_oof, [100 / 3, 200 / 3])
    final = model().fit(tr[X], tr.y)
    return {"final": final, "a": a, "b": b, "auc": auc, "lo": lo, "hi": hi, "n_train": len(tr)}


def run(pooled=False):
    t = load()
    rows, qinfo = [], []
    for Q in QS:
        f = fit_quarter(t, Q, pooled)
        sc = t[(t.signal_date >= Q) & (t.signal_date < Q + pd.offsets.QuarterBegin(startingMonth=1))].copy()
        if f is None:
            sc["p"], sc["tier"], sc["shown"] = np.nan, "none", False
            qinfo.append({"Q": Q.date(), "n_train": len(complete(t, Q)), "auc": np.nan, "slope": np.nan, "shown": False})
        else:
            sc["p"] = 1 / (1 + np.exp(-(f["a"] * f["final"].decision_function(sc[X]) + f["b"])))
            tier = np.where(sc.p < f["lo"], "Low", np.where((sc.p >= f["hi"]) & (f["hi"] > f["lo"] + 1e-12), "High", "Normal"))
            sc["tier"], sc["shown"] = tier, f["auc"] >= 0.55
            qinfo.append({"Q": Q.date(), "n_train": f["n_train"], "auc": round(f["auc"], 3), "slope": round(f["a"], 3),
                          "cut_lo": round(f["lo"], 4), "cut_hi": round(f["hi"], 4), "shown": f["auc"] >= 0.55})
        rows.append(sc)
    return pd.concat(rows, ignore_index=True), pd.DataFrame(qinfo)


def table(d, gated):
    out = []
    for per, lo in (("2021-26", "2021-01-01"), ("2024-26", "2024-01-01")):
        x = d[(d.signal_date >= lo) & (d.signal_date < "2026-11-01")]
        if gated:
            x = x[x.shown]
        r = {"period": per, "gated": gated, "signals": len(x)}
        for tr in ("High", "Normal", "Low"):
            g = x[x.tier == tr]
            r[f"{tr} n"] = len(g)
            r[f"{tr} made%"] = round(100 * g.y.mean(), 1)
            r[f"{tr} avg%"] = round(100 * g.net.mean(), 2)
        r["High-Low"] = round(r["High made%"] - r["Low made%"], 1)
        out.append(r)
    return pd.DataFrame(out)


if __name__ == "__main__":
    pd.set_option("display.width", 220)
    d, q = run()
    d.to_parquet(HERE / "out" / "round3_rsi_tier.parquet", index=False)
    q.to_csv(HERE / "out" / "round3_quarters.csv", index=False)
    print(q.to_string(index=False))
    for per, lo in (("2021-26", "2021-01-01"), ("2024-26", "2024-01-01")):
        qq = q[pd.to_datetime(q.Q) >= lo]
        print(f"{per}: tier shown in {int(qq.shown.sum())} of {len(qq)} quarters ({100 * qq.shown.mean():.0f} %)")
    print(pd.concat([table(d, True), table(d, False)]).to_string(index=False))
    # DIAGNOSTIC: metalabel's block boundaries (pooled over all rules) with everything else from my build
    d2, q2 = run(pooled=True)
    q2.to_csv(HERE / "out" / "round3_quarters_pooled.csv", index=False)
    print("\nDIAGNOSTIC pooled 6 blocks: shown quarters", int(q2.shown.sum()), "of 24;", "AUC by quarter",
          q2.auc.round(3).tolist())
    for per, lo in (("2021-26", "2021-01-01"), ("2024-26", "2024-01-01")):
        qq = q2[pd.to_datetime(q2.Q) >= lo]
        print(f"  {per}: tier shown in {int(qq.shown.sum())} of {len(qq)} quarters")
    print(pd.concat([table(d2, True), table(d2, False)]).to_string(index=False))
