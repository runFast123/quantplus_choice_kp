"""RSI dip confidence tier (team design D*, item 2): standalone fit / score. No imports from other research files.

    model = fit(train_df)            # train_df: graded rsi_dip trades, complete cohorts only (see COHORT below)
    out   = score(model, feats_df)   # -> DataFrame with p (chance the trade makes money after 0.5 % cost) and tier
    json.dump(model, f)              # the model is a plain dict of lists and floats

WHAT IT DOES (one sentence): a logistic regression on 25 signal-day numbers says how similar past RSI dips turned out;
signals in the top third of its training scores are "High", the bottom third "Low", the rest "Normal".

TRAINING SET (COHORT). Retrain at the start of each calendar quarter Q on every graded rsi_dip trade with
signal_date < Q - 28 calendar days (7-day embargo + 21 days = the rule's maximum 10-session holding span), so every
trade in the set has closed: no outcome-dependent selection. Label y = 1 if net > 0 after the 0.5 % round-trip cost.
Research universe: each year's point-in-time top 300 by traded value (below).

FIT (all settings fixed in round 1, never tuned on out-of-sample data)
  1. impute: each feature's NaN -> its training median.   2. standardise: (x - mean) / sd on the imputed training
     data (population sd; sd 0 -> 1).   3. logistic regression, L2, C = 0.05 (sklearn lbfgs).
  4. self-test + calibration, forward only: sort the training trades by signal_date, cut into 6 equal blocks; each
     block k >= 2 is scored by steps 1-3 fitted on the trades with signal_date < (first signal of block k) - 28 days.
     Platt scaling p = 1 / (1 + exp(-(a * s + b))) is fitted on those forward scores; if a <= 0 then a = 0 and
     b = logit(training made-rate): a model that cannot rank its own past is never inverted.
  5. tertile cut-offs = 33.3 / 66.7 % quantiles of the calibrated forward scores; self-test AUC = their AUC (kept in
     the model for the record only; D** has no AUC gate).
  6. shown (D***) = (n_train >= 100) and (>= 50 forward scores) and (platt_a > 1e-6) and (cut_hi > cut_lo).
     (1e-6 = numerical zero: a solver may return a ~ 1e-11 instead of 0 for a flat calibration.)
     If not shown, every signal that quarter gets tier "none" ("no tier this quarter").
  The 6 blocks are cut on rsi_dip trades only (rows of other rules in train_df are dropped first).
SCORE: p = Platt(raw), tier = High if p >= cut_hi, Low if p < cut_lo, else Normal (or "none" if not shown).

FEATURES — exact definitions, as built by team/build_dataset.py (stock_features + signals.mkt) on research candles.
Research prices: yfinance auto_adjust=True = split- AND dividend-adjusted OHLC (research/strategies/download.py).
The live DB stores split-adjusted, NOT dividend-adjusted prices (pipelines/eod/eod.py): ex-dividend days show a small
extra drop. Effect on the ratios below is ~ the dividend yield inside the window (<= ~1-2 %), largest for r126, d200,
dist_hi252 and gap on ex-dates. Windows count sessions (rows), not calendar days.
  build_dataset.py, stock_features():
    "d200": f.close / f.sma200 - 1, "d50": f.close / f.sma50 - 1, "d20": f.close / f.sma20 - 1,
    "slope200": f.sma200 / f.sma200.shift(20) - 1, "rsi14": f.rsi14, "rsi2": f.rsi2,
    "atrpct": f.atr14 / f.close, "volratio": f.volume / f.vol50, "rs_rank": f.rs_rank,
    "r5": f.close / f.close.shift(5) - 1, "r20": f.close / f.close.shift(20) - 1, "r126": f.ret126,
    "dist_hi252": f.close / f.hi252 - 1,
    "clv": ((f.close - f.low) / (f.high - f.low)).where(f.high > f.low, 0.5),
    "gap": f.open / f.close.shift() - 1,
    "sector_rank": S.sec_rank[sec].reindex(f.date)
  with (backtest.indicators):
    smaN      simple mean of close over N sessions, min_periods N (N = 20, 50, 200)
    rsiN      Wilder RSI: d = close.diff(); gain/loss = d.clip(lower=0) / (-d).clip(lower=0) .ewm(alpha=1/N,
              adjust=False, min_periods=N).mean(); 100 - 100 / (1 + gain/loss) (loss 0 -> NaN). N = 14 and 2.
              (Note: this rsi2 feature is backtest's, not record_dip's signal RSI(2); both are EWM alpha 1/2.)
    atr14     true range max(h-l, |h-prev c|, |l-prev c|) .ewm(alpha=1/14, adjust=False, min_periods=14).mean()
    vol50     volume.rolling(50, min_periods=50).mean().shift(1)    (excludes the signal day)
    hi252     close.rolling(252, min_periods=200).max().shift(1)     (excludes the signal day)
    ret126    close / close.shift(126) - 1
    rs_rank   percentile rank (pandas rank pct=True) of ret126 across every stock in the coverage set that day
              (coverage set = today's top 500 equities by market cap with >= 300 sessions of data; NaN excluded)
  market features (signals.py, one value per day; Nifty 50 = ^NSEI close, India VIX close):
    nifty_d200  nifty / nifty.rolling(200).mean() - 1
    nifty_r20   nifty / nifty.shift(20) - 1
    vix         India VIX close, forward-filled onto Nifty trading days
    vix_chg5    vix / vix.shift(5) - 1 (5 Nifty sessions)
    wx          weather: 2 sunny = Nifty > its 200-day avg AND 50-day avg > 200-day AND VIX <= 22;
                0 stormy = (Nifty < 200-day AND 50-day < 200-day) OR VIX > 22; 1 mixed otherwise
    breadth50   share of coverage-set stocks with close > their own sma50 (denominator: stocks whose sma50 exists)
    breadth200  same with sma200
    sector_rank r63 = close / close.shift(63) - 1 per stock; sector average of r63 over the coverage set (sector =
                market_symbols.sector, blank -> "Other"); percentile rank of the stock's sector among all sectors
                that day (pct=True). NaN if the sector has no rank.
  derived (team/metalabel; frozen per quarter / per day, no look-ahead):
    hr_rule     made-rate (net > 0) of the last 50 graded rsi_dip trades with signal_date < Q - 28 days, ordered by
                (signal_date, symbol), from the universe the model is trained on; NaN if fewer than 10. Same value
                for every signal in Q.
    n_same_day  (rsi_dip_tier/3) log(1 + number of rsi_dip SETUPS at the signal-day close among the point-in-time
                top 300), setup = RSI(2) < 10 (the rsi2 feature above) and close > sma200 (d200 > 0), filled or not;
                the signal itself counts as one (added if its own row is not a setup, e.g. a rank 301-500 stock).
                Known at the close. (rsi_dip_tier/1-2 counted FILLED trades, which depends on the next session's
                low: a look-ahead, removed; see r3_leak.py.) Helper: setup_count().
  point-in-time top 300 (fair.pit_universe): for year Y, rank stocks by the median of close x volume over the 183
  calendar days before 1 Jan Y (at least 101 sessions); keep the first 300.
Live DB keeps ~760 sessions per symbol: the longest look-backs (hi252 + 1, sma200 + 20 for slope200, the Nifty 200-day)
fit; the EWM indicators (rsi, atr) start from the first stored session, and their warm-up is checked in r3_check.py.
"""
import json

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

