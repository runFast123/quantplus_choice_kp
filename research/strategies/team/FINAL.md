# Final design D*** — what the team agreed

History: D* (round 3) → D** (folded in params' no-AUC-gate change and regime's dated record) → D*** (folds in the three
remaining amendments: L2 display from all four, strong_trend-only badge from regime, slope tolerance from metalabel).
Votes on D***: see the bottom of this file.

## D***
1. **The four rules stay exactly as they are** (strong_trend, sma_trend: 4 x ATR / 60 sessions; rsi_dip, kk_dip as live).
   No filter: nothing is hidden, shrunk or skipped; every signal is still stored and graded.
2. **RSI dip check** — a logistic-regression score on 25 signal-day numbers (`team/metalabel/tier_model.py`,
   VERSION rsi_dip_tier/3, C = 0.05), retrained at each quarter start on complete cohorts (signals older than Q - 28
   days), forward-only calibration over 6 blocks cut on rsi_dip trades only, Platt slope clipped at >= 0.
   - The tier is in force when `platt_a > 1e-6` (metalabel); otherwise "no tier this quarter".
   - **Display (L2):** only High is tagged, worded as stronger than usual in past RSI dips. Normal and Low show nothing
     (Low mostly means "the market is weaker than in the training years"; in 2025 Low dips made money close to the
     rule's rate: 57.9 % vs 56.5 % for all RSI dips — over 2021-26 Low made 57.0 % vs 63.1 %).
   - **Public record:** all three tiers by year with counts, plus every RSI dip's yearly made %, quarters where High beat
     Low (counted with dates), and a computed standing line that says which way the latest year went, e.g. "Since 2021,
     RSI dips tagged High made money 75 % of the time (289 signals) vs 63 % for all RSI dips. In 2025 the 13 High signals
     made money only 46 %, below the 57 % of the rest." Never hard-coded.
3. **Strong trend check (C1′), strong_trend only** (regime: sma_trend has no support of its own).
   - Weak when the last 30 complete strong_trend trades in today's market weather (fallback: the rule's last 50; under 20
     → no badge) lost money over their first 20 sessions: mean < 0 and t < -1. Complete = signal_day < day - 42.
     Grade = (stop / entry - 1 if the stop was hit within 20 sessions, else r20) - 0.005. Ties: signal_day desc, symbol
     desc (collate "C"). Computed daily as of the signal day, then frozen.
   - **Display (L2):** only Weak is tagged; nothing on the others.
   - **Public record:** Weak vs not-Weak made % by year, each month counted once, with the caveat that its evidence is thin
     (one market fall, Nov 2024 – Jan 2025, carries most of it).
4. **Quarterly review (internal):** each rule's complete-cohort record vs its tested range, the tier's calibration, the
   badge's record, the kk_dip and sma_trend self-tests, and the 27-setting shadow grid. No automatic changes; any rule
   change goes through a pre-registered static re-test.
5. **kk_dip and sma_trend get no tag** (inconclusive / no support); they stay in the quarterly review.
6. **No skip of any signal** until two live quarters show the tag's groups separating with each month counted once.

## Votes on D***
- **params: AGREE.** platt_a > 1e-6 changes nothing in its build (smallest shown slope 0.005); High-only display removes
  the "Low dominates" problem; strong_trend-only badge matches its finding.
- **health: AGREE.** Each rule's card only learned from that rule's own trades, so strong_trend-only is exactly what was
  tested; thin evidence (top 300 alone fails the month swap, p .10 / .11) is covered by the public caveat.
- **regime: AGREE**, with a factual wording fix to item 2 (applied above): Low made the rule's rate only in 2025.
- **metalabel: AGREE.** tier_model.py uses platt_a > 1e-6; refit model and walk CSV (2,651 signals); the tier first shows
  in 2023Q2; walk-forward High − Low +21.9 (2021-26) / +18.7 (2024-26); High beat Low in 9 of 10 quarters in 2024-26.
  Look-ahead found in n_same_day (it counted filled trades, known only after the fill): fixed to count setups at the
  signal-day close (VERSION rsi_dip_tier/3); the gap grew (top 300 +24.0 / +20.5; ranks 301–500 +20.5 / +16.1).
