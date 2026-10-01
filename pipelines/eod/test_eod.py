"""python -m unittest discover pipelines/eod   (no network, no database)"""

import unittest
from datetime import date, datetime, timezone

import pandas as pd

from eod import Candle, last_settled_day, to_candles, yahoo_ticker


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

    def test_history_before_cutoff_ignored(self):
        f = frame([
            ("2025-10-13", 660.0, 665.0, 655.0, 660.0, 660.0, 1.0),   # pre-demerger Tata Motors
            ("2025-10-14", 400.0, 405.0, 395.0, 398.0, 398.0, 1.0),
        ])
        candles, _ = to_candles("TMPV", f, date(2026, 9, 30))
        self.assertEqual([c.day for c in candles], [date(2025, 10, 14)])

    def test_empty_frame(self):
        self.assertEqual(to_candles("TCS", None, date(2026, 9, 30)), ([], ["TCS: no rows"]))


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
