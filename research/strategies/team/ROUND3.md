# Round 3 — agree on the final design

All four round-2 reports are in (`team/<name>/ROUND2.md`). This round settles the last two open questions with tests
fixed now, and then each member votes AGREE or OBJECT on one design.

## Where the team already agrees (4 of 4)
- **No filter.** Nothing that hides or shrinks signals passed the common bar. All four rules keep their settings
  (params' clean re-test re-confirmed 4 x ATR / 60 sessions for the trend rules; 5 x ATR / 90 was a 2020-23 effect).
- **Health card as specified (C1): reject.** On complete cohorts it neither separates outcomes nor cuts drawdown.
- **Market state with a per-state record (C3): reject.** The per-state records flip between periods and forecast worse than
  the rule's own record. (The plain market weather already on the Signals page stays as it is.)
- **Plan monitor (C4): internal quarterly research only.** No automatic changes; any change to a rule goes through a
  pre-registered static re-test.
- **Confidence tier (C2): display only, never on trend rules.** It ranks signals within the same days (regime's
  within-month test), not by timing the market.

## Still open
1. **kk_dip tier.** It passed on the top 300 but failed on independent stocks ranked 301–500 (metalabel R2: −1.0 / +5.9
   points, p .61 / .23). The live product covers the top 500. Three members voted before seeing that result.
2. **Health's C1′ trend badge** (Weak when the last 30 complete trades in today's weather lost money over their first 20
   sessions, t < −1). Passed the display bar on the top 300 (15.7 / 14.6 points, p .023 / .016), but borderline after
   correcting for 3 tests (0.07 / 0.05) and carried by two episodes. Not tested on independent stocks or by months.

## Decision rules (fixed before the runs)
- **C1′ ships for the trend rules** only if, on ranks 301–500 (trend trades rebuilt with the same code as the top 300),
  its Weak-vs-Healthy made% gap is ≥ 5 points in both 2021-26 and 2024-26, and beats BOTH the rule x year trade shuffle
  and the whole-month swap null (regime's episode test) at p < 0.05. Otherwise the trend rules get no badge.
- **The kk_dip tier ships** only if someone shows, without re-tuning, a reason the ranks 301–500 failure is not real (e.g.
  too few trades to judge). Otherwise kk_dip gets no tier and its self-test keeps checking it each quarter in research.
- **The rsi_dip tier ships** only if an independent re-implementation from the written spec (not the code) reproduces the
  High-vs-Low separation on the top 300 within ±3 points.

## The design on the ballot (D*)
1. Four rules unchanged.
2. **RSI dip confidence tier** High / Normal / Low next to each RSI dip signal: logistic regression, retrained each quarter
   on complete cohorts (signal older than embargo + 21 days), forward-only calibration with slope ≥ 0, tertile cut-offs
   from training, and shown only while its forward self-test AUC ≥ 0.55 (otherwise "no tier this quarter"). Nothing
   hidden; every signal still graded; the tier's own live record (High vs Low made %) is shown so the claim is checked in
   public.
3. **Trend badge (C1′)** only if it passes the decision rule above.
4. **Quarterly review** (internal): each rule's complete-cohort record vs its tested range, the tier's calibration, and the
   27-setting shadow grid; changes only through pre-registered re-tests.
5. **No skip of Low RSI dips** until two live quarters show High beating Low with each month counted once.

## Deliverable (final message, ≤ 300 words; the coordinator saves it as `team/<name>/ROUND3.md`)
Your assigned check (below) with its numbers, then **AGREE** or **OBJECT** to D* — if you object, the exact change and the
evidence for it.
