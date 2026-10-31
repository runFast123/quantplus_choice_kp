"""Round 3: the two fixes, final checks (strict fills, 0.5 % cost, point-in-time top 300).
  RSI v2  RSI(2) < 10 in a stock above its 200-day average; buy next day only on a dip to close - 1.0 ATR;
          sell on the first close above the 5-day average, at most 10 sessions
  KK v2   the low pushes 1 % under the previous 20-day low, in a stock above its 200-day average; same dip entry
          and exit
Checks: safety stops (none / 5 / 3 ATR under the entry), year by year, worst trades, and the overlap between the
two (same stock, signals within 3 sessions).
"""
import numpy as np
import pandas as pd

import improve as I
import improve2 as J

B, F, S = I.B, I.F, I.S
rsi_v2 = J.rsi2(10)
kk_v2 = lambda f: J.push(f) & J.up(f)

if __name__ == "__main__":
    for name, e in (("RSI v2", rsi_v2), ("KK v2", kk_v2)):
        print(f"\n=== {name}")
        for stop in (None, 5.0, 3.0):
            t = J.run_strict(e, I.x_bounce(10, stop), 1.0)
            lab = f"stop {stop} ATR" if stop else "no stop"
            print(f"  {lab:12s} {I.summary(t)} | {J.tails(t[t.date >= I.IS_END])}")
        t = J.run_strict(e, I.x_bounce(10, 5.0), 1.0)
        print("  by year (5 ATR stop):", t.assign(y=t.date.dt.year).groupby("y").net.agg(
            lambda x: f"{len(x)}: wrong {100*(x<=0).mean():.0f}% avg {100*x.mean():+.2f}%").to_dict())

    # overlap: signals (not fills) of the two rules on the same stock within 3 sessions
    both = tot_r = tot_k = 0
    for s, f in F.ALL.items():
        f = f.reset_index(drop=True)
        keep = f.date.ge(B.START) & f.date.dt.year.map(lambda y: s in S.pit.get(y, ())).astype(bool)
        r = np.flatnonzero((rsi_v2(f).fillna(False) & keep).to_numpy())
        k = np.flatnonzero((kk_v2(f).fillna(False) & keep).to_numpy())
        tot_r += len(r)
        tot_k += len(k)
        both += sum(1 for i in k if len(r) and np.min(np.abs(r - i)) <= 3)
    print(f"\noverlap: {both} of {tot_k} KK v2 signals have an RSI v2 signal on the same stock within 3 sessions "
          f"({100*both/max(tot_k,1):.0f}%); RSI v2 signals {tot_r}")
