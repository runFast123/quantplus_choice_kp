"""Meta-labelling engine (team/metalabel/PLAN.md). Walk-forward, quarter by quarter, 2021Q1 .. 2026Q4.

At each quarter start Q:
  train  = every trade (all four rules, from Jul 2019) whose exit_date < Q - embargo  (open trades purged)
  oof    = purged 5-block K-fold predictions on `train` (used for calibration and thresholds only)
  model  = refit on all of `train`, Platt-calibrated per rule on the OOF scores
  score  = the quarter's signals, with features known on their signal day
Outputs per test trade: calibrated p, plus per (quarter, rule) cut-offs chosen from the training OOF only.
"""
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

warnings.filterwarnings("ignore")
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import evaluate as E  # noqa: E402

OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
RULES = E.RULES
BASE = ["d200", "d50", "d20", "slope200", "rsi14", "rsi2", "atrpct", "volratio", "rs_rank", "r5", "r20", "r126",
        "dist_hi252", "clv", "gap", "sector_rank", "nifty_d200", "nifty_r20", "vix", "vix_chg5", "wx",
        "breadth50", "breadth200"]
DERIVED = ["hr_rule", "n_same_day"]
QS = pd.date_range("2021-01-01", "2026-10-01", freq="QS")
GRID = (0.0, 0.1, 0.2, 0.3, 0.4, 0.5)
MIN_RULE_TRAIN = 100
HR_N = 50


def load():
    t = E.load().sort_values(["signal_date", "rule", "symbol"]).reset_index(drop=True)
    t["y"] = (t.net > 0).astype(int)
    t["rule_id"] = t.rule.map({r: i for i, r in enumerate(RULES)}).astype(float)
    t["n_same_day"] = np.log1p(t.groupby(["rule", "signal_date"]).symbol.transform("size"))
    t["qstart"] = t.signal_date.dt.to_period("Q").dt.start_time
    return t


def hr_strict(t, emb):
    """Hit rate of the rule's last HR_N trades closed before (start of the signal's quarter - embargo)."""
    out = pd.Series(np.nan, index=t.index)
    for r in RULES:
        a = t[t.rule == r].sort_values("exit_date")
        ex, cy = a.exit_date.to_numpy(), np.concatenate([[0], np.cumsum(a.y.to_numpy())])
        m = t.rule == r
        qs = t.loc[m, "qstart"].to_numpy() - np.timedelta64(emb, "D")
        idx = np.searchsorted(ex, qs, side="left")         # number of trades with exit < qs
        n = np.minimum(idx, HR_N)
        hr = (cy[idx] - cy[idx - n]) / np.where(n > 0, n, 1)
        out[m] = np.where(n >= 10, hr, np.nan)
    return out


# Amendment A: maximum holding span by design (calendar days): 60 sessions for the trend rules, 10 for the dip rules.
HOLD = {"strong_trend": 100, "sma_trend": 100, "rsi_dip": 21, "kk_dip": 21}


def hr_cohort(t, emb):
    """Amendment A: hit rate of the rule's last HR_N trades SIGNALLED before (quarter start - embargo - HOLD), i.e.
    from complete cohorts only (every one of them has closed, so winners and losers are equally visible)."""
    out = pd.Series(np.nan, index=t.index)
    for r in RULES:
        a = t[t.rule == r].sort_values("signal_date")
        sd, cy = a.signal_date.to_numpy(), np.concatenate([[0], np.cumsum(a.y.to_numpy())])
        m = t.rule == r
        cut = t.loc[m, "qstart"].to_numpy() - np.timedelta64(emb + HOLD[r], "D")
        idx = np.searchsorted(sd, cut, side="left")
        n = np.minimum(idx, HR_N)
        hr = (cy[idx] - cy[idx - n]) / np.where(n > 0, n, 1)
        out[m] = np.where(n >= 10, hr, np.nan)
    return out


def hr_daily(t):
    """INFORMATIONAL (variant 12): same, but from trades closed before each signal date (intra-quarter feedback)."""
    out = pd.Series(np.nan, index=t.index)
    for r in RULES:
        a = t[t.rule == r].sort_values("exit_date")
        ex, cy = a.exit_date.to_numpy(), np.concatenate([[0], np.cumsum(a.y.to_numpy())])
        m = t.rule == r
        idx = np.searchsorted(ex, t.loc[m, "signal_date"].to_numpy(), side="left")
        n = np.minimum(idx, HR_N)
        hr = (cy[idx] - cy[idx - n]) / np.where(n > 0, n, 1)
        out[m] = np.where(n >= 10, hr, np.nan)
    return out


def _logit(p):
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return np.log(p / (1 - p))


