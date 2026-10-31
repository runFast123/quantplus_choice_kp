"""What an investor would actually have seen: ₹ split into 10 equal slots, take new signals (strongest
6-month return first) whenever a slot is free, the strategy's exit rule closes it. Daily mark-to-market,
0.25 % round trip. Compared with buying and holding the Nifty 50 and Nifty 500 indices."""
import numpy as np
import pandas as pd

import backtest as B

SLOTS = 10


def x_low20(f, j):   # trail: out on a close below the lowest low of the previous 20 sessions; 10 % hard stop
    e = f.open.iat[j]
    for k in range(j, len(f)):
        if f.low.iat[k] <= e * 0.9:
            return k, min(f.open.iat[k], e * 0.9) if k > j else e * 0.9
        if f.close.iat[k] < f.lo20.iat[k]:
            return k, f.close.iat[k]
    return len(f) - 1, f.close.iat[-1]


def x_hold(n):
    def run(f, j):
        e = f.open.iat[j]
        for k in range(j, min(j + n, len(f))):
            if f.low.iat[k] <= e * 0.88:
                return k, min(f.open.iat[k], e * 0.88) if k > j else e * 0.88
        k = min(j + n, len(f)) - 1
        return k, f.close.iat[k]
    return run


def simulate(entry, exit_, lo, hi, rank=True):
    by_date = {}
    for s, f in B.stocks.items():
        sig = entry(f).fillna(False).to_numpy()
        for i in np.flatnonzero(sig):
            d = f.date.iat[i]
            if lo <= d < hi and i + 1 < len(f):
                key = -(f.rs_rank.iat[i] if not np.isnan(f.rs_rank.iat[i]) else 0) if rank else hash((s, i)) % 997
                by_date.setdefault(f.date.iat[i + 1], []).append((key, s, i + 1))
    dates = sorted(d for d in B.idx.date if lo <= d < hi)
    pos = {}       # symbol -> (entry index, exit index, exit px, alloc)
    cash, equity, n_trades = 1.0, [], 0
    closes = {s: f.set_index("date").close for s, f in B.stocks.items()}
    for d in dates:
        # close trades that exit today
        for s in list(pos):
            j, k, px, alloc, e = pos[s]
            if B.stocks[s].date.iat[k] <= d:
                cash += alloc * (px / e) * (1 - B.COST / 2)
                del pos[s]
        for _, s, j in sorted(by_date.get(d, [])):
            if len(pos) >= SLOTS or s in pos:
                continue
            f = B.stocks[s]
            k, px = exit_(f, j)
            val = cash + sum(a * (closes[t].get(d, e) / e) for t, (_, _, _, a, e) in pos.items())
            alloc = min(cash, val / SLOTS) * (1 - B.COST / 2)
            if alloc <= 0:
                break
            cash -= alloc / (1 - B.COST / 2)
            pos[s] = (j, k, px, alloc, f.open.iat[j])
            n_trades += 1
        val = cash + sum(a * (closes[t].get(d, np.nan) / e if not np.isnan(closes[t].get(d, np.nan)) else 1)
                         for t, (_, _, _, a, e) in pos.items())
        equity.append((d, val))
    eq = pd.Series(dict(equity))
    return eq, n_trades


def stats(eq):
    yrs = (eq.index[-1] - eq.index[0]).days / 365.25
    cagr = (eq.iloc[-1] / eq.iloc[0]) ** (1 / yrs) - 1
    dd = (eq / eq.cummax() - 1).min()
    return f"CAGR {100*cagr:+.1f}%  worst fall {100*dd:.0f}%  total {100*(eq.iloc[-1]/eq.iloc[0]-1):+.0f}%"


def index_eq(sym, lo, hi):
    f = B.raw[(B.raw.symbol == sym) & (B.raw.date >= lo) & (B.raw.date < hi)].set_index("date").close
    return f / f.iloc[0]


if __name__ == "__main__":
    periods = (("IS  2019-07..2023-12", B.START, B.IS_END), ("OOS 2024-01..2026-10", B.IS_END, pd.Timestamp("2027-01-01")),
               ("ALL 2019-07..2026-10", B.START, pd.Timestamp("2027-01-01")))
    for lab, lo, hi in periods:
        print(f"\n##### {lab}")
        print(f"  Nifty 50 buy & hold   {stats(index_eq('^NSEI', lo, hi))}")
        print(f"  Nifty 500 buy & hold  {stats(index_eq('^CRSLDX', lo, hi))}")
        for name, e, x in (
            ("high52_volume / sma50 exit", B.e_hi52, B.x_trail("sma50", 0.10)),
            ("high52_volume / 20d-low trail", B.e_hi52, x_low20),
            ("high52_volume / hold 60d", B.e_hi52, x_hold(60)),
            ("rs_leader / sma50 exit", B.e_rs_breakout, B.x_trail("sma50", 0.10)),
            ("rs_leader / 20d-low trail", B.e_rs_breakout, x_low20),
            ("rs_leader / hold 60d", B.e_rs_breakout, x_hold(60)),
            ("pullback_rsi2", B.e_pullback, B.x_pullback),
            ("sma_20_50_cross (today)", B.e_sma_cross, B.x_cross("sma20", "sma50")),
            ("rsi_reversal (today)", B.e_rsi_rev, B.x_rsi_rev),
        ):
            eq, n = simulate(e, x, lo, hi)
            print(f"  {name:32s} {stats(eq)}  trades {n}")
