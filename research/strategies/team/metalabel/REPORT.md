# metalabel — a probability checker on top of each signal (meta-labelling) — REPORT

(Saved by the coordinator from the researcher's returned text; the sub-agent could not write report files itself.)

**Method.** The four rules stay as they are. Each quarter a second model (logistic regression or gradient boosting) is
trained on graded signals whose outcome was already fully known; it gives every new signal a calibrated chance of making
money, and we either skip the lowest-scoring signals or show a confidence tier.
**Beginner sentence:** "A checker looks at how similar past signals turned out and tells you how sure it is."

## Best variant vs static (evaluate.py)
Best = **V26 (post-hoc)**: LR checker on the two dip rules only, skip signals below the training 20th percentile of p;
trend signals untouched.
```
 period         rule  kept  trades  made%  avg%    sum%  worst5%  vs static made%  vs static sum%
2021-26 strong_trend  1.00    1715   52.8  5.71  9792.0    -17.3              0.0             0.0
2021-26    sma_trend  1.00     924   49.7  4.18  3861.0    -17.7              0.0             0.0
2021-26      rsi_dip  0.71    1887   65.9  1.29  2430.0     -7.0              2.8            46.0
2021-26       kk_dip  0.78     694   73.5  2.20  1526.0     -6.3              3.2             4.0
2021-26          ALL  0.85    5220   59.7  3.37 17609.0    -15.7              0.5            50.0
2024-26 strong_trend  1.00     656   47.7  3.26  2140.0    -16.6              0.0             0.0
2024-26    sma_trend  1.00     444   45.5  2.26  1005.0    -17.1              0.0             0.0
2024-26      rsi_dip  0.57     730   63.6  1.04   760.0     -7.4              3.3            13.0
2024-26       kk_dip  0.72     305   70.8  2.11   643.0     -7.2              4.3            23.0
2024-26          ALL  0.76    2135   56.0  2.13  4548.0    -15.4              0.1            36.0
```
Static ALL: 59.2 / +2.84 / 17,559 (2021-26); 55.9 / +1.61 / 4,512 (2024-26).

## Every variant (ALL: kept, made% change in points, sum% as % of static; 2021-26 | 2024-26)
| V | variant | 2021-26 | 2024-26 |
|---|---|---|---|
| 1 | pre-registered primary: HGB, purged K-fold, Platt, profit-max skip | .90, −1.0, 79 % | .90, −0.4, 82 % |
| 2 / 3 | LR / depth-3 tree, profit-max skip | −0.4, 82 % / 0.0, 62 % | +0.7, 67 % / +0.2, 55 % |
| 4 / 5 | HGB / LR, skip bottom 20 % | +0.8, 76 % / +0.9, 76 % | +1.5, 62 % / +2.1, 53 % |
| 6 / 7 | half size on Low / plus profit skip | 0.0, 78 % / −1.0, 67 % | 0.0, 72 % / −0.4, 63 % |
| 8–12 | \|net\| weights; no derived features; 3-year window; embargo 0/20; daily hit rate (info) | −1.5…−0.7, 76–86 % | −0.7…0.0, 80–99 % |
| 13–17 | Amendment A: complete-cohort training, same five actions | −0.9…+0.4, 63–79 % | −0.5…+0.7, 33–68 % |
| 18 | Amendment B: forward-only, monotone calibration, profit-max skip | .99, 0.0, 100 % | .98, 0.0, 100 % |
| 19–22 | B: LR profit-max / HGB skip 20 / LR skip 20 / half size | −0.5, 83 % / −0.1, 98 % / +0.7, 90 % / 0.0, 97 % | −0.2, 99 % / +0.6, 102 % / +0.6, 100 % / 0.0, 98 % |
| 23 | B without cohort training | +0.2, 100 % | +0.2, 101 % |
| 24 / 25 | Amendment C: checker on only if its training AUC ≥ 0.55 (HGB / LR) | −0.1, 99 % / +0.4, 91 % | −0.1, 99 % / +0.3, 102 % |
| 26 | V21 on dip rules only (post-hoc) | +0.5, 100 % | +0.1, 101 % |

26 variants, more than twice the ~12 allowed: treat V13–V26 as data mining. Each amendment was written into PLAN.md before
it ran.

## What went wrong (applies to every adaptive method)
1. **Closed-trades bias.** At a quarter start, the closed trend trades from the last ~100 days made money 9 % (strong) and
   6 % (sma) of the time vs 54 % / 51 % for the whole group: only the stop-outs have finished. Fix: use only signals whose
   maximum holding period has fully passed (complete cohorts).
2. **Flipped calibration.** Purged K-fold (fit on past and future blocks) gave OOF AUC 0.41–0.53; Platt then fitted a
   negative slope in 33–83 % of quarters and inverted mildly-right models. Fix: forward-only calibration, slope ≥ 0.
3. **Mix effect.** Skipping dip signals (which win often) raises the share of trend signals, so ALL made% barely moves
   even when each dip rule gains 3–4 points.

## Robustness
- **Trend rules: no skill.** OOS AUC 0.43–0.47. HGB abstains in 96–100 % of quarters; LR does not and loses
  (strong_trend sum −1,281 to −2,534).
- **Dip rules: real, modest skill.** AUC 0.54–0.59; tiers rank in both models. 2024-26 High vs Low tier made%:
  kk_dip LR 78.6 vs 60.6, HGB 78.0 vs 62.0; rsi_dip LR 73.6 vs 56.6, HGB 71.0 vs 56.1.
- **Per year (V26):** kk_dip made% up every year (+0.6 to +9.2); rsi_dip 0.0, +0.6, +5.3, +2.6, **−5.0 (2025)**, +10.2.
- **Skip share (LR) 10 / 20 / 30 %:** rsi_dip +1.6 / +2.8 / +3.7; kk_dip +1.6 / +3.2 / +2.7; profit flat at 10–20 %, falls
  at 30 %. HGB at 20 % lost 404 points of dip sum over 2021-26.
- **Random-skip null (500 draws, same count):** random made% −0.45, sum −609; V26 +0.49, +50; no draw matched it.
- **Calibration:** overall Brier skill vs base rate −2 to −3 % (the base rate drifts); on dip rules LR is well calibrated
  (predicted 0.53 → actual 0.57; 0.84 → 0.79).
- **Settings:** only the skip share is a real knob. Fixed in advance: LR C = 0.05, embargo 5 sessions, hit-rate window
  50, 6 forward blocks; holding spans come from the rule design.

## Production
Python step in the EOD GitHub Action. Quarterly (as tested): retrain on graded dip signals from strategy_trade_results
older than 21 days plus the embargo; store coefficients, Platt slope/intercept (slope ≥ 0) and cut-offs. Daily: score
each new dip signal (a dot product and a sigmoid — could run in SQL); write p and the tier. Risks: too many skips after a
market shift (2025: only 33 % of rsi_dip kept); production features differing from the research build (universe,
n_same_day); base-rate drift; closed-trades bias returns if anyone trains on "closed so far".

## Verdict: adopt partly
- As the team's adaptation method: do not adopt (no variant met +2 made% with ≥ 90 % of sum; best +0.5 to +0.7).
- Trend rules: never apply it.
- Dip rules: show a High / Normal / Low confidence tier, display only.
- Skipping Low dip signals (V26) looks promising but was chosen after seeing results: paper-trade it two quarters before it
  hides any signal.

Files: PLAN.md, meta.py, run_all.py, diag_slope.py, tiers_check.py, dip_only.py, out/run_all.txt.
