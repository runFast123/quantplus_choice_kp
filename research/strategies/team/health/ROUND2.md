# health — round 2

(Saved by the coordinator from the researcher's returned text. Plan written at the top of `round2.py` before any run.)

## Critiques
**regime.** Main flaw: closed-trades bias (pauses learned from trades already closed — for trend rules mostly
stop-outs), and early lessons from one crash episode (which it diagnoses itself). Re-check of its market state as a label
vs the matched rule × year null: all rules gap 5.0 points, p 0.36 (2021-26); 12.2, p 0.02 (2024-26). strong_trend's best
state in 2021-26 (up-calm) is its worst in 2024-26. "Do not adopt" survives; its hindsight ceiling (+0.9–1.9) is round 1's
best result.

**metalabel.** Main flaw: data mining (26 variants, V26 post-hoc). Key claims check out: the closed-trades finding is right
(it sank my round-1 drawdown cut). On its saved complete-cohort LR predictions, High vs Low dip tiers differ by 17.7/17.0
points (rsi_dip) and 17.6/17.9 (kk_dip), p ≤ 0.009 in both periods; trend tiers don't separate (p 0.32–0.98). V26 meets
the filter bar on dips but was chosen after the fact, and rsi_dip fell 5.0 points in 2025. Verdict survives.

**params.** Main flaw: 41 settings, and the gain comes from doing more, not choosing better (V5 keeps 131 % of trades,
holds trend trades ~65 sessions vs 48; return per 100 days in a trade 12.23 % → 11.45 %). Training on trades closed by
the quarter start penalises long-hold settings most. Past winners barely keep winning (0.06–0.27). "Do not
auto-re-optimise" survives.

## My variants (complete cohorts only: a trade counts once signal_date < day − 7 − span; span 100 days trend / 21 days
dips; R2/R3 use 35 days for their 20-session trend grade; the code checks every grade was known before the day)
- **R1:** C1 exactly as specified (weather buckets, full result).
- **R2:** trend rules graded at 20 sessions (stop result if stopped earlier: `r20` capped by the stop).
- **R3:** R2 with regime's trend × fear state as the bucket.

As a filter (made% / sum%, 2021-26 · 2024-26):

| | strong_trend | sma_trend | rsi_dip | kk_dip | ALL |
|---|---|---|---|---|---|
| static | 52.8/9792 · 47.7/2140 | 49.7/3861 · 45.5/1005 | 63.1/2384 · 60.3/747 | 70.3/1522 · 66.5/620 | 59.2/17559 · 55.9/4512 |
| R1 | 54.9/9870 · 47.6/1935 | 48.5/2787 · 45.8/922 | 62.5/2115 · 59.8/689 | 71.1/1514 · 68.0/639 | 60.0/16287 · 56.4/4186 |
| R2 | 57.0/8722 · 51.6/1669 | 52.6/3440 · 46.8/1114 | 62.5/2115 · 59.8/689 | 71.1/1514 · 68.0/639 | 61.2/15791 · 57.6/4111 |
| R3 | 54.9/7665 · 49.7/1665 | 51.7/3616 · 45.4/906 | 63.0/2162 · 60.5/722 | 70.7/1437 · 66.7/599 | 60.8/14881 · 57.1/3892 |

Tests (matched rule × year null, 1,000 draws):

| | label gap (pts), p · 2021-26 / 2024-26 | risk layer: worst quarter / max DD (static −974 / −1764) | filter: ALL made% p |
|---|---|---|---|
| R1 | 9.8, p .09 / 5.3, p .61 | −976 (p .91) / −1457 (p .99) | .50 / .42 |
| R2 | 15.7, p .023 / 14.6, p .016 | −631 (p < .001) / −1111 (p < .001) | .021 / .011 |
| R3 | 10.2, p .11 / 9.1, p .18 | −794 (p .005) / −1233 (p .12) | .09 / .12 |

Risk layer = keep every signal, half size on flagged ones; R2's keeps 91 % / 94 % of sum%.
- **R1 fails everything**: my round-1 drawdown cut was the closed-trades bias.
- **R2 passes display (a) and the risk layer (b)**; fails the filter bar (rsi_dip made% falls; strong_trend keeps only
  89 % / 78 % of sum%).
- Robustness: display passes at windows 20/30/60; risk drawdown fails at 60 (p 0.54). Protection comes from 2 episodes
  (2022 H1, 2024 Q4); sum% lower in 4 of 6 years. Corrected for 3 tests the display p-values are 0.07 / 0.05 (borderline).
- Per rule (after-the-fact split): strong_trend Weak made 40.0 / 39.5 % vs Healthy 56.7 / 49.7 % (p ≤ 0.025); sma_trend
  Weak 37.0 / 37.5 % vs Healthy 51.2 / 51.8 % (p ≤ 0.025); rsi_dip label inverted (Weak dips made 72–76 %).

## Votes
- **C1 as specified: reject** (on complete cohorts it neither separates nor cuts drawdown). Modified **C1′ (R2 card,
  trend rules only): display only.**
- **C2: display only for dips now** — the team's strongest label, re-checked. Skip Low dips only after two quarters of
  paper trading; never on trend rules.
- **C3: display only, neutral context** (fails the label bar, p 0.36 in 2021-26; flips between periods).
- **C4: reject for the product**; fine as an internal quarterly research note.

## What I would ship
A **"signal check" badge, nothing hidden.** Trend signals: C1′ shows **Weak** when the last 30 complete trades in today's
weather lost money over their first 20 sessions (t < −1); SQL daily from `signal_outcomes` (`r20`, `stop_hit_20`,
`weather`), signals older than 42 days. Dip signals: C2's High / Normal / Low tier. Beginner: "This badge shows how similar
recent signals turned out, once their results were fully known." Not shipped yet: half weight for Weak / Low (tested only on
all four rules together: worst quarter −35 %, drawdown −37 %) — needs one pre-registered combined run first.

Files: round2.py, round2_out.txt, round2_checks.py, round2_checks_out.txt, round2_R1.csv, round2_R2.csv, round2_R3.csv.
