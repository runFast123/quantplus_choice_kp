"""Fair comparison for the portfolio test.
 * benchmark 1: equal-weight buy & hold of the SAME stocks (removes the 'today's winners' bias from the comparison)
 * benchmark 2: random entries (same daily signal count, same slots, same exit) - 5 seeds
 * universe check: only stocks that were already in the top 300 by traded value in the 6 months BEFORE the period
   starts (a point-in-time list - closer to what an investor could have known then)
"""
import numpy as np
import pandas as pd

import backtest as B
import portfolio as P

periods = (("IS  2019-07..2023-12", B.START, B.IS_END), ("OOS 2024-01..2026-10", B.IS_END, pd.Timestamp("2027-01-01")))
ALL = dict(B.stocks)


def pit_universe(lo, top=300):
    tv = {}
    for s, f in ALL.items():
        w = f[(f.date < lo) & (f.date >= lo - pd.Timedelta(days=183))]
        if len(w) > 100:
            tv[s] = (w.close * w.volume).median()
    return set(sorted(tv, key=tv.get, reverse=True)[:top])


def ew(lo, hi, names):
    rets = []
    for s in names:
        f = ALL[s]
        f = f[(f.date >= lo) & (f.date < hi)].set_index("date").close.pct_change()
        rets.append(f)
    r = pd.concat(rets, axis=1).mean(axis=1).fillna(0)
    return (1 + r).cumprod()


def random_entry(rate, seed):
    rng = np.random.default_rng(seed)

    def e(f):
        return pd.Series(rng.random(len(f)) < rate, index=f.index) & (f.sma200.notna())
    return e


STRATS = (
    ("high52_volume / sma50 exit", B.e_hi52, B.x_trail("sma50", 0.10)),
    ("high52_volume / hold 60d", B.e_hi52, P.x_hold(60)),
    ("rs_leader / sma50 exit", B.e_rs_breakout, B.x_trail("sma50", 0.10)),
    ("rs_leader / hold 60d", B.e_rs_breakout, P.x_hold(60)),
    ("pullback_rsi2", B.e_pullback, B.x_pullback),
    ("sma_20_50_cross (today)", B.e_sma_cross, B.x_cross("sma20", "sma50")),
    ("rsi_reversal (today)", B.e_rsi_rev, B.x_rsi_rev),
)

if __name__ == "__main__":
    for uni_label in ("today's top 500 (hindsight)", "point-in-time top 300"):
        print(f"\n================ universe: {uni_label}")
        for lab, lo, hi in periods:
            names = set(ALL) if uni_label.startswith("today") else pit_universe(lo)
            B.stocks = {s: ALL[s] for s in names}
            print(f"\n##### {lab}  ({len(names)} stocks)")
            print(f"  Nifty 50 buy & hold            {P.stats(P.index_eq('^NSEI', lo, hi))}")
            print(f"  SAME stocks equal-weight hold  {P.stats(ew(lo, hi, names))}")
            for name, e, x in STRATS:
                eq, n = P.simulate(e, x, lo, hi)
                # random baseline with the same exit; signal rate set so slots stay about as busy
                rnd = []
                for seed in range(5):
                    req, _ = P.simulate(random_entry(0.01, seed), x, lo, hi, rank=False)
                    yrs = (req.index[-1] - req.index[0]).days / 365.25
                    rnd.append((req.iloc[-1] / req.iloc[0]) ** (1 / yrs) - 1)
                print(f"  {name:30s} {P.stats(eq)}  trades {n:4d} | random entry, same exit: CAGR {100*np.mean(rnd):+.1f}% "
                      f"(range {100*min(rnd):+.0f}..{100*max(rnd):+.0f})")
