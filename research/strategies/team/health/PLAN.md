# PLAN — researcher "health" (live-performance monitoring and adaptive allocation)

Written before any variant was run. Only the dataset's structure and the pre-2021 per-rule counts were looked at.

## Idea
Every rule keeps a running report card made only from trades that have already closed. When the card turns bad the rule
goes "On watch" (half size) or "Paused" (not taken); when it turns good again the rule resumes. Paused rules keep being
graded in the shadow (production grades every signal in `signal_outcomes`), so a rule is never starved of evidence.

## Information set (no look-ahead)
- Decision for a signal on day `d` uses only trades of the same rule with `exit_date < d` (strictly before; the
  "ledger"), in exit order (ties: signal_date, symbol). History starts Jul 2019, so on 2021-01-01 every rule has
  185-407 closed trades.
- "Tested baseline" for a rule on day `d` = expanding statistics (mean, sd, win rate, avg win / avg loss) of the whole
  ledger up to `d`. Nothing is fitted on the scored period; all settings below are fixed in advance.
- Rule 1 of the brief speaks of quarter-start information. The lead's assignment asks for daily monitoring from closed
  trades, which is strictly look-ahead-free; I run it daily and ALSO run the best variant frozen at each quarter start
  (V11) so the strict reading is covered.

## Status -> action (all variants unless stated)
Healthy: take, size 1 · On watch: take, size 0.5 · Paused: not taken. Score with `team/evaluate.py` only.

## Variants (pre-registered, 11 + sensitivity grid)
- V1 rolling mean: last N=50 closed trades. mean < 0 -> On watch; mean < 0 and t = mean/se < -1 -> Paused.
- V2 EWMA: exponentially weighted mean and sd over closed trades, half-life 25 trades; same thresholds as V1
  (se from the effective sample size).
- V3 Beta posterior win rate: prior Beta centred on the ledger win rate with strength 10, updated with wins/losses
  decayed by half-life 25 trades; breakeven win rate p* = |avg loss| / (avg win + |avg loss|) from the ledger.
  P(p < p*) > 0.5 -> On watch, > 0.8 -> Paused.
- V4 CUSUM (Page, downward) on standardised net: S = min(h, max(0, S + (mu0 - x)/sd0 - k)), k = 0.25, h = 4 (mu0, sd0 =
  ledger baseline before that trade). S > h/2 -> On watch; S reaches h -> Paused, stays Paused until S < h/2. (S is
  capped at h so a crash does not bank unlimited bad evidence.)
- V5 SPRT (Wald) on win/loss: H0 p = p0 (ledger win rate before that trade), H1 p = p0 - 0.10, alpha = beta = 0.1, LLR
  clipped to [ln(1/9), ln 9]. LLR reaches ln 9 -> Paused until LLR <= 0; LLR >= ln(9)/2 -> On watch.
- Every variant needs >= 20 closed trades in its window before it judges; otherwise Healthy.
- V6 probability-of-edge sizing (Thompson-style): size = max(0.25, P(mean > 0)) = max(0.25, Phi(mean/se)) over the last
  50 closed trades; never paused.
- V7 Thompson-sampling bandit across the four rules on return per day held (net/days, last 50 closed trades each):
  size = share of 2,000 posterior draws in which the rule is best, divided by the leader's share, floor 0.25.
- V8 rule x market weather: V1 on the last 30 closed trades of the rule with the same weather (wx) as the signal day;
  fewer than 30 -> fall back to V1.
- V9 rule x sector: V1 on the last 20 closed trades of the rule in the signal's sector that exited within 365 days;
  fewer than 20 -> fall back to V1.
- V10 mark-to-market (flagged as stretching the brief's "closed trades only"): V1 on the 50 most recent signals
  (signal_date < d), closed ones at their result, still-open ones marked at the close of day d (trend rules: vs the
  entry open; dip rules: vs close x (1 - atrpct) on the signal day, the limit price). Uses only prices up to d.
- V11 the best of V1-V10 frozen at each quarter start (ledger = exit_date < quarter start).

Sensitivity (on the best, reported separately, not counted as new variants): window/half-life x {0.5, 1, 2}, main
threshold x {looser, stricter}.

## How "best" is chosen (fixed now)
Highest ALL 2021-26 made% among variants whose ALL 2021-26 sum% >= 90 % of static; tie-break 2024-26 made%. A variant
that cannot meet the 90 % bar is reported but cannot win. Also reported: paused trades' made%/avg (did pausing remove
losers?), status switches per rule-year (whipsaw), share of days paused, per year, worst quarter (sum% by signal
quarter) and max drawdown of cumulative sum% ordered by exit date.
