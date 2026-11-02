# Strategy health — REPORT (researcher "health")

(Saved by the coordinator from the researcher's returned text; the sub-agent could not write report files itself.)

## Method
Every day, each rule gets a "report card" built only from its trades that have already closed (exit_date before the signal
day), kept separately for each kind of market weather (stormy / mixed / sunny). The rule's status in today's weather decides:
**On watch** (half size) if its last 30 closed trades in this weather lost money on average; **Paused** (not taken; still
graded in the shadow so it can come back) if they clearly lost (t < -1); otherwise **Healthy**. A bucket with fewer than 30
closed trades falls back to the rule's last 50 closed trades.

Beginner sentence: *"If a rule's recent finished trades in today's kind of market have been losing money, we flag it and
stop counting its new signals until its record recovers."*

## evaluate.py — best pre-registered variant (V8, daily) vs static
```
 period  rule          kept trades made%  avg%   sum% worst5% vsMade  vsSum  | static trades made%  avg%   sum%
2021-26 strong_trend   0.83   1416  54.2  6.82   9431  -17.3    1.4   -361  |   1715  52.8  5.71   9792
2021-26 sma_trend      0.70    646  51.5  5.15   3022  -17.9    1.8   -839  |    924  49.7  4.18   3861
2021-26 rsi_dip        0.91   2402  63.5  1.03   2199   -7.1    0.4   -185  |   2651  63.1  0.90   2384
2021-26 kk_dip         0.96    853  70.8  1.84   1511   -7.0    0.5    -11  |    885  70.3  1.72   1522
2021-26 ALL            0.86   5317  60.8  3.29  16163  -14.9    1.6  -1396  |   6175  59.2  2.84  17559
2024-26 strong_trend   0.80    524  45.0  2.92   1472  -17.0   -2.7   -668  |    656  47.7  3.26   2140
2024-26 sma_trend      0.74    330  49.1  4.02   1245  -17.1    3.6    240  |    444  45.5  2.26   1005
2024-26 rsi_dip        0.91   1153  60.4  0.75    787   -7.4    0.1     40  |   1274  60.3  0.59    747
2024-26 kk_dip         0.92    392  67.3  1.73    635   -7.6    0.8     15  |    424  66.5  1.46    620
2024-26 ALL            0.86   2399  56.6  1.86   4139  -14.5    0.7   -373  |   2798  55.9  1.61   4512
```
Worst stretches (ALL, 2021-26): worst quarter -459 % vs static -974 % (2024 Q4); max drawdown of cumulative sum% -925 vs -1751.

## Every variant (ALL rules: made% / sum% 2021-26 · 2024-26 · worst quarter · max drawdown)
| variant | 2021-26 | 2024-26 | worst Q | max DD |
|---|---|---|---|---|
| static | 59.2 / 17559 | 55.9 / 4512 | -974 | -1751 |
| V1 rolling-50 mean, per rule | 59.9 / 14660 | 55.4 / 2648 | -848 | -1803 |
| V2 EWMA half-life 25 | 59.9 / 15248 | 55.7 / 2872 | -872 | -1641 |
| V3 Beta posterior win rate | 59.2 / 15439 | 55.2 / 3341 | -894 | -1655 |
| V4 CUSUM | 60.4 / 14811 | 57.1 / 3519 | -472 | -1256 |
| V5 SPRT on wins | 61.2 / 15177 | 56.4 / 3112 | -546 | -1366 |
| V6 P(edge>0) sizing | 59.2 / 14589 | 55.9 / 3098 | -760 | -1221 |
| V7 Thompson bandit across rules | 59.2 / 5969 | 55.9 / 1708 | -214 | -452 |
| **V8 rule x weather** | **60.8 / 16163** | **56.6 / 4139** | **-459** | **-925** |
| V9 rule x sector | 59.8 / 15341 | 55.9 / 3349 | -916 | -1321 |
| V10 mark-to-market of open signals | 59.5 / 13967 | 56.4 / 3302 | -513 | -874 |
| V11 = V8 frozen at quarter start | 60.8 / 16758 | 56.9 / 4402 | -974 | -1467 |
| V12 (post-hoc) V8 watch-only, never pause | 59.2 / 16645 | 55.9 / 4359 | -625 | -1197 |

V8 won by the pre-registered rule (best made% among variants keeping >= 90 % of static sum%).

## Robustness
- Per year: made% higher or equal in all six years; sum% lower in four of six (incl. 2022, paused before the recovery).
- Sensitivity (window 20/30/60 x pause t -0.5/-1/-2, daily and quarterly): all nine daily settings beat static on made%,
  worst quarter and drawdown; none beats it on sum% (86-98 % / 79-92 % of static). Quarterly (V11): made% 60.1-61.6,
  worst quarter always -974.
- Against random pauses of the same size (1,000 draws): V8 beats random on all measures (p < 0.001); matched also by
  rule x year, the made% gain disappears (p = 0.41) but drawdown (p = 0.02) and worst quarter (p < 0.001) remain
  significant. **It finds bad stretches; it does not pick better trades within a year.**
- Per rule: strong_trend 2024-26 made% falls at all nine daily settings (-1.1 to -4.3): its 60-session trades report
  back about three months late, so pauses land just before recoveries. Rule-level classics (V1-V5) show this everywhere.
- Whipsaw: at n = 30 a bucket changes status 2.2 times a year (median), up to 12; about 24 % of signals fall on paused
  days. n = 60 halves it.
- Parameters: 3 tunables (window 30, pause t < -1, fallback 50). 12 variants + an 18-setting grid: edge of data mining.

## Production design
SQL `private.refresh_strategy_health()` daily in `svc_refresh_market_analytics` after `grade_signals`; input = closed
trades (exit rows with pnl_pct) joined to the weather on each signal day; one window query per strategy x weather
(last 30 closed before today: avg, stddev, count, case) — milliseconds. Output `public.strategy_health(strategy, weather,
as_of, status, trades_used, avg_pct, t_stat)` with history. Signals page shows Healthy / On watch / Paused for today's
weather. Risks: late feedback on trend rules; paused signals must still be generated and graded; short live ledger (seed
from the tested record); stops close fast and winners slowly, biasing towards pausing in falls; status flips confuse
beginners; live universe top 500 vs tested top 300.

## Verdict: adopt partly
Adopt V8 as a displayed health status and risk layer (halves worst quarter and drawdown, +1.6 made% points, about 8 % less
total profit). Do not adopt rule-level pausing (CUSUM/SPRT/Beta/bandit). Do not let health remove strong_trend signals.
It is not an accuracy engine; pair it with whichever filter wins on accuracy.
