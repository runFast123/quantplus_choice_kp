"""Can KK's short side be fixed? Mirror images of the fixes that worked for the buys (written down before running):
  S0  today: KK short (high pushes 1 % over the 20-day high, confirmed by trading under that day's low), 5-session plan
  SB1 the push over the 20-day high in a downtrend stock (below its 200-day average); short at the next open;
      cover on the first close below the 5-day average (10 sessions at most); 5 ATR safety stop above
  SB2 SB1, but short only if the next day RALLIES to close + 1.0 ATR (a limit sell; strict fill: 0.2 % through)
  SB3 SB2 + the market is not sunny (mixed or stormy)
  SB4 RSI(2) > 90 in a stock in a firm downtrend (below the 200-day, 50-day under the 200-day); rally entry; cover
  SB5 SB4 + stormy market only
  SB6 SB2 + firm downtrend (50-day under the 200-day and the 200-day falling)
Choose on 2019-23, report 2024-26. Point-in-time top 300, 0.5 % cost (borrow / futures carry not included: a
cash-market short can't be held overnight in India; it would need stock futures, ~200 F&O names).
"""
import numpy as np
import pandas as pd

import improve as I
import improve2 as J

B, F, S = I.B, I.F, I.S


def cover_into_weakness(max_days=10, stop_atr=5.0):
    def run(f, j, e):
        stop = e + stop_atr * f.atr14.iat[j - 1]
        end = min(j + max_days, len(f))
        for k in range(j, end):
            if f.high.iat[k] >= stop:
                return k, max(f.open.iat[k], stop) if k > j else stop
            if f.close.iat[k] < f.sma5.iat[k]:
                return k, f.close.iat[k]
        return end - 1, f.close.iat[end - 1]
    return run


def run_short(entry, exit_, rally_atr=None, through=0.002):
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
            if rally_atr:
                lim = f.close.iat[i] + rally_atr * f.atr14.iat[i]
                if f.high.iat[j] < lim * (1 + through):
                    continue
                e = max(f.open.iat[j], lim)
            else:
                e = f.open.iat[j]
            k, px = exit_(f, j, e)
            busy = k
            rows.append((d, 1 - px / e - I.COST, k - j + 1))
    return pd.DataFrame(rows, columns=["date", "net", "days"])


down = lambda f: f.close < f.sma200
firm_down = lambda f: (f.close < f.sma200) & (f.sma50 < f.sma200)
falling200 = lambda f: f.sma200 < f.sma200.shift(20)
push_up = lambda f: f.high >= f.hi20p * 1.01

VARIANTS = {
    "SB1 push over 20d high, downtrend, next open": (lambda f: push_up(f) & down(f), None),
    "SB2 SB1 + rally entry 1.0 ATR": (lambda f: push_up(f) & down(f), 1.0),
    "SB3 SB2 + market not sunny": (lambda f: push_up(f) & down(f) & (f.wx != "sunny"), 1.0),
    "SB4 RSI2>90, firm downtrend, rally entry": (lambda f: (f.rsi2 > 90) & firm_down(f), 1.0),
    "SB5 SB4 + stormy market only": (lambda f: (f.rsi2 > 90) & firm_down(f) & (f.wx == "stormy"), 1.0),
    "SB6 SB2 + firm downtrend, falling 200d": (lambda f: push_up(f) & firm_down(f) & falling200(f), 1.0),
}

if __name__ == "__main__":
    t0 = I.run_kk("sell", lambda f: f.close > 0, I.x_kk_short_today)
    print(f"  {'S0 today: KK shorts':45s} {I.summary(t0)}")
    for name, (e, rally) in VARIANTS.items():
        t = run_short(e, cover_into_weakness(), rally)
        t.to_csv(B.D / f"improve_{name.split()[0]}.csv", index=False)
        print(f"  {name:45s} {I.summary(t)}")
        if len(t):
            print("      by year:", t.assign(y=t.date.dt.year).groupby("y").net.agg(
                lambda x: f"{len(x)}: {100*(x<=0).mean():.0f}% wrong {100*x.mean():+.2f}%").to_dict())
