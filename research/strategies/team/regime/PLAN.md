# PLAN (pre-registered before any 2021+ result was looked at) - researcher "regime"

Method family: market-regime adaptation. Each day, label the market from what is known at that close; each quarter,
learn from **closed** trades only (exit_date < quarter start) how each rule did in each label; hide a rule in labels where
it has been losing (Bayesian shrinkage + minimum sample), optionally switch its plan per label. Scored only with
`team/evaluate.py`, 2021Q1..2026Q4, quarter by quarter, expanding window from 2019-07.

## Daily market table (all at the signal day's close)
Nifty close N, its 50/200-day averages, r20 = 20-session return, r60 = 60-session return; India VIX V and its own
252-session rolling median Vmed (min 120 sessions; VIX levels drifted from ~18 in 2008-20 to ~13 in 2023-26, so fixed VIX
cut-offs would label almost every recent day "calm"); breadth50 b50 (share of the stock list above its 50-day average,
from team_features); the house weather wx (sunny / mixed / stormy).

## Regime definitions (fixed thresholds, chosen a priori, never tuned on 2021+)
- R0 weather: stormy / mixed / sunny (the app's existing definition).
- R1 trend x fear (4): Nifty above/below its 200-day average x VIX above/below its own 1-year median.  **Primary.**
- R2 breadth (3): b50 < 40 % weak, 40-70 % normal, > 70 % strong.
- R3 momentum (3): r20 > 0 and r60 > 0 rising; both < 0 falling; else mixed.
- R4 trend x breadth (4): Nifty above/below its 200-day average x b50 above/below 50 %.
- R5 k-means (k = 4) on z-scored [nifty_d200, r20, r60, log(V/Vmed), b50], refit each quarter on all days before it.

## Learning (per quarter Q, per rule r, per regime k), defaults m = 50, min_n = 20
closed = trades of r with exit_date < Q start. mu_r, p_r = rule's mean net and share > 0 over closed.
shrunk mean s_k = (n_k mean_k + m mu_r) / (n_k + m); shrunk made p_k = (wins_k + m p_r) / (n_k + m).
Cells with n_k < min_n always stay on. Hidden trades are still graded (shadow record), so a label can switch back on.

## Decision rules
- D1 profit guard: off if s_k < 0.
- D2 half-edge: off if s_k < 0.5 mu_r.
- D3 coin-flip guard: off if p_k < 0.50.

## Plan adaptation P1 (needs re-run trades; default plan must reproduce team_trades exactly)
- strong_trend, sma_trend: alternative "short" plan = same entry and 4 ATR stop, review after 20 sessions instead of 60.
- rsi_dip, kk_dip: alternative "deep" plan = buy limit close - 1.5 x ATR14 instead of 1.0 x, everything else the same.
- Per (rule, regime): use the alternative if its shrunk mean > the default's (both shrunk toward the default plan's
  overall closed mean, same m, min_n), then apply D1 to the chosen plan.

## Variants (10)
V1-V6: R0..R5 with D1.  V7: R1 + D2.  V8: R1 + D3.  V9: R1 + D1 + P1.
V10: nested, per rule, each quarter: choose among R0..R5 (with D1) the definition whose own pseudo-out-of-sample record
(quarters from 2020Q1 to Q-1, scored on trades closed before Q) had the best made% gain while keeping >= 90 % of that
record's sum; ties / no history -> R1.

## Selection of "best" (fixed now)
Largest ALL made% gain 2021-26 among variants keeping >= 90 % of static ALL sum% in BOTH 2021-26 and 2024-26.
If none qualifies, the report says so. Choosing among 10 is itself a selection; the report shows all 10.

## Robustness (not new variants)
m in {20, 100}; min_n in {10, 40}; per-year table; for the best variant's regime, its 1-2 thresholds moved
(e.g. breadth cut-offs +/- 5 points, Vmed window 126 instead of 252).

## Addendum (written after V1-V10 were scored, before V11-V12 were run)
Finding from V1-V10: the cells switched off were learned mostly from one episode (the 2020 COVID crash: e.g. dips in weak
breadth / falling / stormy markets, and strong_trend "up-calm" in 2021Q1); out of sample those hidden trades made money.
Trades cluster in time, so "n trades" overstates the evidence. Two post-hoc variants, flagged as such in the report:
- V11: R1 + D1 with evidence counted in distinct signal MONTHS instead of trades (m = 6 months, min 6 months); same
  shrinkage formula otherwise. Sensitivity: m and min in {3, 12} months.
- V12: plan adaptation "storm exit" for the two trend rules: while a trade is open, if the house weather turns stormy at a
  close, sell at the next open (stop and 60-session review unchanged). Walk-forward per rule: used from a quarter on only if,
  on the same signals closed before that quarter under both plans, the storm-exit version had the higher mean. Dip rules
  unchanged; every trend signal is still taken.
That makes 12 variants in total; anything beyond is reported as data mining.

## Addendum 2 (after V11-V12; beyond 12 variants = data mining, reported as such)
V11 and V12 still lost because every lesson available on 2021-01-01 came from a single episode (2019-07..2020-12).
- V13 "two strikes": R1 + D1 (trades, m = 50), but a cell is eligible to be paused only if, among its closed trades, the
  rule lost money (mean < 0) in at least TWO different calendar years with >= 10 trades each in that cell.
