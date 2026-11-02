# Regime adaptation — REPORT (researcher "regime")

(Saved by the coordinator from the researcher's returned text; the sub-agent could not write report files itself.)

**Method.** Each day the market is labelled from that day's close: Nifty above or below its 200-day average, and India
VIX above or below its own 1-year median (4 states). Each quarter, using only trades already closed, a rule is paused in a
state where its record says it loses money; the record is shrunk toward the rule's overall average (a prior worth 50
trades; no pause with fewer than 20 trades). Variants changed how states are defined, the pause rule, and the plan per
state.

**Beginner sentence.** "If a rule has lost money in this kind of market before, we hold its signals until that changes."

## Best variant vs static (evaluate.py; made% / avg% / sum%)
No variant meets the pre-registered bar (raise ALL made% while keeping >= 90 % of sum%). V13 (post-hoc) loses least.

| period | rule | static | V13 |
|---|---|---|---|
| 2021-26 | strong_trend | 52.8 / 5.71 / 9792 | 52.8 / 5.71 / 9792 |
| | sma_trend | 49.7 / 4.18 / 3861 | 49.5 / 4.11 / 3766 |
| | rsi_dip | 63.1 / 0.90 / 2384 | 63.1 / 0.94 / 2308 |
| | kk_dip | 70.3 / 1.72 / 1522 | 70.3 / 1.79 / 1436 |
| | **ALL** | **59.2 / 2.84 / 17559** | **59.0 / 2.94 / 17303** |
| 2024-26 | strong / sma | 47.7 / 3.26 / 2140 · 45.5 / 2.26 / 1005 | same as static |
| | rsi_dip | 60.3 / 0.59 / 747 | 59.9 / 0.62 / 671 |
| | kk_dip | 66.5 / 1.46 / 620 | 65.7 / 1.57 / 535 |
| | **ALL** | **55.9 / 1.61 / 4512** | **55.0 / 1.73 / 4351** |

## Every variant (ALL made% minus static, 2021-26; share of sum% kept 2021-26 / 2024-26)
V1–V10 pre-registered; V11–V13 post-hoc (13 variants is past the ~12 limit: treat as data mining).
- V1 house weather (sunny/mixed/stormy): −1.2; 86 % / 93 %
- V2 trend x fear (main): −0.6; 92 % / 99 %
- V3 breadth (<40 / 40–70 / >70 % of stocks above their 50-day): −2.9; 83 % / 91 %
- V4 Nifty momentum (20 and 60 days): −1.7; 82 % / 94 %
- V5 trend x breadth: −0.8; 91 % / 98 %
- V6 k-means, 4 clusters: −2.6; 77 % / 96 %
- V7 pause below half the rule's average: +0.6; 65 % / 49 %
- V8 pause below 50 % made: +1.5; 42 % / 51 %
- V9 V2 + a different plan per state: −1.2; 80 % / 89 %
- V10 pick the best definition per rule each quarter: −0.6; 92 % / 99 %
- V11 evidence counted in months instead of trades: −0.5; 92 % / 99 %
- V12 sell trend trades when the weather turns stormy: −0.4; 94 % / 100 %
- V13 two strikes (pause only after losing in two separate years): −0.2; 99 % / 96 %

## Why it fails
1. Early lessons came from one episode (2019-07..2020-12, mostly the COVID crash); the trades it hid early then made money
   61–76 % of the time (the strong_trend pause alone gave up 987 points of sum%). 100 trades from one crash are one piece
   of evidence, not 100.
2. Regime effects don't last (made% by 2019-20 / 2021-23 / 2024-26): rsi_dip up-calm 66/67/54; kk_dip up-calm 59/76/51;
   sma_trend down-calm 63/78/47.
3. The ceiling is low: with perfect hindsight, pausing the worst (rule, state) groups at 90 % of sum% gains only +0.9 to
   +1.9 points.
4. The rule mix moves ALL made%: dip trades win 63–70 %, so pausing any lowers ALL made% even when the rule's own made%
   rises (V9: rsi_dip 63.1 → 67.4, kk_dip 70.3 → 72.3, yet ALL −1.2).

## Robustness (V2 unless noted)
By year ALL made%: 2021 63.3 → 61.8; 2022 52.7 → 51.1; 2023–25 about equal; 2026 55.9 → 49.1 (V13 the same).
Settings: prior 20/50/100 → −0.6/−0.6/−1.0; minimum 10/20/40 no effect; VIX median 126 days −0.1 but 82 % of sum%;
months 3/6/12 → −0.6/−0.5/−0.2; breadth cut-offs ±5 → −2.1/−3.5. Tunables: 4.

## Production (if adopted)
Postgres in the daily job: market_regime(day, state); quarterly rule_regime_stats from closed rows of
strategy_trade_results; a paused signal still stored and graded with paused_reason. Milliseconds. Risks: lessons on too
little history, VIX gaps, results depend on the VIX window, signals hidden for reasons that later prove wrong.

## Verdict: do not adopt
Useful by-product: show today's market state next to each signal as context, without hiding anything. Lessons for the
team: count evidence in independent episodes (months or years), not trades; report made% per rule as well as ALL.

Files: PLAN.md, regimes.py, walk.py, run_all.py, plans.py, storm.py, robust.py, ceiling.py, diag_hidden.py, outputs.
