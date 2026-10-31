"""The tested record of the two dip rules (ADR-036), with EXACTLY the rules migration 35 runs:
  rsi_dip  RSI(2) < 10 (Wilder-style EWM, alpha 1/2) and close above the 200-day average
  kk_dip   the low 1 % or more under the lowest low of the previous 20 sessions, close above the 200-day average
  plan     next session only: buy if the low trades 0.2 % through close - 1.0 x ATR14 (EWM, alpha 1/14), filled at
           min(open, limit); sell at the first close above the 5-day average, else the close of the 10th session;
           safety stop entry - 5 x ATR14 (filled at the stop, or the open if it gaps under). One trade per stock.
Point-in-time top 300 per year, 0.5 % round-trip cost. Prints the numbers used in web/src/lib/dip-rules.ts.
Run on another candle file (expect mode) with: python record_dip.py --live  (data/live_candles.parquet) and it writes
data/expected_dip_signals.csv for comparison with the SQL (pglite_live.mjs).
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

D = Path(__file__).parent / "data"
COST = 0.005
LIVE = "--live" in sys.argv


def ewm(x, alpha):
    out = np.full(len(x), np.nan)
    acc = np.nan
    for t, v in enumerate(x):
        if np.isnan(v):
            out[t] = acc
            continue
        acc = v if np.isnan(acc) else (1 - alpha) * acc + alpha * v
        out[t] = acc
    return out


def frame(f):
    f = f.sort_values("date").reset_index(drop=True)
    c, h, l = f.close.to_numpy(float), f.high.to_numpy(float), f.low.to_numpy(float)
    prev = np.r_[np.nan, c[:-1]]
    tr = np.nanmax(np.vstack([h - l, np.abs(h - prev), np.abs(l - prev)]), axis=0)
    atr = ewm(tr, 1 / 14)
    atr[:13] = np.nan
    d = np.r_[np.nan, np.diff(c)]
    g, ls = ewm(np.where(np.isnan(d), np.nan, np.clip(d, 0, None)), 0.5), ewm(np.where(np.isnan(d), np.nan, np.clip(-d, 0, None)), 0.5)
    with np.errstate(divide="ignore", invalid="ignore"):
        rsi2 = np.where(ls == 0, 100.0, 100 - 100 / (1 + g / ls))
    rsi2[:2] = np.nan
    f["atr"] = atr
    f["rsi2"] = rsi2
    f["sma5"] = f.close.rolling(5, min_periods=5).mean()
    f["sma200"] = f.close.rolling(200, min_periods=200).mean()
    f["lo20p"] = f.low.rolling(20, min_periods=20).min().shift(1)
    return f


def trades(f, rule):
    sig = ((f.rsi2 < 10) if rule == "rsi_dip" else (f.low <= 0.99 * f.lo20p)) & (f.close > f.sma200)
    o, h, l, c, s5, atr = (f[k].to_numpy(float) for k in ("open", "high", "low", "close", "sma5", "atr"))
    n, busy, out, watch = len(f), -1, [], None
    for i in np.flatnonzero(sig.fillna(False).to_numpy()):
        if i <= busy or np.isnan(atr[i]):
            continue
        lim = round(c[i] - atr[i], 2)        # a real order price (paise), same as the SQL
        j = i + 1
        if j >= n:
            watch = (f.date.iat[i], round(lim, 2))
            continue
        if l[j] > lim * 0.998:
            continue
        e = min(o[j], lim)
        stop = e - 5 * atr[i]
        k = px = how = None
        for m in range(j, min(j + 10, n)):
            if l[m] <= stop:
                k, px, how = m, (min(o[m], stop) if m > j else stop), "STOP_HIT"
                break
            if c[m] > s5[m]:
                k, px, how = m, c[m], "BOUNCE"
                break
        if k is None:
            if j + 9 >= n:
                out.append((f.date.iat[i], f.date.iat[j], None, round(e, 4), None, None))
                busy = n
                continue
            k, px, how = j + 9, c[j + 9], "TIME_10"
        busy = k
        out.append((f.date.iat[i], f.date.iat[j], f.date.iat[k], round(e, 4), px, how))
    return out, watch


if __name__ == "__main__":
    if LIVE:
        c = pd.read_parquet(D / "live_candles.parquet")
        c["date"] = pd.to_datetime(c.ts, utc=True).dt.tz_convert("Asia/Kolkata").dt.date
        sy = pd.read_csv(D / "live_symbols.csv")
        names = set(sy[(sy.segment == "equity") & (sy.mcap_rank <= 500)].symbol)
        rows = []
        for s, f in c[c.symbol.isin(names)].groupby("symbol"):
            for rule in ("rsi_dip", "kk_dip"):
                tr, watch = trades(frame(f.copy()), rule)
                rows += [(s, rule, *t) for t in tr]
        e = pd.DataFrame(rows, columns=["symbol", "strategy", "signal_day", "entry_day", "exit_day", "fill", "exit", "result"])
        e.to_csv(D / "expected_dip_signals.csv", index=False)
        print(e.groupby("strategy").size().to_dict(), "open:", e.exit_day.isna().sum())
        sys.exit(0)

    import signals as S          # point-in-time list and the 7-year research candles
    out = {}
    for rule in ("rsi_dip", "kk_dip"):
        rows = []
        for s, f in S.F.ALL.items():
            f = frame(f[["date", "open", "high", "low", "close", "volume"]].copy())
            tr, _ = trades(f, rule)
            for sd, ed, xd, e, px, how in tr:
                if px is None or sd < S.B.START or s not in S.pit.get(sd.year, ()):
                    continue
                rows.append((sd, px / e - 1 - COST, how))
        t = pd.DataFrame(rows, columns=["date", "net", "how"])
        out[rule] = t
        for lab, g in (("ALL 2019-07..2026-10", t), ("2019-23", t[t.date < "2024-01-01"]), ("2024-26", t[t.date >= "2024-01-01"])):
            w = g.net > 0
            print(f"{rule} {lab:22s} {len(g):5d} trades | made money {100*w.mean():.0f}% | avg {100*g.net.mean():+.2f}% | "
                  f"avg win {100*g.net[w].mean():+.1f}% / loss {100*g.net[~w].mean():+.1f}% | "
                  f"stop {100*(g.how=='STOP_HIT').mean():.0f}% bounce {100*(g.how=='BOUNCE').mean():.0f}% time {100*(g.how=='TIME_10').mean():.0f}%")
