# metalabel — round 3: kk_dip verdict and the rsi_dip production spec

(Saved by the coordinator from the researcher's returned text.)

## kk_dip: no tier
The ranks 301–500 failure is not proven real, but not explained away either.
- Trades per tier (High / Normal / Low): 68 / 173 / 114 in 2021-26; 53 / 63 / 91 in 2024-26.
- High − Low gap: −1.0 points (month-bootstrap 95 %: −22.8 to +14.9) and +5.9 (−10.8 to +20.5).
- These samples can only detect gaps of 19–21 points or more (80 % power), larger than the top-300 gap (+15.2 / +17.9);
  but the 2021-26 interval stops just short of the top-300 gap.
- Inconclusive. The self-test stays in research.

## rsi_dip tier: buildable
- `tier_model.py` is standalone (`fit` / `score`); its docstring defines all 25 features, quoted from build_dataset.py and
  its sources.
- Model saved in `out/rsi_dip_tier_model.json`: trained on 3,021 trades through 2026-10-01; self-test AUC 0.554 (just
  above the 0.55 gate); cut-offs p 0.608 / 0.645.
- Walk-forward High − Low with the standalone model: +16.7 on the top 300 (round 2: +15.3 / +15.1, within ±3); ranks
  301–500 +11.9 (p .048).
- Caveat: the gate only opened in 2024 Q2, so both periods are really one 11-quarter record.
- Largest coefficients (per sd), each with the same sign in ≥ 79 % of quarterly fits: breadth200 +0.28, atrpct +0.25,
  gap +0.17, n_same_day +0.15, rsi14 −0.15, wx −0.12, nifty_r20 +0.09, sector_rank +0.08.
- Little weight (|coef| < 0.05, sign unstable): d20, r5, r126, nifty_d200, d50, vix — kept until a pre-registered test
  says otherwise.

## Needs from the live database
- Live candles are split-adjusted only; research prices were also dividend-adjusted, which shifts long ratios by up to
  ~2 %. 760 sessions are enough.
- `hr_rule`: made-rate of the last 50 graded rsi_dip trades signalled before Q − 28 days, seeded from the research record.
- `n_same_day`: log(1 + today's rsi_dip signals in the point-in-time top 300), not the top 500.

## Vote: AGREE to D*
With one precision: compute the self-test blocks on rsi_dip trades only, as tested above.

## Ratification of D** — OBJECT (one numerical change), display L2
(Saved by the coordinator.) `tier_model.py` updated to D** (VERSION rsi_dip_tier/2, blocks on rsi_dip only, no AUC gate);
outputs rebuilt: `out/rsi_dip_tier_model.json` (3,021 trades, slope 0.272, cut-offs 0.610 / 0.643),
`out/rsi_dip_tier_walk.csv`, plus `r3_final.py`, `r3_low.py`.

Walk-forward from the CSV: 2021-26 High 76.7 % made (262) vs Low 59.1 % (1,389) = +17.6 points; 2024-26 High 74.7 %
(166) vs Low 56.0 % (746) = +18.7 points; High beat Low in 9 of 10 quarters in 2024-26. hr_rule now breaks ties among
same-day trades by symbol (deterministic).

Why most 2025-26 RSI dips are Low: the cut-offs are fixed from training and the average score fell — mostly lower
breadth200 (−0.32 of −0.43 log-odds), then n_same_day (−0.09) and atrpct (−0.08). "Low" there mostly means "the market is
weaker than in the training years"; those Low dips still made money 57–58 %, the rule's usual rate.

Display: **L2** (High is the only label with evidence behind it). No objection to the cut-offs themselves.

**OBJECT:** shown should require platt_a > 1e-6, not > 0. From 2021Q1 to 2022Q4 the slope is ~1e-11 (float noise);
params' re-implementation already disagrees there (2021: 36 % vs 100 % shown). With the change 2021-26 becomes +21.9
points; 2024-26 unchanged.

## Look-ahead check on n_same_day — confirmed and fixed; D*** — AGREE
(Saved by the coordinator.) A dip trade exists only if the next session's low reaches the limit, so counting filled
trades used next-day information (daily fill rate vs the next session's Nifty move: r = −0.49 close to close, −0.52
close to low; setup counts: r = +0.09). One pre-registered fix (`r3_leak.py` header): n_same_day counts RSI-dip setups
at the signal-day close in the top 300, filled or not. High − Low made% gap, before → after:
top 300 2021-26 +21.9 → **+24.0**; 2024-26 +18.7 → **+20.5** (High > Low in 9 of 10 quarters); ranks 301–500 2021-26
+17.9 → **+20.5**; 2024-26 +13.7 → **+16.1**. All p ≤ .02. 2025 still negative (−6.4 points, only 6 High signals); High
is rare in 2025–26.
Applied: `tier_model.py` version 3 (platt_a > 1e-6, new n_same_day in the docstring, helpers `pit_top`, `setup_count`);
production model refit (slope 0.377, self-test AUC 0.573); `out/rsi_dip_tier_models_by_quarter.json` (2024Q1–2026Q4) —
rescoring 2025Q3 from it matches the walk CSV exactly.
