# Round 2 — critique, beat each other, agree on one design

Round 1 is done. Read all four reports before anything else:
`team/regime/REPORT.md`, `team/metalabel/REPORT.md`, `team/params/REPORT.md`, `team/health/REPORT.md`.
Same data, same scorer (`team/evaluate.py`), same rules of engagement as `BRIEF.md`.

## What round 1 found (coordinator's reading; check it, don't trust it)
- Nobody beat the static rules on accuracy in a way that survives a fair null test. The best made% gains (+1.5 to +1.6
  points) came from pausing whole stretches, and health showed that gain vanishes once random pauses are matched by
  rule x year; what survives is a smaller worst quarter and drawdown.
- **Outcome censoring** (metalabel, Amendment A): "trades closed before the quarter" are biased towards stop-outs for the
  60-session trend rules (made 9 % / 6 % among recently closed trend trades vs 54 % / 51 % for the whole cohort).
  Any method that learns from recently closed trades (health's report card, regime's pauses, metalabel's model) inherits
  this unless it uses complete cohorts only (signal_date < Q - embargo - the rule's maximum holding span).
- **Evidence is episodes, not trades** (regime): 100 trades from one crash are one lesson.
- **ALL made% moves with the rule mix** (regime): dip trades win more often, so report per-rule made% too.
- Re-optimising settings chases noise (params: rank correlation 0.06-0.27 between a setting's past score and its next
  quarter); the stable finding is that the trend rules prefer a wider stop and a longer hold (5 x ATR, 90 sessions).

## Common bar for round 2 (fixed now, before anyone runs anything)
A design is **adoptable as a filter** (it may hide or shrink signals) only if, out of sample:
1. for every rule it touches, made% is higher in BOTH 2021-26 and 2024-26, and sum% >= 90 % of static in both;
2. it beats random skips of the same number of signals matched by rule x year (500+ draws) on made% at p < 0.05;
3. any feedback from finished trades uses complete cohorts only (no censoring bias), with the embargo stated;
4. <= 3 tunable settings, runs once a day in Postgres SQL (or the Python EOD job), one beginner sentence.

A design is **adoptable as a display / risk layer** (nothing hidden, every signal still stored and graded) if it passes
3 and 4, and either (a) the label it shows separates outcomes out of sample (made% of its best group minus its worst group
>= 5 points in both periods, and the gap beats the matched random null at p < 0.05), or (b) it cuts the worst quarter and
the maximum drawdown versus static and beats the matched null on both.

## What each of you does (this round)
1. **Critique** each of the other three reports in <= 120 words: its strongest flaw (look-ahead, censoring, data mining,
   mix effect, cost, too few episodes) and whether its verdict survives. Re-run their code if you doubt a number
   (read-only; write only in your own folder).
2. **Beat or combine.** Pre-register at most 3 new variants at the top of `team/<you>/ROUND2_PLAN.md` (if you cannot write
   .md files, put the plan as the first lines of `team/<you>/round2.py` as a comment), then run them with evaluate.py and
   the matched null above. Combining another member's idea with yours is encouraged. Report losers too.
3. **Vote.** Score each candidate below as adopt / adopt as display only / reject, with one line why, and say which
   single design you would ship. You may propose a modified candidate; say exactly what changes.

## Candidates on the table
- **C1 Health card (display / risk):** per rule x market weather, the record of the rule's last finished trades shows
  Healthy / On watch / Weak next to every signal; nothing is hidden. (health V8 idea; must be rebuilt on complete
  cohorts.)
- **C2 Confidence tier (display, or filter where it passes):** each new signal is marked High / Normal / Low from a
  simple model trained walk-forward on complete cohorts; a rule's tier is shown only if the model passed its own
  forward self-test last quarter. (metalabel idea.)
- **C3 Market-state context (display):** today's market state (trend x fear) next to each signal, with each rule's
  record in that state. (regime by-product.)
- **C4 Plan monitor (research, quarterly):** the 27-setting shadow grid per rule reports where today's settings rank;
  any change goes through a pre-registered static re-test (params).
- Anything you can show beats these under the common bar.

## Deliver (your final message; the coordinator saves it as `team/<you>/ROUND2.md`, <= 600 words)
Critiques (3 x <= 120 words) · your new variants with the evaluate.py rows (ALL and per rule, both periods) and the null
test · your votes on C1-C4 (+ yours) · the one design you would ship and why.
