# params — round 3: replicating the rsi_dip tier

(Saved by the coordinator from the researcher's returned text. Built from metalabel's PLAN.md — main section plus
Amendments A–C — and read its code only after the numbers were done. Disclosure: in round 2 about 15 lines of its
tier-assignment code had been seen. `data/signals.parquet` unchanged, same hash.)

**The replication passes in substance but fails the letter on one number** (one gap 0.2 point outside ±3, on the
stronger side).

| top 300, rsi_dip | High made / avg | Normal | Low | High−Low | metalabel | within ±3? |
|---|---|---|---|---|---|---|
| gated 2021-26 | 71.7 / 2.67 | 61.1 / 0.44 | 55.9 / 0.03 | 15.8 | 15.3 | yes |
| gated 2024-26 | 73.9 / 2.95 | 60.2 / 0.29 | 55.6 / 0.04 | 18.3 | 15.1 | **no, +3.2** |
| ungated 2021-26 | 75.4 / 2.93 | 65.4 / 0.99 | 57.0 / 0.24 | 18.4 | 17.7 | yes |
| ungated 2024-26 | 74.7 / 3.00 | 62.4 / 0.55 | 56.0 / 0.07 | 18.7 | 17.0 | yes |

Tier shown in 13 of 24 quarters (54 %) over 2021-26 and 10 of 12 (83 %) over 2024-26.

**Why one number differs:** identical training sets every quarter; from 2022 Q3 on the per-signal probabilities correlate
at ≥ 0.99. The spec says only "6 time blocks": metalabel cuts them over all four rules' training rows together, params
over rsi_dip's own rows. That moves the self-test AUC by 0.01–0.03; most quarters' AUCs sit within 0.02 of 0.55, so the
gate flips in 7 of 24 quarters. With metalabel's block layout, this build matches its gate in 22 of 24 quarters and gives
gaps of 15.7 / 15.6 (within 0.5 point).

## Vote: OBJECT (one change to D* item 2)
Show the tier whenever the forward-only calibration slope is above 0, and drop the separate AUC ≥ 0.55 gate. When the
slope is clipped to 0, every signal is Normal ("no tier this quarter"). The spec should also say how the 6 blocks are cut.
- One fewer setting (the slope rule is already in the spec).
- More stable (doesn't depend on how the blocks are cut).
- Separation at least as good: ungated 18.4 / 18.7 (params), 16.6 / 15.6 (metalabel's block layout), 17.7 / 17.0
  (metalabel) vs gated 15.8 / 18.3, 15.7 / 15.6, 15.3 / 15.1.
- Still beats chance (round 2: ungated gap beat the rule × year shuffle at p < 0.001).
- Shown more often: 18–19 of 24 quarters, all 12 in 2024-26.
- The builds agree within ±3 points under this rule.

Agrees with the rest of D*.

Files: round3.py, out/round3_out.txt, out/round3_quarters.csv, out/round3_quarters_pooled.csv, out/round3_rsi_tier.parquet.

## Ratification of D** — AGREE
(Saved by the coordinator.) Per-year rsi_dip tier on the top 300 under the D** rule (blocks on rsi_dip only, shown
whenever the Platt slope > 0, no AUC gate). Exact figures: `out/round3_final_years.csv`.

| year | signals | tier shown | High n / made% | Normal n / made% | Low n / made% | High−Low | quarters High beat Low |
|---|---|---|---|---|---|---|---|
| 2021 | 605 | 35.9 % | 3 / 66.7 | 63 / 55.6 | 151 / 62.9 | +3.8 | 0 of 0 |
| 2022 | 430 | 65.1 % | 48 / 64.6 | 128 / 63.3 | 104 / 57.7 | +6.9 | 2 of 2 |
| 2023 | 342 | 71.3 % | 72 / 84.7 | 91 / 64.8 | 81 / 54.3 | +30.4 | 2 of 2 |
| 2024 | 645 | 100 % | 139 / 75.5 | 261 / 62.5 | 245 / 53.1 | +22.4 | 4 of 4 |
| 2025 | 315 | 100 % | 13 / 46.2 | 43 / 51.2 | 259 / 57.9 | **−11.7** | 0 of 1 |
| 2026 | 314 | 100 % | 14 / 92.9 | 58 / 70.7 | 242 / 57.0 | +35.9 | 1 of 1 |
| 2021-26 | 2,651 | 76.0 % | 289 / 75.4 | 644 / 62.3 | 1,082 / 57.0 | +18.4 | 9 of 10 |

Corrections for the public copy: "In 2025 it made no difference" is not accurate — High trailed Low by 11.7 points, on
only 13 High signals. Low dominates lately: 82 % of 2025 and 77 % of 2026 signals were labelled Low.
