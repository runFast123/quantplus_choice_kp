# params — round 2

(Saved by the coordinator from the researcher's returned text. Plan pre-registered at the top of `round2.py` before any
run; `data/signals.parquet` hash unchanged; `signals` never imported.)

## Critiques
**regime.** Strongest flaw: censoring. Each quarter it learned from trades already closed; for the 60-session trend rules
those are mostly stop-outs (18–20 % made vs 52–54 % for the full cohort), so it paused them just before recoveries
(strong_trend pause −987 sum). Evidence is mostly one episode (COVID), across 13 variants. Judged on ALL made%, V9's dip
gains (63.1→67.4, 70.3→72.3) were hidden by the mix. Verdict (no pauses) survives. C3's "record in this state" does not:
per-state records flip between periods (rsi up-calm 66/67/54).

**metalabel.** Strongest flaw: data mining. 26 variants, best (V26) post-hoc, ALL made% only +0.5/+0.1; its null matched
on count, not rule × year. The display finding is real: from the stored complete-cohort, forward-calibrated LR
predictions, High − Low made% is 17.7/17.0 points (rsi_dip, 2021-26/2024-26) and 17.6/17.9 (kk_dip); all four beat a
rule × year shuffle (95th percentile ≤ 7.5; p < 0.001). Caveat: 42–58 % of dip signals land in Low. Verdict survives.

**health.** Strongest flaw: censoring plus the null. V8 used trades closed before the signal day — for trend rules mostly
stop-outs — which is why strong_trend's 2024-26 made% fell at all nine settings. +1.6 made% vanished under the rule × year
null (p = 0.41). Worst quarter / drawdown are on summed trade returns, not a portfolio, and partly come from 14 % fewer
trades. Verdict survives only as a complete-cohort card for dips; a trend card is ≥ 65 sessions late.

## New variants
**R1 / R2:** trend-rule plan (stop × review horizon; entry filter fixed) chosen on complete design cohorts only (signals
2019-07 .. 2023-08-16, all closed by 2023-12-29). R1 picks by average per trade, R2 by return per 100 days in a trade.
Dip rules static. Both picked a 90-session plan; both fail the 2024-26 check:

| 2024-26 | made | avg | sum | worst5 | days | /100d |
|---|---|---|---|---|---|---|
| strong static 4/60 | 47.7 | 3.26 | 2,140 | −16.6 | 46 | 7.05 |
| R1 5/90 | 47.9 | 3.11 | 1,651 | −20.2 | 71 | 4.38 |
| R2 4/90 | 43.7 | 2.91 | 1,600 | −18.0 | 65 | 4.52 |
| sma static 4/60 | 45.5 | 2.26 | 1,005 | −17.1 | 45 | 5.03 |
| R1 4/90 | 42.8 | 2.41 | 988 | −17.5 | 61 | 3.97 |
| R2 3/90 | 33.2 | 1.16 | 505 | −14.4 | 49 | 2.36 |
| ALL static / R1 / R2 | 55.9 / 56.1 / 53.5 | 1.61 / 1.52 / 1.29 | 4,512 / 4,005 / 3,472 | | 21 / 27 / 24 | 7.70 / 5.65 / 5.33 |

- Nothing is skipped, so the null is a block bootstrap by signal month: p(avg new ≤ today) = 0.58 / 0.45 (R1),
  0.69 / 0.77 (R2).
- 2021-26 contains the design years (in-sample): strong static 52.8/5.71/9,792, R1 56.2/8.65/12,350, R2 51.7/7.99/11,737;
  sma 49.7/4.18/3,861, 47.0/6.29/5,382, 39.5/5.32/4,770; ALL 59.2/2.84/17,559, 60.1/3.72/21,638, 57.7/3.46/20,413.
- **The 5 × ATR / 90 preference was a 2020-23 bull-market effect. Keep 4 × ATR / 60.**

**R3 (C4 check):** complete cohorts, 12-month outcomes, 18 quarters. Rank correlation of settings' past vs next-year
results 0.25 / 0.62 / 0.21 / −0.01 (strong / sma / rsi / kk; permutation p < 0.001 except kk 0.60; overlapping quarters
make these optimistic). Today's own rank does not predict its next rank (−0.74 to 0.29). The past-best setting beat
today's the next year in only 44 / 94 / 56 / 50 % of quarters. Fails the pre-registered bar.

**What a 90-session plan does to self-checks:** trend trades already closed within 100 days of a quarter start made money
18–20 % of the time on 60 sessions and 0 % on 90 (only stop-outs close that early), vs 52–54 % for the cohort; the
complete-cohort lag grows from 65 to 95 sessions (~4.5 months).

## Votes
- **C1 Health card:** display only, dip rules, only if the complete-cohort rebuild passes bar (a) or (b). Reject for trend
  rules (feedback too late).
- **C2 Confidence tier:** adopt as display on dip rules (passes bar (a) vs the rule × year null). Reject as a filter until
  paper-traded.
- **C3 Market state:** display only, as plain context; don't show each rule's per-state record (it flips between periods).
- **C4 Plan monitor:** reject as a product feature; keep as an internal research script. Its only lead (sma, past-best won
  94 % of quarters) needs fresh data.

## Design I would ship
Keep the four rules unchanged (4 × ATR / 60 re-confirmed). Add metalabel's High / Normal / Low tier on dip-rule signals,
display only, retrained quarterly on complete cohorts with forward calibration. Nothing hidden; every signal still graded.
Beginner: "Dip signals show how similar past signals turned out; the rules themselves don't change."

Files: round2.py, out/round2_out.txt, out/round2_c4_quarters.csv.
