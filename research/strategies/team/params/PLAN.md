# params: walk-forward parameter re-optimisation (pre-registered, written before any variant was run)

## Method
For each rule, a small 3 x 3 x 3 grid of its key settings; the centre of every grid is today's live setting.

| rule | axis 1 (signal) | axis 2 (plan) | axis 3 (plan) | today |
| --- | --- | --- | --- | --- |
| strong_trend | volume multiple 1.5 / 2 / 3 x 50-day avg | stop 3 / 4 / 5 x ATR14 | review after 40 / 60 / 90 sessions | 2, 4, 60 |
| sma_trend | leader cut-off (126-day return pct rank) 0.6 / 0.7 / 0.8 | stop 3 / 4 / 5 x ATR14 | review after 40 / 60 / 90 | 0.7, 4, 60 |
| rsi_dip | RSI(2) below 5 / 10 / 15 | buy limit close - 0.75 / 1.0 / 1.25 x ATR14 | at most 5 / 10 / 15 sessions | 10, 1.0, 10 |
| kk_dip | low pushes 0.5 / 1 / 2 % under the prior 20-day low | buy limit close - 0.75 / 1.0 / 1.25 x ATR14 | at most 5 / 10 / 15 sessions | 1 %, 1.0, 10 |

Everything else is exactly the live rule (record.py / record_sma.py / record_dip.py): market weather for strong_trend,
200-day filter for the dips, 0.2 % fill rule, dip stop 5 x ATR, first close above the 5-day average, next-open entry,
one open trade per stock, point-in-time top 300 per year, 0.5 % round-trip cost.

1. **Shadow records.** Each of the 108 grid points is run as its own fixed rule over Jul 2019 - Oct 2026 (same universe,
   costs, filters). The centre must reproduce `data/team_trades.parquet` exactly (sanity check).
2. **Choice (start of each quarter Q, 2021Q1 .. 2026Q4).** Training trades of a grid point = its shadow trades with
   `exit_date < Q` and `signal_date >= Q - 3 years` (window grows from Jul 2019 until 3 years exist). Score = the
   objective on those trades. **Neighbourhood averaging:** a point's smoothed score = equal-weight mean of the raw score
   of itself and its one-step neighbours along each axis (<= 7 points; neighbours with < 10 trades are skipped).
   **Eligible** only if the point itself has >= 50 training trades. Pick the eligible point with the best smoothed score
   (ties -> nearest to today's setting). No eligible point -> keep today's setting.
3. **Trading the quarter (exact, not stitched).** Per stock, day by day: the settings active on a signal day decide
   whether there is a signal and its plan (stop, buy limit, holding). A trade keeps the plan it opened with; one open
   trade per stock carries across quarter boundaries. Before 2021 the rules run with today's settings.
4. **Score** with `team/evaluate.py` on that stream (`take` = True for every trade). Parameter stability reported:
   chosen settings per quarter, number of switches, and the rank correlation between a grid point's training score
   and its next-quarter result (does the past winner keep winning?).

**Primary objective: average net per trade** (the scorer's avg%; simplest to explain).

## Pre-registered success test
Re-optimisation "wins" only if, on the ALL row, **both** 2021-26 and 2024-26 show higher avg% **and** higher sum% than
the static rules, with made% not more than 1 point lower. Per rule: "adopt partly" if a rule wins on both periods.

## Variants (all reported, winners and losers)
- V0  static: today's settings (reproduction check; the baseline).
- V1  PRIMARY: quarterly, 3-year window, objective avg net, neighbourhood averaging, min 50 trades.
- V2  V1 without neighbourhood averaging (raw best grid point) - shows what the safeguard is worth.
- V3  V1 with objective = sum of net (total profit in the window).
- V4  V1 with objective = made-money share (smoothed avg must also be > 0, else keep today's).
- V5  V1 with objective = t-statistic, mean / sd x sqrt(n) (quality and count together).
- V6  V1 with a 2-year window.
- V7  V1 with an expanding window (every closed trade since Jul 2019).
- V8  V1 re-chosen half-yearly (January and July) instead of quarterly.
- V9  V1 with hysteresis: move away from the current settings only if the new best's smoothed avg beats the current
      settings' smoothed avg by more than one standard error of the current settings' training trades.
- V10 choose once on 2021-01-01 with the V1 procedure, then freeze (one-time tuning, no adaptation).
- V11 DIAGNOSTIC ONLY (look-ahead, not a candidate): the single fixed grid point per rule that was best by avg on
      2021-26 itself - the most any fixed choice could have gained.

Sensitivity (reported as robustness, counted as extra runs): V1 with min trades 25 and 100.
That is 11 candidate variants + 1 diagnostic + 2 sensitivity runs; anything beyond is flagged as data mining.