FEATURES = ["d200", "d50", "d20", "slope200", "rsi14", "rsi2", "atrpct", "volratio", "rs_rank", "r5", "r20", "r126",
            "dist_hi252", "clv", "gap", "sector_rank", "nifty_d200", "nifty_r20", "vix", "vix_chg5", "wx",
            "breadth50", "breadth200", "hr_rule", "n_same_day"]
EMBARGO_DAYS, HOLD_DAYS = 7, 21          # complete cohorts: signal_date < Q - 28 days
C = 0.05
BLOCKS = 6
MIN_TRAIN, MIN_OOF, HR_N = 100, 50, 50
SLOPE_EPS = 1e-6                         # Platt slope at or below this = flat = "no tier this quarter"
VERSION = "rsi_dip_tier/3"


# ------------------------------------------------------------------ helpers (pure numpy)
def _logit(p):
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return np.log(p / (1 - p))


def _auc(y, s):
    """Mann-Whitney AUC with average ranks for ties."""
    y, s = np.asarray(y), np.asarray(s, float)
    if len(np.unique(y)) < 2:
        return float("nan")
    r = pd.Series(s).rank().to_numpy()
    n1 = y.sum()
    return float((r[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * (len(y) - n1)))


def _fit_lr(X, y):
    med = np.nanmedian(X, axis=0)
    med = np.where(np.isnan(med), 0.0, med)                    # an all-NaN column becomes constant (no effect)
    Xi = np.where(np.isnan(X), med, X)
    mu, sd = Xi.mean(axis=0), Xi.std(axis=0)
    sd = np.where(sd == 0, 1.0, sd)
    lr = LogisticRegression(C=C, max_iter=2000).fit((Xi - mu) / sd, y)
    return {"median": med, "mean": mu, "sd": sd, "coef": lr.coef_[0], "intercept": float(lr.intercept_[0])}


def _raw(m, X):
    Xi = np.where(np.isnan(X), np.asarray(m["median"]), X)
    return ((Xi - np.asarray(m["mean"])) / np.asarray(m["sd"])) @ np.asarray(m["coef"]) + m["intercept"]


def _X(df):
    return df[FEATURES].to_numpy(float)


# ------------------------------------------------------------------ public API
def fit(train_df, asof=None):
    """train_df: graded rsi_dip trades with FEATURES, signal_date and net. If `asof` (quarter start) is given, the
    complete-cohort filter signal_date < asof - 28 days is applied here; otherwise the caller must have applied it."""
    d = train_df.copy()
    if "rule" in d:
        d = d[d.rule == "rsi_dip"]                              # blocks and fit on rsi_dip trades only
    d["signal_date"] = pd.to_datetime(d.signal_date)
    if asof is not None:
        d = d[d.signal_date < pd.Timestamp(asof) - pd.Timedelta(days=EMBARGO_DAYS + HOLD_DAYS)]
    keys = ["signal_date", "symbol"] if "symbol" in d else ["signal_date"]
    d = d.sort_values(keys, kind="mergesort").reset_index(drop=True)          # blocks: ordered by (signal_date, symbol)
    y = (d.net.to_numpy() > 0).astype(int)
    X = _X(d)
    model = {"version": VERSION, "features": FEATURES, "n_train": int(len(d)),
             "trained_through": str(d.signal_date.max().date()) if len(d) else None,
             "made_rate_train": float(y.mean()) if len(d) else None, "shown": False}
    if len(d) < MIN_TRAIN or len(np.unique(y)) < 2:
        return model
    # forward-only self-test
    oof = np.full(len(d), np.nan)
    sd_ = d.signal_date.to_numpy()
    gapd = np.timedelta64(EMBARGO_DAYS + HOLD_DAYS, "D")
    for b in np.array_split(np.arange(len(d)), BLOCKS)[1:]:
        fitm = sd_ < sd_[b[0]] - gapd
        if fitm.sum() >= 30 and len(np.unique(y[fitm])) == 2:
            oof[b] = _raw(_fit_lr(X[fitm], y[fitm]), X[b])
    ok = ~np.isnan(oof)
    if ok.sum() < MIN_OOF:
        return model
    pl = LogisticRegression(C=1e4, max_iter=1000).fit(oof[ok].reshape(-1, 1), y[ok])
    a, bb = float(pl.coef_[0, 0]), float(pl.intercept_[0])
    if a <= 0:
        a, bb = 0.0, float(_logit(np.array([y[ok].mean()]))[0])
    p_oof = 1 / (1 + np.exp(-(a * oof[ok] + bb)))
    lo, hi = float(np.quantile(p_oof, 1 / 3)), float(np.quantile(p_oof, 2 / 3))
    auc = _auc(y[ok], p_oof)
    lr = _fit_lr(X, y)
    model.update({k: [float(v) for v in lr[k]] for k in ("median", "mean", "sd", "coef")})
    model.update({"intercept": lr["intercept"], "platt_a": a, "platt_b": bb, "cut_lo": lo, "cut_hi": hi,
                  "self_test_auc": auc, "n_selftest": int(ok.sum()),
                  "shown": bool(a > SLOPE_EPS and hi > lo + 1e-12)})
    return model


def score(model, features_df):
    """Returns a DataFrame (same index) with p and tier (High / Normal / Low, or 'none' when the model is not shown)."""
    out = pd.DataFrame(index=features_df.index)
    if "coef" not in model:
        out["p"], out["tier"] = np.nan, "none"
        return out
    s = _raw(model, features_df[model["features"]].to_numpy(float))
    p = 1 / (1 + np.exp(-(model["platt_a"] * s + model["platt_b"])))
    out["p"] = p
    tier = np.where(p >= model["cut_hi"], "High", np.where(p < model["cut_lo"], "Low", "Normal"))
    out["tier"] = tier if model["shown"] else "none"
    return out


def hr_rule(graded, qstart):
    """graded: rsi_dip trades (signal_date, net) of the training universe. Value for every signal in quarter qstart."""
    g = graded[pd.to_datetime(graded.signal_date) < pd.Timestamp(qstart) - pd.Timedelta(days=EMBARGO_DAYS + HOLD_DAYS)]
    g = g.sort_values(["signal_date", "symbol"], kind="mergesort").tail(HR_N)   # ties: alphabetical symbol, last 50
    return float((g.net > 0).mean()) if len(g) >= 10 else float("nan")


def pit_top(candles, top=300, first_year=2019, last_year=2026, first_start="2019-07-01"):
    """Point-in-time list {year: set(symbols)} (see pit_ranked)."""
    return {y: set(r) for y, r in pit_ranked(candles, top, first_year, last_year, first_start).items()}


def pit_ranked(candles, top=300, first_year=2019, last_year=2026, first_start="2019-07-01"):
    """Point-in-time list {year: [symbols, rank 1 first]}: rank by median close x volume over the 183 calendar days
    before 1 Jan (first research year: before 2019-07-01), > 100 sessions in that window; non-index symbols with
    >= 300 rows of clean candles (the research coverage rule); keep the first `top`."""
    c = candles.dropna(subset=["open", "high", "low", "close"])
    c = c[(c.close > 0) & (c.open > 0) & ~c.symbol.str.startswith("^")].copy()
    c["date"] = pd.to_datetime(c.date)
    n = c.groupby("symbol").size()
    c = c[c.symbol.isin(n[n >= 300].index)]
    out = {}
    for y in range(first_year, last_year + 1):
        lo = pd.Timestamp(first_start) if y == first_year else pd.Timestamp(f"{y}-01-01")
        w = c[(c.date < lo) & (c.date >= lo - pd.Timedelta(days=183))]
        k = w.groupby("symbol").size()
        tv = (w.close * w.volume).groupby(w.symbol).median()[k[k > 100].index]
        order = sorted(tv.index, key=lambda s: -tv[s])                    # ties keep the symbol order of the file
        out[y] = order[:top]
    return out


def setup_count(features, pit):
    """features: symbol, date, rsi2, d200 for every stock-day. Returns a Series date -> number of rsi_dip setups
    (rsi2 < 10 and d200 > 0) among the point-in-time list `pit` ({year: set})."""
    f = features[(features.rsi2 < 10) & (features.d200 > 0)]
    d = pd.to_datetime(f.date)
    keep = [s in pit.get(y, ()) for s, y in zip(f.symbol, d.dt.year)]
    return d[keep].value_counts().sort_index()


def n_same_day(count_including_this_one):
    """log(1 + count); accepts a number or an array / Series of counts."""
    return np.log1p(np.asarray(count_including_this_one, dtype=float))


def save(model, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(model, f, indent=1)


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)
