# regime — round 3: stress test of the RSI dip tier

(Saved by the coordinator from the researcher's returned text. Plan = comment block at the top of `round3.py`. The tier
was rebuilt read-only from metalabel's saved round-2 predictions and scored on the top 300 and ranks 301–500 = top 500.)

## (a) Is High one kind of stock or day?
- **Not big stocks:** High leans to the smallest third (47 % of High signals vs 33 % of all). Pre-registered rule 1,
  "biggest third vs smallest third", separates the wrong way on the top 300: −8.7 / −6.9 points.
- **Not just sunny days:** 86 % of High signals fall on sunny days (64 % of all). The tier still separates inside sunny
  days (+18.1 / +18.5) and other days (+9.6 / +9.8, only 13 High), and inside every size third (+10 to +25).
- **No one-feature rule matches it:** rule 2 (breadth50, the checker's top feature before 2021) gives +5.6 / +9.9 vs the
  tier's +15.3 / +15.1.
- **But it rests on one stretch of time:** 125 of the 150 top-500 High signals came in 2024Q2 and 2024Q4. In 2025–26 only
  19 of 957 RSI dips were tagged High. High beat Low in 9 of 10 shown quarters, but 6 of those had ≤ 3 High signals.

## (b) The 2025 reversal
- The self-test gate stayed on in all four 2025 quarters, yet the tier told a user nothing: top 500 High made money
  61.5 %, Low 59.3 %, all 58.5 %. On the top 300, 2025Q1 reversed (−8.0).
- At that point the public record would have shown "High 76 % vs Low 57 %", built almost entirely from 2024.
- Only 1 of 12 shown quarters flipped sign against the record (2026Q2, one High trade). The record isn't false, but it
  presents one year of evidence as general.

## Vote: OBJECT (one small change to item 2)
Keep the tier, but the gate checks training data, not recent quarters, so it isn't enough for a beginner. The public
record must:
- count quarters, with dates: "High beat Low in 9 of 10 quarters; 125 of 150 High signals came from 2024";
- carry a standing line: "Research ranking from past patterns, not advice; in 2025 it made no difference."

Agrees with everything else in D*.

Files: round3.py, round3_out.txt, round3_rules.csv, round3_quarters.csv.

## Ratification of D** — OBJECT (two exact changes)
(Saved by the coordinator. Checked params' slope > 0 tier read-only in `final_check.py`.)
1. **RSI tier: keep slope > 0, but fix the 2025 line.** Showing the tier more often doesn't make 2025 worse (those
   quarters were shown under both rules). The 5 added quarters were good (2023: High 84.5 % vs Low 54.3 %). High now
   depends less on 2024 (139 of 288 High signals, down from 83 %). But in 2025 High did worse than Low on the top 300
   (46.2 % vs 57.9 %, 13 High signals). **Change:** the computed line must say which way it went — "In 2025, High did
   worse than Low", not "made no difference".
2. **Trend badge: strong_trend only.** sma_trend has no support of its own (ranks 301–500: 5 / 3 Weak trades, p .18 /
   .26; top 300 month swap p .086 / .20). strong_trend passes, but one fall carries it. **Change:** show it only on
   strong_trend, with the caveat "Weak was right in one market fall (Nov 2024–Jan 2025); too few cases to rely on yet."

## Display vote — L2 plus an addition
(Saved by the coordinator.) Only High gets a tag, worded "stronger than usual in past RSI dips"; Normal and Low show
nothing. The public record shows all three tiers by year, plus the yearly made% of all RSI dips.
- Why not L1: a Low tag on ~80 % of 2025–26 signals reads as "weak", but Low was close to the rule's own record, and in
  2025 above it (Low 57.9 % vs all 56.5 %; 2026 Low 57.0 % vs all 61.1 %).
- Why L2 needs the addition: High is rare (13–14 signals a year in 2025–26), and in 2025 it reversed (13 High made 46.2 %
  vs 57.0 % for the other 302).
- Standing line (top 300, D** rule, computed each quarter): "A research ranking from past patterns, not advice. Since
  2021, RSI dips tagged High made money 75 % of the time (289 signals) vs 63 % for all RSI dips. In 2025 the 13 High
  signals made money only 46 %, below the 57 % of the rest."
- Trend badge objection stands: strong_trend only.
