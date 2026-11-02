# metalabel — pre-registered plan (written before any walk-forward run)

Method family: meta-labelling. The four rules stay exactly as they are (primary model). A second model estimates,
for each signal on its signal day, P(trade makes money after the 0.5 % cost), and we act on that probability.

## Walk-forward protocol (all variants)
- Quarters 2021Q1 .. 2026Q4 (signal_date 2021-01-01 .. 2026-10-31). At quarter start Q the training set is every trade
  (all rules, from Jul 2019) with `exit_date < Q - embargo`. Embargo = 5 sessions (7 calendar days) by default.
  Trades still open at Q are purged. Expanding window. The quarter's signals are scored with that frozen model.
- Label y = net > 0. Features: the 23 signal-day features in team_trades.parquet + rule (categorical) + 2 derived:
  - `hr_rule`: hit rate of the rule's last 50 trades with exit_date < (start of the signal's quarter - embargo).
    Frozen per quarter, so it respects rule 1 exactly, in training and in scoring.
  - `n_same_day`: log(1 + number of same-rule signals on that signal date) (known at that close).
  Never used: net, how, days, exit_date (outcomes).
- Calibration and threshold choice use out-of-fold (OOF) predictions on the training set only: 5 contiguous time
  blocks, purged K-fold (a training trade is dropped from a fold's fit if its [signal_date, exit_date + embargo]
  overlaps the test block's [first signal, last exit]). Platt (sigmoid) calibration fitted on the OOF scores; final
  model refit on the whole training set, then calibrated with that sigmoid.
- If a rule has fewer than 100 training trades at Q, that rule's signals are all taken that quarter (no filter).

## Models (hyper-parameters fixed up front, not tuned)
- LR: logistic regression, one per rule, standardised features, median imputation, L2 with C = 0.05.
- TREE: depth-3 decision tree, pooled, rule one-hot, min_samples_leaf = 100.
- HGB: HistGradientBoostingClassifier pooled, rule categorical, max_depth 3, learning_rate 0.05, max_iter 200,
  min_samples_leaf 100, l2_regularization 1.0, random_state 0.

## Actions (thresholds from training OOF only)
- SKIP-PROFIT: per rule, choose the skip share q in {0, 10, 20, 30, 40, 50} % (lowest calibrated OOF p) that maximises
  the OOF sum of net of the kept trades (ties -> smaller q). Converted to a probability cut = that OOF quantile.
- SKIP-FIXED-x: skip signals whose p is below the training-OOF x-th percentile of the rule (x = 20 % default).
- SIZE-TIER: take all; tier per rule from training OOF tertiles of p: Low (< 33rd pct) size 0.5, Normal/High 1.0.
- TIERS shown to users: High (>= 67th pct) / Normal / Low, reported OOS as made% and avg% per tier.

## Variants (pre-registered, 12)
1. **PRIMARY: HGB + SKIP-PROFIT** (the one we will report as "best" unless it loses to the static rules).
2. LR + SKIP-PROFIT (transparent challenger).
3. TREE + SKIP-PROFIT.
4. HGB + SKIP-FIXED-20.
5. LR + SKIP-FIXED-20.
6. HGB + SIZE-TIER (take everything, half size on Low).
7. HGB + SKIP-PROFIT + SIZE-TIER on the kept trades.
8. HGB with |net| sample weights (focus on big winners/losers, López de Prado return-weighting) + SKIP-PROFIT.
9. HGB without the derived features (ablation: hr_rule, n_same_day removed) + SKIP-PROFIT.
10. HGB rolling 3-year training window instead of expanding + SKIP-PROFIT.
11. HGB embargo 0 and 20 sessions (sensitivity of variant 1; counted as one variant).
12. INFORMATIONAL ONLY (breaks the letter of rule 1, not eligible): `hr_rule` updated daily from trades closed before
    each signal date — shows whether intra-quarter feedback would add anything.

## Robustness (on the primary and on whichever model is better)
- Per-year made% / sum% vs static; per-rule.
- Threshold sensitivity: fixed skip 10 / 20 / 30 / 40 %.
- Calibration: OOS reliability by probability bucket, Brier skill vs the rule's training base rate, AUC per rule/year.
- Null test: skip the same number of signals per rule per quarter at random (500 draws) -> distribution of made% and
  sum% change; the method must beat the random-skip 95th percentile on made%.

## Win condition (set before running)
Out of sample, 2021-26 ALL: made% up by >= 2 points AND sum% >= 90 % of static; 2024-26 not worse than static on
made% and sum% >= 85 % of static; no rule's sum% drop > 25 %; beats random-skip null. Otherwise: not adopted.

## Amendment A (written after V1-V12 ran, before running anything below)
Diagnosis of V1-V12: training on "every trade with exit_date < Q" is leak-free but **outcome-censored**. For the
trend rules, the trades signalled in the ~100 days before Q that are already closed are almost only the stop-outs:
made 9 % (strong_trend) and 6 % (sma_trend) vs the true 54 % / 51 % of that cohort. The model learns "today's market
= losers" and marks the next quarter's trend signals Low; OOS AUC for strong_trend is 0.40 (anti-predictive).
Fix, standard in López de Prado's purging: train only on **complete cohorts** — a trade enters the training set only
if `signal_date < Q - embargo - H_rule`, where H_rule is the rule's maximum holding span by design (60 sessions ->
100 calendar days for the trend rules, 10 sessions -> 21 days for the dip rules), and still `exit_date < Q - embargo`.
`hr_rule` becomes the hit rate of the rule's last 50 complete-cohort trades by signal date. Nothing else changes.
New variants (this takes the total to 17, beyond the ~12 the brief allows; treat the extra ones as data mining risk):
13. HGB cohort + skip (profit-max cut)          <- new primary
14. LR cohort + skip (profit-max cut)
15. HGB cohort + skip bottom 20 %  (sensitivity 10/30/40 reported, not counted)
16. LR cohort + skip bottom 20 %
17. HGB cohort, take all, Low tier half size
Same win condition as above.

