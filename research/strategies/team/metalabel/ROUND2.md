# metalabel — round 2

(Saved by the coordinator from the researcher's returned text. Plan = header of `round2.py`, run once; output
`out/round2.txt`. Rebuilding ranks 1-300 reproduced all 4,128 dip trades and the round-1 probabilities exactly.)

## Critiques
**health.** The card learns from trades closed before the signal day, so a trend bucket sees stop-outs months before
winners — why strong_trend 2024-26 made% falls at every setting. Daily updates also break BRIEF rule 1, and the version
that follows it (V11) keeps static's worst quarter. The matched null already removes the made% gain (p = 0.41). Rebuilt on
complete cohorts, frozen each quarter (my R3), a negative card splits trend outcomes by 3 points at most, and on sma_trend
2021-26 the negative group did better. Verdict does not survive.

**regime.** Verdict (do not adopt) survives. The diagnosis misses censoring: pauses learn from trades closed before the
quarter (walk.py: exit_date < q0), so the 2020 lessons were biased as well as few. C3 was never tested against the display
bar; regime's own persistence table (rsi_dip up-calm 66 / 67 / 54 %) predicts it fails.

**params.** Verdict survives; V5's pass is weak. (1) Censoring hits long holds hardest: scoring only closed trades makes
the 90-session hold look worse (strong_trend avg net 7.5 % closed-only vs 9.1 % full cohort). (2) Selection: 2 of 11
variants passed, each a minority of its stress tests. (3) The gain comes from more and longer trades (kept 1.31) while dip
made% falls (rsi 63.1 → 60.6, kk 70.3 → 66.3).

## Round-2 variants
**R1 = V26 confirmatory test (filter).** made% (change vs static) · sum vs static · matched-null p (rule × year, 1,000
draws):

| | top 300, 2021-26 | top 300, 2024-26 | ranks 301-500, 2021-26 | ranks 301-500, 2024-26 |
|---|---|---|---|---|
| rsi_dip | 65.9 (+2.8) · +46 · .001 | 63.6 (+3.3) · +13 · .006 | 70.6 (+2.7) · 88 % · .008 | 66.9 (+2.2) · 77 % · .083 |
| kk_dip | 73.5 (+3.2) · +4 · .001 | 70.8 (+4.3) · +23 · .001 | 73.0 (−0.5) · 83 % · .84 | 68.8 (−2.2) · 72 % · .95 |
| strong, sma | = static | = static | not touched | not touched |
| ALL | 59.7 (+0.5) · +50 | 56.0 (+0.1) · +36 | both dips 71.3 (+1.8) · 86 % | both dips 67.5 (+1.1) · 75 % |

**R1 fails**: on the new stocks kk_dip's made% falls and rsi_dip keeps only 77–88 % of profit.

**R2 = C2 tier** (shown only when the checker's forward self-test AUC ≥ 0.55; High − Low made%, p from shuffling labels
within rule × year):
- **rsi_dip passes.** Top 300: +15.3 (p .003) / +15.1 (p .003); 2024-26 High 70.7 % vs Low 55.6 %. Ranks 301-500:
  +17.8 (p .007) / +17.3 (p .006).
- **kk_dip fails.** Top 300: +15.2 / +17.9 (p .001); ranks 301-500: −1.0 (p .61) / +5.9 (p .23).
- **Trend rules fail.** Tier never shown in 2024-26; 2021-26 p = .95 / .92.

**R3 = R2 + the complete-cohort card.** rsi_dip gap falls to 12.2 in 2021-26, so R2 wins, as pre-registered.

## Votes
- **C1: reject** (rebuilt on complete cohorts it does not separate outcomes).
- **C2: display only, rsi_dip only** — the only candidate that passed a pre-registered test on independent stocks.
- **C3: reject** (untested; records by state do not persist).
- **C4: adopt as internal quarterly research**, on complete cohorts.

## Ship
C2 for RSI dips only, display only: a High / Normal / Low tag, "how similar past RSI dips turned out."
- 2024-26: High made money 70.7 % (avg +1.8 %); Low 55.6 % (avg −0.1 %).
- Logistic regression retrained each quarter in the EOD Python job; daily score is one dot product.
- Settings: C, the 0.55 self-test gate, the tertile cut-offs.
- Limits: High is rare (92 of 1,274 signals in 2024-26); the tier is hidden in about half the quarters.

No filter passed.
