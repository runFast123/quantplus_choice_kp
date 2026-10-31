"""Round 2 (pre-registered before running):
 A. Is the RSI fix (R9) real? Stricter fills (the price must trade 0.2 % THROUGH the limit), the worst trades,
    year by year, and the neighbours of its two settings (dip 0.75 / 1.0 / 1.25 ATR; RSI2 < 5 / 10 / 15).
 B. KK, rebuilt around its idea (a push under the 20-day low that fails), the way the RSI fix works:
    KA  the push under the 20-day low in an uptrend stock; buy at the next open; sell into the first bounce (10d)
    KB  KA, but buy only on a dip of 0.5 ATR under the signal close the next day
    KC  same-day failure: the low pushes 1 % under the 20-day low but the close is back above it (uptrend stock);
        next open; sell into the first bounce
    KD  KC + not stormy
    KE  KC with the 1.0 ATR dip entry
    SA  shorts, mirror of KC in downtrend stocks (close back under the 20-day high), cover into weakness
Same rules of the house: choose on 2019-23, report 2024-26, point-in-time top 300, 0.5 % cost.
"""
import numpy as np
import pandas as pd

import improve as I

B, F, S = I.B, I.F, I.S
for s, f in F.ALL.items():
    f["sma5"] = f.close.rolling(5, min_periods=5).mean()
    f["lo20p"] = f.low.rolling(20, min_periods=20).min().shift(1)
    f["hi20p"] = f.high.rolling(20, min_periods=20).max().shift(1)


def run_strict(entry, exit_, limit_atr, through=0.002):
    rows = []
    for s, f in F.ALL.items():
        f = f.reset_index(drop=True)
        sig = entry(f).fillna(False).to_numpy()
        busy = -1
        for i in np.flatnonzero(sig):
            d = f.date.iat[i]
            if d < B.START or i + 1 >= len(f) or i <= busy or s not in S.pit.get(d.year, ()):
                continue
            j = i + 1
            if limit_atr:
                lim = f.close.iat[i] - limit_atr * f.atr14.iat[i]
                if f.low.iat[j] > lim * (1 - through):
                    continue
                e = min(f.open.iat[j], lim)
            else:
                e = f.open.iat[j]
            k, px = exit_(f, j, e)
            busy = k
            rows.append((d, px / e - 1 - I.COST, k - j + 1))
    return pd.DataFrame(rows, columns=["date", "net", "days"])


def short_fade(max_days=10):
    def run(f, j, e):
        end = min(j + max_days, len(f))
        for k in range(j, end):
            if f.close.iat[k] < f.sma5.iat[k]:
                return k, f.close.iat[k]
        return end - 1, f.close.iat[end - 1]
    return run


def run_short(entry, exit_):
    rows = []
    for s, f in F.ALL.items():
        f = f.reset_index(drop=True)
        sig = entry(f).fillna(False).to_numpy()
        busy = -1
        for i in np.flatnonzero(sig):
            d = f.date.iat[i]
            if d < B.START or i + 1 >= len(f) or i <= busy or s not in S.pit.get(d.year, ()):
                continue
            j = i + 1
            e = f.open.iat[j]
            k, px = exit_(f, j, e)
            busy = k
            rows.append((d, 1 - px / e - I.COST, k - j + 1))
    return pd.DataFrame(rows, columns=["date", "net", "days"])


def tails(t):
    return f"worst 5% {100*t.net.quantile(0.05):+.1f}%, worst {100*t.net.min():+.1f}%"


up = lambda f: f.close > f.sma200
rsi2 = lambda th: (lambda f: (f.rsi2 < th) & up(f))
push = lambda f: f.low <= f.lo20p * 0.99
same_day_fail = lambda f: push(f) & (f.close > f.lo20p)

if __name__ == "__main__":
    print("A. RSI fix (R9) under stricter fills")
    t = run_strict(rsi2(10), I.x_bounce(10), 1.0)
    print(f"  R9 strict fill (0.2% through)           {I.summary(t)}")
    print(f"     {tails(t[t.date < I.IS_END])} | {tails(t[t.date >= I.IS_END])}")
    print("     by year:", t.assign(y=t.date.dt.year).groupby("y").net.agg(lambda x: f"{len(x)}: wrong {100*(x<=0).mean():.0f}% avg {100*x.mean():+.2f}%").to_dict())
    for th in (5, 10, 15):
        for dip in (0.75, 1.0, 1.25):
            t = run_strict(rsi2(th), I.x_bounce(10), dip)
            print(f"  RSI2<{th:<2d} dip {dip:4.2f} ATR (strict)          {I.summary(t)}")

    print("\nB. KK rebuilt around its idea")
    KV = {
        "KA push under 20d low, uptrend, next open, bounce": (lambda f: push(f) & up(f), None),
        "KB KA + dip entry 0.5 ATR": (lambda f: push(f) & up(f), 0.5),
        "KC same-day failure, uptrend, next open, bounce": (lambda f: same_day_fail(f) & up(f), None),
        "KD KC + not stormy": (lambda f: same_day_fail(f) & up(f) & (f.wx != "stormy"), None),
        "KE KC + dip entry 1.0 ATR": (lambda f: same_day_fail(f) & up(f), 1.0),
        "KF KA + dip entry 1.0 ATR": (lambda f: push(f) & up(f), 1.0),
    }
    for name, (e, dip) in KV.items():
        t = run_strict(e, I.x_bounce(10), dip)
        print(f"  {name:50s} {I.summary(t)}")
    t = run_short(lambda f: (f.high >= f.hi20p * 1.01) & (f.close < f.hi20p) & (f.close < f.sma200), short_fade(10))
    print(f"  {'SA short: same-day failure at 20d high, downtrend':50s} {I.summary(t)}")
