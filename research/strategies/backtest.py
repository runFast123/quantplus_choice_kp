"""Event study + rule-based backtest of candidate daily patterns on NSE top-500 stocks.

Honest-by-construction rules:
  * a signal uses only data up to that day's close; the trade fills at the NEXT day's open
  * stops fill at the stop or at the open if the stock gaps through it; 0.25 % round-trip cost
  * one open trade per stock per strategy
  * designed on 2019-07..2023-12 (in-sample), confirmed on 2024-01..2026-10 (out-of-sample)
  * every result is compared with the baseline: a random entry in the same stocks and years
Survivorship bias: the universe is TODAY's top 500, so past results flatter every rule a little.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

D = Path(__file__).parent / "data"
COST = 0.0025
IS_END = pd.Timestamp("2024-01-01")
START = pd.Timestamp("2019-07-01")

raw = pd.read_parquet(D / "candles.parquet")
raw = raw.dropna(subset=["open", "high", "low", "close"])
raw = raw[(raw.close > 0) & (raw.open > 0)]


def sma(s, n):
    return s.rolling(n, min_periods=n).mean()


def rsi(c, n):
    d = c.diff()
    g = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    l = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    return 100 - 100 / (1 + g / l.replace(0, np.nan))


def indicators(f):
    f = f.sort_values("date").reset_index(drop=True)
    c, h, l, v = f.close, f.high, f.low, f.volume
    f["sma5"], f["sma10"], f["sma20"], f["sma50"], f["sma200"] = sma(c, 5), sma(c, 10), sma(c, 20), sma(c, 50), sma(c, 200)
    f["rsi14"], f["rsi2"] = rsi(c, 14), rsi(c, 2)
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    f["atr14"] = tr.ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    f["vol50"] = v.rolling(50, min_periods=50).mean().shift(1)
    f["hi252"] = c.rolling(252, min_periods=200).max().shift(1)
    f["hi20"] = c.rolling(20, min_periods=20).max().shift(1)
    f["lo20"] = l.rolling(20, min_periods=20).min().shift(1)
    f["lo10"] = l.rolling(10, min_periods=10).min().shift(1)
    sd = c.rolling(20, min_periods=20).std()
    f["bb_up"] = f.sma20 + 2 * sd
    f["bbw"] = 4 * sd / f.sma20
    f["bbw_rank"] = f.bbw.rolling(120, min_periods=100).rank(pct=True)
    f["ret126"] = c / c.shift(126) - 1
    f["sma200_up"] = f.sma200 > f.sma200.shift(20)
    return f


idx = indicators(raw[raw.symbol == "^NSEI"].copy())[["date", "close", "sma50", "sma200"]]
idx["mkt_up"] = idx.close > idx.sma200
mkt = idx.set_index("date").mkt_up

stocks = {}
for s, f in raw[~raw.symbol.str.startswith("^")].groupby("symbol"):
    if len(f) < 300:
        continue
    f = indicators(f.copy())
    f["mkt_up"] = f.date.map(mkt).fillna(False).astype(bool)
    stocks[s] = f

# relative strength rank across the universe (6-month return percentile), for one candidate
panel = pd.concat({s: f.set_index("date").ret126 for s, f in stocks.items()}, axis=1)
rs_rank = panel.rank(axis=1, pct=True)
for s, f in stocks.items():
    f["rs_rank"] = f.date.map(rs_rank[s]).values


# ---------------------------------------------------------------- entry rules (on the signal day's close)
def e_sma_cross(f):
    return (f.sma20 > f.sma50) & (f.sma20.shift() <= f.sma50.shift())


def e_rsi_rev(f):
    return (f.rsi14.shift() < 30) & (f.rsi14 >= 30)


def e_pullback(f):   # dip in an uptrend: RSI(2) washout above the 200-day average, market healthy
    return (f.close > f.sma200) & f.sma200_up & (f.rsi2 < 10) & f.mkt_up


def e_hi52(f):       # new 52-week closing high on heavy volume, market healthy
    return (f.close > f.hi252) & (f.volume > 1.5 * f.vol50) & (f.close > f.sma50) & f.mkt_up


def e_golden(f):
    return (f.sma50 > f.sma200) & (f.sma50.shift() <= f.sma200.shift())


def e_golden_mkt(f):
    return e_golden(f) & f.mkt_up


def e_squeeze(f):    # quiet range (narrowest bands in ~6 months) then a close above the upper band
    return (f.bbw_rank.shift() < 0.2) & (f.close > f.bb_up) & (f.close > f.sma200) & f.mkt_up


def e_sma50_bounce(f):  # trend resumption: tagged the 50-day average in an uptrend and closed back above it
    return ((f.sma50 > f.sma200) & f.sma200_up & (f.low <= f.sma50 * 1.01) & (f.close > f.sma50)
            & (f.close > f.open) & (f.rsi14.between(40, 60)) & f.mkt_up)


def e_rs_breakout(f):   # a leader (top 20 % 6-month strength) closing at a 20-day high, market healthy
    return (f.rs_rank > 0.8) & (f.close > f.hi20) & (f.close > f.sma50) & (f.sma50 > f.sma200) & f.mkt_up


def e_gap(f):        # big gap up on big volume that holds into the close
    prev = f.close.shift()
    return ((f.open > prev * 1.03) & (f.close > f.open) & (f.volume > 2 * f.vol50) & (f.close > f.sma50) & f.mkt_up)


# ---------------------------------------------------------------- exits
# each returns (exit index, exit price) given entry bar j (filled at open[j]) and the frame
def x_time(n, stop_pct=None):
    def run(f, j):
        e = f.open.iat[j]
        stop = e * (1 - stop_pct) if stop_pct else None
        for k in range(j, min(j + n, len(f))):
            if stop and f.low.iat[k] <= stop:
                return k, min(f.open.iat[k], stop) if k > j else stop
        k = min(j + n, len(f)) - 1
        return k, f.close.iat[k]
    return run


def x_pullback(f, j):    # out on the first close above the 5-day average, or after 10 sessions
    for k in range(j, min(j + 10, len(f))):
        if f.close.iat[k] > f.sma5.iat[k]:
            return k, f.close.iat[k]
    k = min(j + 10, len(f)) - 1
    return k, f.close.iat[k]


def x_trail(ma, stop_pct):   # trend follow: out on a close below the moving average; hard stop below entry
    def run(f, j):
        e = f.open.iat[j]
        stop = e * (1 - stop_pct)
        for k in range(j, len(f)):
            if f.low.iat[k] <= stop:
                return k, min(f.open.iat[k], stop) if k > j else stop
            if f[ma].iat[k] and f.close.iat[k] < f[ma].iat[k]:
                return k, f.close.iat[k]
        return len(f) - 1, f.close.iat[-1]
    return run


def x_cross(fast, slow):
    def run(f, j):
        for k in range(j, len(f)):
            if f[fast].iat[k] < f[slow].iat[k]:
                return k, f.close.iat[k]
        return len(f) - 1, f.close.iat[-1]
    return run


def x_rsi_rev(f, j):    # the app's current RSI pair: out when RSI falls back under 70, stop 5 %, target 8 %
    e = f.open.iat[j]
    for k in range(j, len(f)):
        if f.low.iat[k] <= e * 0.95:
            return k, min(f.open.iat[k], e * 0.95) if k > j else e * 0.95
        if f.high.iat[k] >= e * 1.08:
            return k, max(f.open.iat[k], e * 1.08) if k > j else e * 1.08
        if f.rsi14.iat[k - 1] > 70 and f.rsi14.iat[k] <= 70:
            return k, f.close.iat[k]
    return len(f) - 1, f.close.iat[-1]


STRATS = {
    "sma_20_50_cross (today)": (e_sma_cross, x_cross("sma20", "sma50")),
    "rsi_reversal (today)": (e_rsi_rev, x_rsi_rev),
    "golden_cross_50_200": (e_golden, x_cross("sma50", "sma200")),
    "golden_cross_50_200 + mkt": (e_golden_mkt, x_cross("sma50", "sma200")),
    "pullback_rsi2": (e_pullback, x_pullback),
    "high52_volume": (e_hi52, x_trail("sma50", 0.10)),
    "squeeze_breakout": (e_squeeze, x_trail("sma20", 0.08)),
    "sma50_bounce": (e_sma50_bounce, x_trail("sma50", 0.08)),
    "rs_leader_breakout": (e_rs_breakout, x_trail("sma50", 0.10)),
    "gap_up_volume": (e_gap, x_trail("sma20", 0.08)),
}

HORIZONS = (5, 10, 20, 60)


def run_strategy(entry, exit_):
    trades, events = [], []
    for s, f in stocks.items():
        sig = entry(f).fillna(False).to_numpy()
        busy_until = -1
        dates = f.date.to_numpy()
        closes = f.close.to_numpy()
        opens = f.open.to_numpy()
        for i in np.flatnonzero(sig):
            if dates[i] < np.datetime64(START) or i + 1 >= len(f):
                continue
            j = i + 1
            # event study: forward returns from the next open, regardless of overlap
            ev = {"date": dates[i]}
            for h in HORIZONS:
                ev[f"r{h}"] = closes[j + h - 1] / opens[j] - 1 if j + h - 1 < len(f) else np.nan
            events.append(ev)
            if i <= busy_until:
                continue
            k, px = exit_(f, j)
            busy_until = k
            trades.append({"symbol": s, "date": dates[i], "ret": px / opens[j] - 1 - COST, "days": k - j + 1,
                           "open": k == len(f) - 1})
    return pd.DataFrame(trades), pd.DataFrame(events)


def baseline():
    """Random entry: forward return from every stock-day's next open, per period."""
    rows = []
    for s, f in stocks.items():
        o, c = f.open.to_numpy(), f.close.to_numpy()
        n = len(f)
        df = pd.DataFrame({"date": f.date.to_numpy()[:-1]})
        for h in HORIZONS:
            r = np.full(n - 1, np.nan)
            m = np.arange(1, n) + h - 1 < n
            jj = np.arange(1, n)[m]
            r[m] = c[jj + h - 1] / o[jj] - 1
            df[f"r{h}"] = r
        rows.append(df)
    b = pd.concat(rows)
    return b[b.date >= START]


