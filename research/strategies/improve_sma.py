"""Can SMA 20/50 cross be fixed? Variants written down before running (ADR-037 research).

Diagnosis (diagnose.py, live record): the cross buys late, whipsaws (11 % of trades end within 10 sessions at about
-4 %), fails most in stocks still under their 200-day average, and the cross-down exit gives back much of each gain:
on the stored signals 29 % of trades made money, -0.95 % a trade.

Entries (all: the 20-day average closes above the 50-day average that day; entry at the next open)
  E0 today
  E1 + the stock above a rising 200-day average
  E2 E1 + market sunny
  E3 E1 + a leader: 6-month return in the top 30 % of the list that day
  E4 E3 + market sunny
  E5 + a leader only
Exits
  cross   the 20-day average closes back under the 50-day (today's exit)
  ma50    the close under the 50-day average
  trail   initial stop 3 x ATR under the entry, then the highest close - 3 x ATR (only moves up)
  hold60  safety stop 4 x ATR, otherwise the close of the 60th session (Strong trend's plan)
Choose on 2019-07..2023-12 (avg trade after costs, with at least 150 trades a year), report 2024-01..2026-10 for all.
Point-in-time top 300, 0.5 % round-trip cost.
"""
import pandas as pd

import adaptive as A
import backtest as B
import improve as I


def wrap(x):
    return lambda f, j, e: x(f, j)


def x_ma50(f, j):
    for k in range(j, len(f)):
        if f.close.iat[k] < f.sma50.iat[k]:
            return k, f.close.iat[k]
    return len(f) - 1, f.close.iat[-1]


trend = lambda f: (f.close > f.sma200) & f.sma200_up
leader = lambda f: f.rs_rank >= 0.7
sunny = lambda f: f.wx == "sunny"
cross = B.e_sma_cross

ENTRIES = {
    "E0 today": cross,
    "E1 +uptrend": lambda f: cross(f) & trend(f),
    "E2 E1+sunny": lambda f: cross(f) & trend(f) & sunny(f),
    "E3 E1+leader": lambda f: cross(f) & trend(f) & leader(f),
    "E4 E3+sunny": lambda f: cross(f) & trend(f) & leader(f) & sunny(f),
    "E5 +leader": lambda f: cross(f) & leader(f),
}
EXITS = {
    "cross": wrap(B.x_cross("sma20", "sma50")),
    "ma50": wrap(x_ma50),
    "trail": wrap(A.x_chandelier(3, 3)),
    "hold60": wrap(A.x_hold_atr(60, 4)),
}

if __name__ == "__main__":
    rows = []
    for en, e in ENTRIES.items():
        for xn, x in EXITS.items():
            t = I.run_close_rule(e, x)
            t.to_csv(B.D / f"improve_sma_{en.split()[0]}_{xn}.csv", index=False)
            for lab, g in (("2019-23", t[t.date < I.IS_END]), ("2024-26", t[t.date >= I.IS_END])):
                yrs = 4.5 if lab == "2019-23" else 2.83
                w = g.net > 0
                rows.append((en, xn, lab, len(g), round(len(g) / yrs), round(100 * w.mean(), 1), round(100 * g.net.mean(), 2),
                             round(g.net[w].sum() / -g.net[~w].sum(), 2) if (~w).any() else None, round(g.days.mean(), 1)))
            print(f"  {en:14s} {xn:7s} {I.summary(t)}", flush=True)
    out = pd.DataFrame(rows, columns=["entry", "exit", "period", "trades", "per_year", "made_money_pct", "avg_pct", "pf", "days"])
    out.to_csv(B.D / "improve_sma_summary.csv", index=False)
