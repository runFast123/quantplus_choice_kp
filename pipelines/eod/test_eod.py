"""python -m unittest discover pipelines/eod   (no network, no database)"""

import unittest
from datetime import date, datetime, timezone

import pandas as pd

from eod import Candle, has_break, last_settled_day, on_trading_days, repair_series, sessions, split_symbols, to_candles, yahoo_ticker


def frame(rows):
    idx = pd.DatetimeIndex([r[0] for r in rows])
    return pd.DataFrame([r[1:] for r in rows], index=idx, columns=["Open", "High", "Low", "Close", "Adj Close", "Volume"])


class SettledDay(unittest.TestCase):
    def test_before_close_uses_previous_day(self):
        # 15:00 IST = 09:30 UTC: today's bar is still moving
        self.assertEqual(last_settled_day(datetime(2026, 10, 1, 9, 30, tzinfo=timezone.utc)), date(2026, 9, 30))

    def test_after_settle_uses_today(self):
        # 15:45 IST = 10:15 UTC
        self.assertEqual(last_settled_day(datetime(2026, 10, 1, 10, 15, tzinfo=timezone.utc)), date(2026, 10, 1))

    def test_ist_date_not_utc_date(self):
        # 00:30 IST on 2 Oct is still 1 Oct in UTC; the settled day is 1 Oct either way
        self.assertEqual(last_settled_day(datetime(2026, 10, 1, 19, 0, tzinfo=timezone.utc)), date(2026, 10, 1))


class ToCandles(unittest.TestCase):
    def test_valid_rows_rounded_and_partial_bar_dropped(self):
        f = frame([
            ("2026-09-29", 100.004, 101.5, 99.25, 100.996, 99.0, 12345.0),
            ("2026-09-30", 101.0, 102.0, 100.0, 101.5, 99.5, 0.0),
            ("2026-10-01", 101.5, 103.0, 101.0, 102.0, 100.0, 500.0),   # after `settled`
        ])
        candles, problems = to_candles("TCS", f, date(2026, 9, 30))
        self.assertEqual(problems, [])
        self.assertEqual([c.day for c in candles], [date(2026, 9, 29), date(2026, 9, 30)])
        self.assertEqual((candles[0].open, candles[0].close, candles[0].volume), (100.0, 101.0, 12345))

    def test_nan_rows_skipped_silently(self):
        f = frame([("2026-09-29", float("nan"), float("nan"), float("nan"), float("nan"), float("nan"), float("nan"))])
        self.assertEqual(to_candles("TCS", f, date(2026, 9, 30)), ([], []))

    def test_inconsistent_ohlc_reported(self):
        f = frame([("2026-09-29", 100.0, 99.0, 98.0, 100.0, 100.0, 1.0)])   # high below open
        candles, problems = to_candles("TCS", f, date(2026, 9, 30))
        self.assertEqual(candles, [])
        self.assertEqual(len(problems), 1)

    def test_stale_open_pulled_into_range(self):
        f = frame([("2025-11-21", 94.57, 92.68, 92.67, 92.67, 92.67, 10.0)])   # open above high (Yahoo, AAREYDRUGS)
        candles, problems = to_candles("X", f, date(2026, 9, 30))
        self.assertEqual(problems, [])
        self.assertEqual((candles[0].open, candles[0].high, candles[0].low, candles[0].close), (92.68, 92.68, 92.67, 92.67))

    def test_history_before_cutoff_ignored(self):
        f = frame([
            ("2025-10-13", 660.0, 665.0, 655.0, 660.0, 660.0, 1.0),   # pre-demerger Tata Motors
            ("2025-10-14", 400.0, 405.0, 395.0, 398.0, 398.0, 1.0),
        ])
        candles, _ = to_candles("TMPV", f, date(2026, 9, 30))
        self.assertEqual([c.day for c in candles], [date(2025, 10, 14)])

    def test_empty_frame(self):
        self.assertEqual(to_candles("TCS", None, date(2026, 9, 30)), ([], ["TCS: no rows"]))


class Splits(unittest.TestCase):
    def test_split_or_bonus_detected(self):
        idx = pd.DatetimeIndex(["2026-09-29", "2026-09-30"])
        frames = {
            "SPLIT": pd.DataFrame({"Close": [100.0, 50.0], "Stock Splits": [0.0, 2.0]}, index=idx),
            "PLAIN": pd.DataFrame({"Close": [100.0, 101.0], "Stock Splits": [0.0, 0.0]}, index=idx),
            "NOCOL": pd.DataFrame({"Close": [100.0, 101.0]}, index=idx),
            "EMPTY": None,
        }
        self.assertEqual(split_symbols(frames), ["SPLIT"])