def summarize(t, label):
    if t.empty:
        return {"period": label, "trades": 0}
    w = t.ret > 0
    gains, losses = t.ret[w].sum(), -t.ret[~w].sum()
    return {"period": label, "trades": len(t), "win%": round(100 * w.mean(), 1),
            "avg%": round(100 * t.ret.mean(), 2), "median%": round(100 * t.ret.median(), 2),
            "avg_win%": round(100 * t.ret[w].mean(), 2) if w.any() else 0,
            "avg_loss%": round(100 * t.ret[~w].mean(), 2) if (~w).any() else 0,
            "PF": round(gains / losses, 2) if losses else np.inf, "days": round(t.days.mean(), 1),
            "%/day": round(100 * t.ret.mean() / t.days.mean(), 3)}


if __name__ == "__main__":
    base = baseline()
    is_b, oos_b = base[base.date < IS_END], base[base.date >= IS_END]
    print("BASELINE random entry (mean fwd return %, from next open, no cost)")
    for lab, b in (("IS", is_b), ("OOS", oos_b)):
        print(" ", lab, {f"r{h}": round(100 * b[f"r{h}"].mean(), 2) for h in HORIZONS},
              "up20%", round(100 * (b.r20 > 0).mean(), 1))
    out = {}
    for name, (e, x) in STRATS.items():
        t, ev = run_strategy(e, x)
        t.to_csv(D / f"trades_{name.split()[0]}.csv", index=False)
        print(f"\n=== {name}")
        for lab, tt, ee, bb in (("IS 2019-23", t[t.date < IS_END], ev[ev.date < IS_END], is_b),
                                ("OOS 2024-26", t[t.date >= IS_END], ev[ev.date >= IS_END], oos_b)):
            sm = summarize(tt, lab)
            edge = {f"x{h}": round(100 * (ee[f"r{h}"].mean() - bb[f"r{h}"].mean()), 2) for h in HORIZONS} if len(ee) else {}
            hit = round(100 * (ee.r20 > 0).mean(), 1) if len(ee) else None
            print("  ", sm, "| edge vs random (pp)", edge, "| up after 20d %", hit, "| events", len(ee))
        if len(t):
            yr = t.assign(y=pd.to_datetime(t.date).dt.year).groupby("y").ret.agg(["count", "mean"])
            print("   by year avg%:", {int(y): (int(r["count"]), round(100 * r["mean"], 2)) for y, r in yr.iterrows()})
