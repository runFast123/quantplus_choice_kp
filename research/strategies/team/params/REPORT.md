# params — walk-forward parameter re-optimisation (REPORT)

(Saved by the coordinator from the researcher's returned text; the sub-agent could not write report files itself.)

**Method.** Each rule gets a 3 x 3 x 3 grid of its key settings with today's settings at the centre. At the start of every
quarter, each rule re-picks its settings from the last 3 years of trades that had already closed; each grid point's score
is averaged with its one-step neighbours, a point needs >= 50 trades, and the winner trades the next quarter. Exact per-stock
simulation (open trades keep their plan; one trade per stock across quarters). Today's settings reproduce
team_trades.parquet trade for trade.

**Beginner sentence.** "Every three months, each rule checks which nearby version of itself did best over the last three
years and switches to it."

**Result.** The pre-registered primary (objective: average per trade) **failed** (more selective, gave up profit in
2024-26). Two other objectives passed the pre-registered test (V5 t-statistic, V4 made%), but each passed only a minority
of its stress tests.

## Best variant (V5, t-statistic) vs static
| period | rule | static made / avg / sum | V5 kept / made / avg / sum | worst5 static → V5 |
|---|---|---|---|---|
| 2021-26 | strong_trend | 52.8 / 5.71 / 9,792 | 1.01 / 56.6 / 7.25 / 12,595 | -17.3 → -19.2 |
| | sma_trend | 49.7 / 4.18 / 3,861 | 1.31 / 50.0 / 6.47 / 7,827 | -17.7 → -20.2 |
| | rsi_dip | 63.1 / 0.90 / 2,384 | 1.36 / 60.6 / 0.68 / 2,471 | -7.4 → -7.6 |
| | kk_dip | 70.3 / 1.72 / 1,522 | 1.73 / 66.3 / 1.10 / 1,685 | -7.0 → -7.9 |
| | **ALL** | **59.2 / 2.84 / 17,559** | **1.31 / 59.2 / 3.04 / 24,578** | -15.3 → -16.3 |
| 2024-26 | strong_trend | 47.7 / 3.26 / 2,140 | 1.01 / 50.6 / 3.84 / 2,540 | -16.6 → -19.1 |
| | sma_trend | 45.5 / 2.26 / 1,005 | 1.29 / 46.6 / 2.69 / 1,536 | -17.1 → -19.6 |
| | rsi_dip | 60.3 / 0.59 / 747 | 0.89 / 61.2 / 0.86 / 975 | -8.1 → -8.9 |
| | kk_dip | 66.5 / 1.46 / 620 | 1.92 / 64.3 / 0.94 / 766 | -7.7 → -8.1 |
| | **ALL** | **55.9 / 1.61 / 4,512** | **1.14 / 57.1 / 1.83 / 5,817** | -14.6 → -16.7 |

## Every variant (ALL: 2021-26 made / avg / sum · 2024-26 made / avg / sum; Pass = higher avg% and sum% in both periods, made% at most 1 point lower)
- V1 primary (avg): 60.8 / 4.39 / 19,208 · 56.2 / 2.78 / 3,453 — **Fail** (keeps 44 % of trades in 2024-26)
- V2 no neighbour averaging: 60.9 / 4.40 / 19,179 · 56.5 / 2.77 / 3,335 — Fail
- V3 sum: 58.3 / 2.60 / 23,551 · 56.2 / 1.42 / 5,146 — Fail
- V4 made%: 61.4 / 4.29 / 18,464 · 56.9 / 2.92 / 4,723 — **Pass** (by +211 sum)
- V5 t-stat: table above — **Pass**
- V6 2-year window: 60.4 / 3.64 / 15,148 · 57.0 / 2.77 / 3,620 — Fail
- V7 expanding window: 60.8 / 4.13 / 19,885 · 57.0 / 2.56 / 3,985 — Fail
- V8 half-yearly: 60.6 / 4.33 / 19,101 · 56.0 / 2.72 / 3,392 — Fail
- V9 hysteresis: 59.9 / 3.83 / 19,122 · 54.3 / 2.67 / 3,498 — Fail
- V10 choose once, freeze: 55.6 / 1.90 / 16,822 · 53.0 / 0.91 / 3,677 — Fail
- S1/S2 minimum 25/100 trades: identical to V1 (the minimum never binds)
- V11 diagnostic (look-ahead, best fixed setting by avg in hindsight): 60.9 / 6.04 / 16,362 · 55.2 / 3.00 / 3,446 — even hindsight fails
- Post-hoc stress tests (not pre-registered; past the data-mining line): V5 passes half-yearly (P3), no neighbour averaging
  (P4), trend rules only (P7); fails 2-year window (P1), expanding (P2), choose-once (P5), 1-SE hysteresis (P6). V4 passes
  only with an expanding window (P10); fails P8, P9, P11.

## Robustness
- Settings jumped: V5 switched 8 / 6 / 5 / 6 times in 24 quarters (strong / sma / rsi / kk); V4 14 / 10 / 3 / 6. V5 never
  re-chose today's settings. Winners sit on grid edges (5 x ATR stop, 90 sessions, 1.5x volume, leader 0.6, RSI 15, dip
  1.25), so the plateau safeguard rarely works.
- Past winners barely keep winning: rank correlation between training score and next-quarter result 0.21 / 0.27 / 0.22 /
  0.06; positive in 55-75 % of quarters.
- The stable version (switch only when the gap beats noise by 1 SE, P6) fails 2024-26.
- Per year (ALL, V5 vs static): avg% higher in 3 of 6 years; sum% higher in 5 of 6.
- What V5 trades away: ~31 % more trades; trend trades held ~65 sessions instead of 48; return per 100 days in a trade
  falls (11.45 % vs 12.23 %); worse tails (worst5 -16.7 vs -14.6); kk_dip avg 1.10 vs 1.72.
- Tunables: 36 grid values + 5 method settings; the window length matters most.

## Production design (if adopted)
Python job in the EOD GitHub Action on each quarter's first trading day (~11 s for the 108-point grid); a settings table
(valid_from, settings, scores) that the SQL rules read; each signal stores the settings it was issued with. Risks: track
record becomes a mix of rules; best setting keeps hitting grid edges; Python/SQL drift; a 3-year window is too slow for
"the market of the moment".

## Verdict: do not adopt automatic re-optimisation
Only 2 of 11 pre-registered variants passed, each a minority of its stress tests; rankings barely persist; V5's gain is
mostly longer holding and more trades. Adopt partly as a monitor: each quarter run the 27-setting shadow grid per rule and
report where today's settings rank. The stable finding (trend rules prefer a 5 x ATR stop and 90 sessions) deserves a
normal pre-registered static re-test (a slower plan that ties up more capital).

Note: `import signals` rewrites data/signals.parquet as a side effect.

Files: PLAN.md, engine.py, walk.py, posthoc.py, out/ (summary.csv, posthoc_summary.csv, choices.csv, persistence.csv,
walk_out.txt, posthoc_out.txt, grid_trades.parquet, team_stream_*.parquet).