def raw_scores(kind, tr, te, feats, wcol=None):
    """Uncalibrated log-odds for `te` from a model fitted on `tr`."""
    s = np.full(len(te), np.nan)
    if not len(te) or not len(tr):
        return s
    w = tr[wcol].to_numpy() if wcol else None
    if kind == "lr":
        for r in RULES:
            mtr, mte = (tr.rule == r).to_numpy(), (te.rule == r).to_numpy()
            if mtr.sum() < 30 or not mte.any() or tr.y[mtr].nunique() < 2:
                continue
            pipe = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                                 LogisticRegression(C=0.05, max_iter=2000))
            kw = {"logisticregression__sample_weight": w[mtr]} if w is not None else {}
            pipe.fit(tr.loc[mtr, feats], tr.y[mtr], **kw)
            s[mte] = pipe.decision_function(te.loc[mte, feats])
        return s
    if len(tr) < 200 or tr.y.nunique() < 2:      # too little history for a pooled model
        return s
    if kind == "hgb":
        X, Xt = tr[feats + ["rule_id"]].to_numpy(float), te[feats + ["rule_id"]].to_numpy(float)
        m = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=200, min_samples_leaf=100,
                                           l2_regularization=1.0, random_state=0, early_stopping=False,
                                           categorical_features=[False] * len(feats) + [True])
    elif kind == "tree":
        oh = lambda d: np.column_stack([d[feats].to_numpy(float)] + [(d.rule == r).to_numpy(float) for r in RULES])
        X, Xt = oh(tr), oh(te)
        m = DecisionTreeClassifier(max_depth=3, min_samples_leaf=100, random_state=0)
    else:
        raise ValueError(kind)
    m.fit(X, tr.y.to_numpy(), sample_weight=w)
    return _logit(m.predict_proba(Xt)[:, 1])


def purged_oof(kind, tr, feats, emb, wcol, k=5):
    tr = tr.reset_index(drop=True)
    oof = np.full(len(tr), np.nan)
    sd, ed = tr.signal_date.to_numpy(), tr.exit_date.to_numpy()
    e = np.timedelta64(emb, "D")
    for b in np.array_split(np.arange(len(tr)), k):
        t0, t1 = sd[b].min(), ed[b].max()
        keep = ~((sd <= t1 + e) & (ed >= t0 - e))
        keep[b] = False
        oof[b] = raw_scores(kind, tr[keep], tr.iloc[b], feats, wcol)
    return oof


def forward_oof(kind, tr, feats, emb, wcol, cohort, k=6):
    """Amendment B: forward-only OOF. Block k is scored by a model fitted on earlier blocks (same purge as outside)."""
    tr = tr.reset_index(drop=True)
    oof = np.full(len(tr), np.nan)
    e = pd.Timedelta(days=emb)
    for b in np.array_split(np.arange(len(tr)), k)[1:]:
        start = tr.signal_date.iat[b[0]]
        fit = tr[tr.signal_date < start - e - tr.hold] if cohort else tr[tr.exit_date < start - e]
        oof[b] = raw_scores(kind, fit, tr.iloc[b], feats, wcol)
    return oof


def calibrators(tr_rule, oof, y, monotone=False):
    """Per-rule Platt scaling fitted on the OOF scores. Returns {rule: (a, b)} with p = sigmoid(a*s + b).
    monotone (Amendment B): a negative slope is clipped to 0 -> p = the rule's base rate (no information)."""
    cal = {}
    for r in RULES:
        m = (tr_rule == r) & ~np.isnan(oof)
        if m.sum() < 50:
            continue
        lr = LogisticRegression(C=1e4, max_iter=1000).fit(oof[m].reshape(-1, 1), y[m])
        a, b = lr.coef_[0, 0], lr.intercept_[0]
        if monotone and a <= 0:
            a, b = 0.0, float(_logit(np.array([y[m].mean()]))[0])
        cal[r] = (a, b)
    return cal


def apply_cal(rule, s, cal):
    p = np.full(len(s), np.nan)
    for r, (a, b) in cal.items():
        m = (rule == r) & ~np.isnan(s)
        p[m] = 1 / (1 + np.exp(-(a * s[m] + b)))
    return p