class Calendar(unittest.TestCase):
    def test_holiday_bars_dropped_newer_days_kept(self):
        rows = [Candle("ETF", d, 1, 1, 1, 1, 0).row() for d in (date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 5))]
        # NIFTY fetched this run up to 2 Oct: it had no 2 Oct bar (Gandhi Jayanti); 5 Oct is beyond it.
        kept, dropped = on_trading_days(rows, {date(2026, 9, 30), date(2026, 10, 1)}, date(2026, 10, 2))
        self.assertEqual(dropped, 1)
        self.assertEqual([r["ts"][:10] for r in kept], ["2026-10-01", "2026-10-05"])

    def test_sessions_from_index_or_two_large_caps(self):
        d1, d2, d3 = date(2026, 9, 14), date(2026, 10, 1), date(2026, 10, 2)
        cal = sessions({d2}, {"RELIANCE": {d1, d2}, "TCS": {d1, d2}, "INFY": {d3}})
        self.assertEqual(cal, {d1, d2})        # 14 Sep: NIFTY missing on Yahoo but stocks traded; 2 Oct: one stray bar

    def test_no_calendar_keeps_everything(self):
        rows = [Candle("X", date(2026, 10, 2), 1, 1, 1, 1, 0).row()]
        self.assertEqual(on_trading_days(rows, set(), date(2026, 10, 2)), (rows, 0))


def series(closes, start=date(2026, 1, 1), opens=None):
    from datetime import timedelta as td
    opens = opens or closes
    return [Candle("X", start + td(days=i), o, max(o, c), min(o, c), c, 100) for i, (o, c) in enumerate(zip(opens, closes))]


class Repair(unittest.TestCase):
    def test_unadjusted_split_rescales_history(self):
        fixed, notes = repair_series(series([1000.0, 1010.0, 101.5, 102.0]))      # 1:10 split on day 3
        self.assertEqual([c.close for c in fixed], [100.0, 101.0, 101.5, 102.0])
        self.assertEqual(fixed[0].volume, 1000)
        self.assertIn("×0.1", notes[0])

    def test_consolidation_scales_up(self):
        fixed, _ = repair_series(series([10.0, 10.2, 51.0]))                      # 5:1 consolidation
        self.assertEqual([c.close for c in fixed], [50.0, 51.0, 51.0])

    def test_other_breaks_cut_history(self):
        fixed, notes = repair_series(series([39.65, 40.0, 907.55, 910.0]))        # ARIHANT-style jump
        self.assertEqual([c.close for c in fixed], [907.55, 910.0])
        self.assertIn("dropped", notes[0])

    def test_real_crash_inside_the_session_is_kept(self):
        # PB Fintech, 24 Sep 2026: opened near the prior close, closed -33 %
        s = series([1800.0, 1207.2, 1160.0], opens=[1800.0, 1697.7, 1166.0])
        self.assertEqual(repair_series(s), (s, []))
        self.assertFalse(has_break(s[1:], 1800.0, date(2025, 12, 31)))

    def test_normal_moves_untouched(self):
        s = series([100.0, 120.0, 96.0, 110.0])                                   # ±20 % band moves
        self.assertEqual(repair_series(s), (s, []))

    def test_daily_break_detection_against_stored_close(self):
        new = series([101.0, 102.0], start=date(2026, 10, 1))
        self.assertFalse(has_break(new, 100.0, date(2026, 9, 30)))
        self.assertTrue(has_break(new, 1000.0, date(2026, 9, 30)))               # split happened overnight
        self.assertFalse(has_break(new, 1000.0, date(2026, 10, 2)))              # nothing newer than stored


class Rows(unittest.TestCase):
    def test_candle_stamped_at_session_close(self):
        row = Candle("M&M", date(2026, 9, 30), 1, 2, 0.5, 1.5, 10).row()
        self.assertEqual(row["ts"], "2026-09-30T10:00:00+00:00")   # 15:30 IST
        self.assertEqual((row["exchange"], row["interval"]), ("NSE", "1d"))

    def test_yahoo_ticker(self):
        self.assertEqual(yahoo_ticker("M&M"), "M&M.NS")
        self.assertEqual(yahoo_ticker("BAJAJ-AUTO"), "BAJAJ-AUTO.NS")


if __name__ == "__main__":
    unittest.main()
