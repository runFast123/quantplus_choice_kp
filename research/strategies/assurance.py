"""The 'assurance' numbers, measured fairly: on the point-in-time list, each signal vs the average of THAT list on
the same day, split by market weather. Hit rate = share of signals that beat the list's average stock."""
import numpy as np
import pandas as pd

import adaptive as A
import backtest as B
import fair as F

H = (20, 60)


def fwd_for(names):
    rows = []
    for s in names:
        f = F.ALL[s]
        o, c, n = f.open.to_numpy(), f.close.to_numpy(), len(f)
        d = pd.DataFrame({"symbol": s, "date": f.date.to_numpy(), "wx": f.wx.to_numpy()})
        for h in H:
            r = np.full(n, np.nan)
            jj = np.arange(n - h)
            r[jj] = c[jj + h] / o[jj + 1] - 1
            d[f"r{h}"] = r
        rows.append(d)
    return pd.concat(rows)


SIGS = {
    "SMA 20/50 cross (today)": B.e_sma_cross,
    "RSI reversal (today)": B.e_rsi_rev,
    "Strong trend: 52w high + 1.5x volume, not stormy": A.trend_entry(),
    "Strong trend + top-30% 6-month strength": A.trend_entry(0.7),
    "Strong trend, 2x volume": A.trend_entry(vol_mult=2.0),
}

if __name__ == "__main__":
    for lab, lo, hi in F.periods:
        names = F.pit_universe(lo)
        fw = fwd_for(names)
        fw = fw[(fw.date >= lo) & (fw.date < hi)]
        avg = fw.groupby("date")[["r20", "r60"]].mean()
        print(f"\n=== {lab}  point-in-time top 300 | random stock: up after 20d {100*(fw.r20>0).mean():.0f}%, "
              f"after 60d {100*(fw.r60>0).mean():.0f}%")
        for name, e in SIGS.items():
            rows = []
            for s in names:
                f = F.ALL[s]
                sig = e(f).fillna(False).to_numpy()
                for i in np.flatnonzero(sig):
                    if lo <= f.date.iat[i] < hi:
                        rows.append((s, f.date.iat[i]))
            ev = pd.DataFrame(rows, columns=["symbol", "date"]).merge(fw, on=["symbol", "date"])
            for h in H:
                ev[f"x{h}"] = ev[f"r{h}"] - ev.date.map(avg[f"r{h}"])
            out = []
            for w, g in [("all", ev)] + list(ev.groupby("wx")):
                by = g.groupby("date").x20.mean().dropna()
                t = by.mean() / (by.std() / np.sqrt(len(by))) if len(by) > 2 else np.nan
                out.append(f"{w}: n={len(g)} beat-avg {100*(g.x20>0).mean():.0f}% / {100*(g.x60>0).mean():.0f}% "
                           f"edge {100*g.x20.mean():+.2f}/{100*g.x60.mean():+.2f}pp t20={t:.1f} up20 {100*(g.r20>0).mean():.0f}%")
            print(f"  {name}\n     " + "\n     ".join(out))
