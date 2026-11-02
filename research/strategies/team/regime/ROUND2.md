# regime — round 2

(Saved by the coordinator from the researcher's returned text. Plan = comment at the top of `round2.py`, written before any
run. Every lesson learned from complete cohorts only: signals before the quarter start − 7-day embargo − 100 days (trend)
or 21 days (dips); the code checks each had closed. Nulls: 1,000 shuffles within rule × year; the episode test shuffles
within the same month or swaps whole months.)

## Critiques
**health.** Its card learns from trades closed before the signal day — for the 60-session trend rules mostly stop-outs —
so it works as a crash alarm built on biased data, and its significance counts trades. Against random pauses of whole
months within rule × year, the worst-quarter cut gives p = 0.09 and the drawdown cut p = 0.11; three quarters in two
episodes carry it (2022H1 +573, 2024Q4 +515). Rebuilt on complete cohorts it cuts nothing: worst quarter −976 vs −974;
drawdown −1,432 vs −1,772 but no better than random (p = 0.50). The risk-layer verdict does not survive.

**metalabel.** V26 is variant 26 of 26, picked after V18–V25, so its p-values are too kind (Bonferroni for 26 tries is
p < 0.002, which rsi_dip 2024-26 misses at 0.007). Numbers reproduced exactly. The core claim survives counting episodes:
High − Low made% 17–18 points; shuffling tiers within the same month gives only 3–7 (p < 0.001); High beats Low in 13 of
17 rsi_dip months and 6 of 8 kk_dip months. **The tier ranks stocks within the same days; it isn't timing the market.**
Weak spot: rsi_dip about flat in 2022 (−1.4), reversed in 2025 (−8.4). Verdict survives.

**params.** V5's "pass" comes from more exposure, not adapting: 31 % more trades, trend trades held ~65 sessions instead
of 48 in a rising market; return per 100 days held lower (11.45 % vs 12.23 %). It also learns from trades already closed
(leaning to stop-outs, more so for 90-session settings), so scores aren't comparable across holding lengths. Past rank
barely predicts next quarter (0.06–0.27). Verdict (no auto re-optimising; quarterly monitor only) survives.

## Variants
**N1 = C3, market state (trend × fear) with each signal.** Gap = made% "better here" − "worse here":

| rule | 2021-26 | 2024-26 | p (rule × year) |
|---|---|---|---|
| strong_trend | −0.1 | −7.3 | .96 / .97 |
| sma_trend | +13.8 | +11.5 | .000 / .043 |
| rsi_dip | +2.3 | +2.3 | .46 / .30 |
| kk_dip | +3.5 | −1.3 | .79 / .95 |

- Only sma_trend passes, and only counting trades; its label just means "Nifty is below its 200-day average". Two
  recoveries carry it (2022: 69 % vs 28 %; 2025: 66 % vs 48 %); wrong in 2024 (17 % vs 39 %). Counting each month once it
  reverses: 47 % vs 51 %.
- The number C3 would show forecasts worse than the rule's plain record (higher Brier) in 7 of 8 rule-periods.
- **A beginner told "this rule makes 65 % in markets like today" would be misled. C3 fails the display bar.**

**N2 (house weather instead).** sma_trend +20.1 / +13.1 (p .000 / .038), same reason; rsi_dip +1.6 / +10.2 (p .15 / .06);
kk_dip +0.4 / −6.4; strong_trend fires in one weather state only (no label). Fails.

**N3 (filter): skip a dip signal only if V26 skips it AND the state says "worse here".** made% (change) / sum%:

| rule | 2021-26 | 2024-26 |
|---|---|---|
| strong_trend | 52.8 / 9,792 (unchanged) | 47.7 / 2,140 (unchanged) |
| sma_trend | 49.7 / 3,861 (unchanged) | 45.5 / 1,005 (unchanged) |
| rsi_dip | 63.4 (+0.3) / 2,466 | 60.9 (+0.6) / 861 |
| kk_dip | 71.2 (+0.9) / 1,527 | 67.1 (+0.6) / 623 |
| ALL | 59.2 (0.0) / 17,647 | 55.8 (−0.1) / 4,630 |

Null (rule × year): rsi_dip p = .31 / .15, kk_dip p = .07 / .14. Fails: adding the state throws away most of V26's skill.

## Votes
- **C1 health card: reject** (fails the episode test as published; on complete cohorts it cuts nothing).
- **C2 confidence tier: adopt as display, dip rules only** (survives the within-month test). Never on trend rules. V26
  skip only after two paper-traded quarters.
- **C3 market state: reject** (doesn't separate outcomes; less accurate than the rule's own record).
- **C4 plan monitor: quarterly research report only**, no automatic changes.

## What I would ship
C2 on rsi_dip and kk_dip: a High / Normal / Low tag next to each dip signal, retrained quarterly on complete cohorts,
forward-calibrated, shown only while its own forward self-test passes. Nothing hidden; trend rules static. Move to V26's
bottom-20 % skip only if two live quarters show High beating Low when each month is counted once.

Files: round2.py, round2_sma_episodes.py, round2_display.csv, round2_tiers.csv, round2_risk.csv, round2_out.txt.