## Amendment B (written after V13-V17 ran and diag_slope.py, before running anything below)
Second diagnosis (diag_slope.py): the purged K-fold inside training is itself the problem. Holding out a time block
and fitting on the blocks around it (past AND future) gives OOF scores that are *anti*-correlated with outcomes (mean
OOF AUC 0.41-0.50 for every rule) — the classic leave-a-group-out artefact when hit rates move from one period to the
next. The Platt calibrator then fits a NEGATIVE slope in ~50-80 % of quarters and flips a model whose raw score is
mildly right out of sample (raw OOS AUC: kk_dip ~0.60, rsi_dip ~0.57, sma ~0.52, strong ~0.50).
Fix (both are design rules, not tuned):
- OOF for calibration/thresholds is **forward-only**: training split in 6 time blocks; block k is predicted by a model
  fitted on blocks < k with the same purge as the outer loop (block 1 gets no score and is not used).
- Calibration is **monotone**: Platt slope clipped at >= 0. A model that does not rank its own past correctly is
  shrunk to the base rate (every signal Normal, nothing skipped) instead of being inverted.
Complete-cohort training (Amendment A) is kept, because the censoring bias it removes is real.
New variants (total now 23 — well beyond ~12; everything from here on is exploratory and carries data-mining risk):
18. FWD HGB + skip (profit-max cut)                  <- new primary
19. FWD LR + skip (profit-max cut)
20. FWD HGB + skip bottom 20 % (sensitivity 10/30/40 reported)
21. FWD LR + skip bottom 20 %
22. FWD HGB take all, Low tier half size
23. FWD HGB without the cohort rule (exit-based training as in V1) + skip (profit-max cut)

## Amendment C (written after V18-V23 ran, before running anything below) — last one
V18-V23: once calibration can no longer flip a model, the checker abstains on the trend rules (no positive slope in
96-100 % of quarters for HGB) and ranks the dip rules (High tier clearly above Low), but the profit-max cut almost
never skips because even Low dip signals made money on average. Final two variants make the self-check explicit:
at quarter start, a rule's checker is switched ON only if its forward-OOF AUC in training is >= 0.55 (fixed, not
tuned); when ON, skip signals below the training 20th percentile of p; when OFF, take every signal.
24. FWD HGB + self-gated skip 20 %
25. FWD LR + self-gated skip 20 %
Total 25 variants; V13-V25 are post-hoc and exploratory.
