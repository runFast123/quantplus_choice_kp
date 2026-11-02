"""V12 plan menu (PLAN.md addendum): the two trend rules with a "storm exit" - while a trade is open, if the house
weather turns stormy at a close (stormy that day, not stormy the day before), sell at the next open; the 4 x ATR14 stop and the 60-session review are unchanged.
Writes regime/storm_trades.parquet. Run from this folder (imports the research candles, ~2 min)."""
import numpy as np
import pandas as pd

import plans as P

S, R, B = P.S, P.R, P.B


def trend_storm(f, kind, hold=60, stop_k=4.0):
    f = f.reset_index(drop=True)
    atr = R.atr_simple(f).to_numpy()
    wx = R.WX.reindex(pd.to_datetime(f.date), method="ffill").to_numpy()
    if kind == "strong_trend":
        hi = f.close.rolling(252, min_periods=252).max().shift(1)
        sig = ((f.close > hi) & (f.volume >= 2 * f.vol50) & (f.close > f.sma50) & (wx == "sunny")).to_numpy()
    else:
        sig = (B.e_sma_cross(f) & (f.rs_rank >= 0.7)).fillna(False).to_numpy()
    o, l, c = f.open.to_numpy(), f.low.to_numpy(), f.close.to_numpy()
    out, busy, n = [], -1, len(f)
    for i in np.flatnonzero(sig):
        if i <= busy or i + 1 >= n or (kind == "sma_trend" and np.isnan(atr[i])):
            continue
        j = i + 1
        stop = c[i] - stop_k * atr[i]
        end = min(j + hold, n)
        k, px, how = end - 1, c[end - 1], "REVIEW_60" if j + hold <= n else "OPEN"
        for m in range(j, end):
            if l[m] <= stop:
                k, px, how = m, min(o[m], stop), "STOP_HIT"
                break
            if wx[m] == "stormy" and wx[m - 1] != "stormy" and m < end - 1:     # the weather TURNED stormy
                if m + 1 >= n:
                    k, px, how = n - 1, c[n - 1], "OPEN"
                else:
                    k, px, how = m + 1, o[m + 1], "STORM"
                break
        busy = k
        out.append((f.date.iat[i], f.date.iat[j], f.date.iat[k], px / o[j] - 1 - P.COST, how, k - j + 1))
    return out


if __name__ == "__main__":
    parts = [P.collect(r, (lambda f, r=r: trend_storm(f, r))) for r in ("strong_trend", "sma_trend")]
    p = pd.concat(parts, ignore_index=True)
    p["signal_date"] = pd.to_datetime(p.signal_date)
    for c in ("entry_date", "exit_date"):
        p[c] = pd.to_datetime(p[c])
    p.to_parquet(P.HERE / "storm_trades.parquet", index=False)
    pre = p[p.signal_date < "2021-01-01"]
    print(pre.groupby("rule").agg(n=("net", "size"), storm=("how", lambda x: (x == "STORM").mean())).round(3))
