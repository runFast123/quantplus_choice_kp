"""The 'tested on past prices' record for Strong trend, using EXACTLY the rule the app runs (migration 33) and
EXACTLY the measures the live grader stores (signal_outcomes), so the live record can be compared like for like.

Rule (signal day t, all known at t's close):
  close > highest close of the 252 sessions before t (a full year of history required)
  volume >= 2 x average volume of the 50 sessions before t
  close > 50-day average close (incl. t)
  market weather 'sunny' on t (Nifty 50 above its 200-day avg, 50-day above 200-day, India VIX <= 22)
  one open trade per stock: no new signal until the previous one has closed
Plan: entry = next session's open; stop = signal close - 4 x ATR14 (simple 14-day average true range);
      out at the stop (or the open, if it gaps below), otherwise at the close of the 60th session.
Grader measures (same as private.grade_signals): r5/r20/r60 = close of the Nth session (entry day = 1) / entry - 1;
      vs Nifty 500 over the same sessions (its open on the entry day to its close on day N). Before costs.
Universe: each year's point-in-time top 300 by traded value (the app runs it on the 500 largest companies).
"""
import numpy as np
import pandas as pd

import signals as S

B, F, A = S.B, S.F, S.A
n500 = B.raw[B.raw.symbol == "^CRSLDX"].set_index("date")[["open", "close"]].sort_index()
WX = A.WX


def atr_simple(f):
    tr = pd.concat([f.high - f.low, (f.high - f.close.shift()).abs(), (f.low - f.close.shift()).abs()], axis=1).max(axis=1)
    return tr.rolling(14, min_periods=14).mean()


def grade(f, j, n):
    k = j + n - 1
    if k >= len(f):
        return np.nan, np.nan
    r = f.close.iat[k] / f.open.iat[j] - 1
    d0, d1 = f.date.iat[j], f.date.iat[k]
    if d0 in n500.index and d1 in n500.index:
        return r, r - (n500.close[d1] / n500.open[d0] - 1)
    return r, np.nan


rows, base = [], []
for s, f in F.ALL.items():
    f = f.reset_index(drop=True)
    hi = f.close.rolling(252, min_periods=252).max().shift(1)
    atr = atr_simple(f)
    wx = WX.reindex(pd.to_datetime(f.date), method="ffill").to_numpy()
    sig = ((f.close > hi) & (f.volume >= 2 * f.vol50) & (f.close > f.sma50) & (wx == "sunny")).to_numpy()
    busy = -1
    for i in range(len(f) - 1):
        d = f.date.iat[i]
        if d < B.START or s not in S.pit.get(d.year, ()):
            continue
        if wx[i] == "sunny" and i % 5 == 0:          # random-day baseline: every 5th sunny session per stock
            r20, x20 = grade(f, i + 1, 20)
            base.append((d, r20, x20))
        if not sig[i] or i <= busy:
            continue
        j = i + 1
        stop = f.close.iat[i] - 4.0 * atr.iat[i]
        end = min(j + 60, len(f))
        k, px, how = end - 1, f.close.iat[end - 1], "review" if j + 60 <= len(f) else "open"
        for m in range(j, end):
            if f.low.iat[m] <= stop:
                k, px, how = m, (min(f.open.iat[m], stop) if m > j else min(f.open.iat[m], stop)), "stop"
                break
        busy = k
        g = {f"r{n}": grade(f, j, n)[0] for n in (5, 20, 60)}
        g.update({f"x{n}": grade(f, j, n)[1] for n in (5, 20, 60)})
        rows.append({"symbol": s, "date": d, "how": how, "trade": px / f.open.iat[j] - 1, "days": k - j + 1, **g})

t = pd.DataFrame(rows)
b = pd.DataFrame(base, columns=["date", "r20", "x20"])
t.to_csv(B.D / "strong_trend_record.csv", index=False)
done = t[t.how != "open"]


def block(tt, bb, lab):
    g20 = tt.dropna(subset=["r20"])
    print(f"\n{lab}: {len(tt)} signals")
    print(f"  higher after 5 / 20 / 60 sessions: {100*(tt.r5>0).mean():.0f}% / {100*(g20.r20>0).mean():.0f}% / "
          f"{100*(tt.r60.dropna()>0).mean():.0f}%   (random sunny day, 20: {100*(bb.r20.dropna()>0).mean():.0f}%)")
    print(f"  beat the Nifty 500 over 20 / 60 sessions: {100*(g20.x20>0).mean():.0f}% / {100*(tt.x60.dropna()>0).mean():.0f}%"
          f"   (random: {100*(bb.x20.dropna()>0).mean():.0f}%)")
    print(f"  average move vs Nifty 500, 20 / 60 sessions: {100*g20.x20.mean():+.2f} / {100*tt.x60.dropna().mean():+.2f} points"
          f"   (random 20: {100*bb.x20.dropna().mean():+.2f})")
    d = tt[tt.how != "open"]
    if len(d):
        net = d.trade - 0.005
        print(f"  plan (stop or 60-session review), after 0.5% cost: {len(d)} closed, made money {100*(net>0).mean():.0f}%, "
              f"avg {100*net.mean():+.2f}%, median {100*net.median():+.2f}%, stopped out {100*(d.how=='stop').mean():.0f}%, "
              f"avg win {100*net[net>0].mean():+.1f}% / avg loss {100*net[net<=0].mean():+.1f}%")


block(t, b, "ALL 2019-07..2026-10")
block(t[t.date < "2024-01-01"], b[b.date < "2024-01-01"], "2019-07..2023-12")
block(t[t.date >= "2024-01-01"], b[b.date >= "2024-01-01"], "2024-01..2026-10")
print("\nby year:", t.assign(y=t.date.dt.year).groupby("y").apply(
    lambda g: f"{len(g)} sig, up20 {100*(g.r20.dropna()>0).mean():.0f}%, vsN500 {100*g.x20.dropna().mean():+.1f}", include_groups=False).to_dict())