def walk(kind="hgb", emb_sessions=5, derived=True, window_years=None, wcol=None, daily_hr=False, cohort=False,
         fwd=False, tag=None):
    """Returns (pred, cuts). pred: one row per OOS trade with calibrated p. cuts: per (quarter, rule) thresholds."""
    tag = tag or (f"{kind}_e{emb_sessions}_d{int(derived)}_w{window_years}_{wcol}_h{int(daily_hr)}"
                  + ("_cohort" if cohort else "") + ("_fwd" if fwd else ""))
    fp, fc = OUT / f"pred_{tag}.parquet", OUT / f"cuts_{tag}.parquet"
    if fp.exists() and fc.exists():
        return pd.read_parquet(fp), pd.read_parquet(fc)
    emb = {0: 0, 5: 7, 20: 28}[emb_sessions]
    t = load()
    t["hr_rule"] = hr_daily(t) if daily_hr else hr_cohort(t, emb) if cohort else hr_strict(t, emb)
    t["hold"] = pd.to_timedelta(t.rule.map(HOLD), unit="D")
    t["absnet"] = t.net.abs() / t.net.abs().mean()
    feats = BASE + (DERIVED if derived else [])
    preds, cuts = [], []
    for Q in QS:
        Qn = Q + pd.offsets.QuarterBegin(startingMonth=1)
        te = t[(t.signal_date >= Q) & (t.signal_date < Qn)].copy()
        tr = t[t.exit_date < Q - pd.Timedelta(days=emb)]
        if cohort:   # Amendment A: complete cohorts only (no outcome-dependent selection near Q)
            full = t[t.signal_date < Q - pd.Timedelta(days=emb) - t.hold]
            assert (full.exit_date < Q - pd.Timedelta(days=emb)).all(), "a trade outlived its design holding span"
            tr = full
        if window_years:
            tr = tr[tr.signal_date >= Q - pd.DateOffset(years=window_years)]
        tr = tr.sort_values("signal_date").reset_index(drop=True)
        if not len(te):
            continue
        oof = forward_oof(kind, tr, feats, emb, wcol, cohort) if fwd else purged_oof(kind, tr, feats, emb, wcol)
        cal = calibrators(tr.rule.to_numpy(), oof, tr.y.to_numpy(), monotone=fwd)
        p_oof = apply_cal(tr.rule.to_numpy(), oof, cal)
        s_te = raw_scores(kind, tr, te, feats, wcol)
        te["p"] = apply_cal(te.rule.to_numpy(), s_te, cal)
        for r in RULES:
            m = (tr.rule == r).to_numpy() & ~np.isnan(p_oof)
            row = {"Q": Q, "rule": r, "n_train": int((tr.rule == r).sum()), "base": tr.y[tr.rule == r].mean()}
            if row["n_train"] < MIN_RULE_TRAIN or m.sum() < 50:
                te.loc[te.rule == r, "p"] = np.nan
                cuts.append(row)
                continue
            pr, nr = p_oof[m], tr.net.to_numpy()[m]
            best_q, best_sum = 0.0, nr.sum()
            for q in GRID[1:]:
                c = np.quantile(pr, q)
                sm = nr[pr >= c].sum()
                if sm > best_sum + 1e-12:
                    best_q, best_sum = q, sm
            row.update({"q_profit": best_q, "slope": cal[r][0], "cut_profit": np.quantile(pr, best_q) if best_q else -np.inf,
                        **{f"cut_{int(100 * q)}": np.quantile(pr, q) for q in (0.1, 0.2, 0.3, 0.4)},
                        "cut_lo": np.quantile(pr, 1 / 3), "cut_hi": np.quantile(pr, 2 / 3),
                        "oof_auc": _auc(tr.y.to_numpy()[m], pr)})
            cuts.append(row)
        preds.append(te[["rule", "symbol", "signal_date", "exit_date", "net", "y", "p", "qstart"]])
        print(f"  {tag} {Q.date()} train {len(tr)} test {len(te)}", flush=True)
    pred, cut = pd.concat(preds, ignore_index=True), pd.DataFrame(cuts)
    pred.to_parquet(fp, index=False)
    cut.to_parquet(fc, index=False)
    return pred, cut


def _auc(y, p):
    from sklearn.metrics import roc_auc_score
    return roc_auc_score(y, p) if len(np.unique(y)) == 2 else np.nan


def decide(pred, cuts, policy="profit", size_tier=False, gate_auc=None):
    """Turn calibrated p + training-chosen cut-offs into evaluate.py decisions (take, size, tier)."""
    d = pred.merge(cuts, left_on=["qstart", "rule"], right_on=["Q", "rule"], how="left")
    has = d.p.notna() & d.cut_lo.notna()
    col = {"profit": "cut_profit", "all": None}.get(policy, f"cut_{policy}")
    d["take"] = True
    if col:
        on = has & (d.oof_auc >= gate_auc) if gate_auc else has     # Amendment C: self-gate per rule and quarter
        d.loc[on, "take"] = d.p[on] >= d[col][on]
    d["tier"] = "Normal"
    d.loc[has & (d.p < d.cut_lo), "tier"] = "Low"
    d.loc[has & (d.p >= d.cut_hi) & (d.cut_hi > d.cut_lo + 1e-12), "tier"] = "High"
    if size_tier:
        d["size"] = np.where(d.tier == "Low", 0.5, 1.0)
    return d
