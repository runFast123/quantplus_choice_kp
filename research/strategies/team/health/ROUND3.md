# health — round 3: C1′ trend badge on ranks 301–500

(Saved by the coordinator from the researcher's returned text. Plan at the top of `round3.py`.)

**Check.** Trend trades for stocks ranked 301–500 rebuilt with the same code as the top 300
(`build_dataset.strong_trades` / `sma_trades`). The same run on ranks 1–300 reproduces team_trades' 3,209 trend trades
exactly and C1′'s round-2 labels 100 %. Ranks 301–500 add 1,169 trend trades in 2021-26 (strong 711, sma 458). C1′
unchanged. made% Healthy vs Weak, the gap, and p for the rule × year shuffle / whole-month swap:

| run | 2021-26 | 2024-26 |
|---|---|---|
| **Primary: card built on 301–500, both rules** | 60.2 vs 21.4 = **38.8**, p .000 / .003 | 55.2 vs 13.0 = **42.2**, p .000 / .000 |
| primary, strong_trend | 46.8, p .000 / .003 | 51.0, p .000 / .000 |
| primary, sma_trend | 13.7, p .18 / .20 | 15.0, p .26 / .31 |
| Secondary: top-300 card on 301–500 signals, both rules | 13.8, p .007 / .017 | 12.6, p .003 / .025 |
| Top 300, both rules (comparison) | 15.6, p .001 / .042 | 11.6, p .000 / .009 |

**Decision rule: C1′ passes** (gap ≥ 5 points in both periods, beats both nulls at p < 0.05).

Caveats:
- One episode carries the primary pass: only 28 Weak trades, 20 of them from Nov 2024–Jan 2025 (2 of 20 made money).
- The secondary run has broader support: 269 Weak trades across 15 quarters, though Weak made money 71–82 % in three of
  them.
- sma_trend has no support of its own: it never clears both nulls on ranks 301–500.
- strong_trend fails the month swap on the top 300 by itself (p .10 / .11).

Housekeeping: all 86 files in `data/` match their pre-run hashes (`signals.parquet` and `strong_trend_record.csv` were
rewritten by the imports and restored; backups deleted).

## Vote: AGREE to D*
C1′ goes in as item 3 because it met the decision rule fixed in advance. One change that doesn't affect the vote: give the
trend badge the same public live record as the RSI tier (Weak vs Healthy made %, each month counted once) — its evidence
is thin and concentrated in one episode, so it should be checked in public.

Files: round3.py, round3_out.txt, r3_trend_trades.parquet, _data_hashes_before.txt.

## Ratification of D** — AGREE (display L2)
(Saved by the coordinator.)

**C1′ production spec**
- Grade: entry = next session's open. If the low reaches the stop in sessions 1–20 (entry day = 1): min(stop-day open,
  stop) / entry − 1 − 0.005; otherwise session-20 close / entry − 1 − 0.005.
- Live grade: `case when stop_hit_20 then stop/entry_price - 1 else r20 end - 0.005` (only those columns). 45 of 478
  stops gapped down; using stop / entry − 1 changes 1 of 2,639 labels, and no Weak label.
- Complete: `signal_day < d - 42` days, strictly (the longest wait for a grade was 35 days).
- Bucket: rule × weather on the signal day. Under 30 complete trades → the rule's last 50; under 20 → no badge (never
  happened). Missing weather → the fallback.
- Status: Weak if mean < 0 and mean / (sample sd / √n) < −1, strictly; otherwise not Weak.
- Timing: daily after the close, as of the signal day, then frozen for that signal.
- Ties: the last 30 by `signal_day desc, symbol desc collate "C"` — must match exactly (reversing flips 92 labels).
- Missing grades: skipped (none occurred).
- Reference: `out/c1p_reference.csv` (live-grade version `out/c1p_reference_livegrade.csv`). `data/` unchanged.

**Display: L2.** A Low label on ~80 % of signals tells people nothing. The same applies to the badge: Weak covers 33 % of
2025 signals and 29 % of 2026 (67 % in 2022); Weak made money 39.2 % vs 55.4 % for the rest. Tag only Weak, show nothing
on the others, keep the full record by year.
