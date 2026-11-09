"""python -m unittest test_audit   (no network, no database): what the accuracy audit fails on and what it lists for review."""

import unittest
from datetime import date

import pandas as pd

from audit import REVIEWED_GAPS, repeats_side, revised_since, sessions_behind, spike_days, split_extra, vendor_has_history, widespread

D = date


class PriceGuard(unittest.TestCase):
    """The same rule as private.check_candle_days (migration 57): a day 12 % away from both closes around it."""

    def frame(self, rows):
        idx = pd.to_datetime([f"2026-11-0{i + 3}T10:00:00Z" for i in range(len(rows))], utc=True)
        return pd.DataFrame(rows, columns=["open", "high", "low", "close"], index=idx, dtype=float)

    def test_the_cleanmax_day_is_flagged(self):
        c = self.frame([(1270, 1290, 1260, 1276.5), (1021.2, 1314.7, 1021.2, 1259.7), (1260, 1270, 1250, 1265)])
        self.assertEqual(spike_days(c), ["2026-11-04"])

    def test_a_real_fall_that_closes_low_is_not_flagged(self):
        c = self.frame([(100, 101, 99, 100), (85, 86, 79, 80), (80, 81, 79, 80)])
        self.assertEqual(spike_days(c), [])

    def test_the_first_day_has_no_close_before_it(self):
        c = self.frame([(50, 200, 10, 100)])
        self.assertEqual(spike_days(c), [])



class VendorHistory(unittest.TestCase):
    def test_an_index_yahoo_serves_only_the_live_bar_for_is_not_cross_checked(self):
        self.assertFalse(vendor_has_history(fresh_days=0, stored_days=20))
        self.assertFalse(vendor_has_history(fresh_days=1, stored_days=20))

    def test_a_normal_or_thin_series_is_cross_checked(self):
        self.assertTrue(vendor_has_history(fresh_days=20, stored_days=20))
        self.assertTrue(vendor_has_history(fresh_days=3, stored_days=10))   # a thin fund Yahoo dropped days for
        self.assertTrue(vendor_has_history(fresh_days=0, stored_days=0))


class ExtraDays(unittest.TestCase):
    def test_the_newest_session_not_on_yahoo_yet_is_for_review(self):
        self.assertEqual(split_extra([D(2026, 11, 2)], D(2026, 11, 2), strict=True), ([], [D(2026, 11, 2)]))

    def test_a_past_day_missing_on_yahoo_fails_for_a_blue_chip(self):
        self.assertEqual(split_extra([D(2026, 10, 29), D(2026, 11, 2)], D(2026, 11, 2), strict=True),
                         ([D(2026, 10, 29)], [D(2026, 11, 2)]))

    def test_a_thin_fund_losing_past_days_on_yahoo_is_for_review(self):
        self.assertEqual(split_extra([D(2026, 10, 16), D(2026, 10, 19)], D(2026, 10, 30), strict=False),
                         ([], [D(2026, 10, 16), D(2026, 10, 19)]))


class Staleness(unittest.TestCase):
    cal = [D(2026, 10, 29), D(2026, 10, 30), D(2026, 11, 2)]

    def test_counts_trading_sessions_not_calendar_days(self):
        self.assertEqual(sessions_behind(D(2026, 10, 30), D(2026, 11, 2), self.cal), 1)   # over a weekend: one session
        self.assertEqual(sessions_behind(D(2026, 10, 29), D(2026, 11, 2), self.cal), 2)
        self.assertEqual(sessions_behind(D(2026, 11, 2), D(2026, 11, 2), self.cal), 0)
        self.assertGreater(sessions_behind(None, D(2026, 11, 2), self.cal), 2)


class Widespread(unittest.TestCase):
    def test_a_few_late_tickers_are_for_review_most_of_the_market_fails(self):
        self.assertFalse(widespread(3, 617))
        self.assertFalse(widespread(61, 617))
        self.assertTrue(widespread(560, 617))      # 2-3 Nov 2026: most stocks lacked 2 Nov
        self.assertFalse(widespread(5, 20))        # a small --symbols run: a handful is still a handful


class RevisedSignals(unittest.TestCase):
    def test_a_signal_whose_own_rsi_no_longer_matches_was_written_before_a_revision(self):
        # MAFANG 14 Oct 2026: stored with RSI 66.17; today's prices give 65.94
        self.assertTrue(revised_since(66.17, 65.94))

    def test_a_matching_rsi_or_a_missing_value_is_not_excused(self):
        self.assertFalse(revised_since(66.17, 66.17))
        self.assertFalse(revised_since(66.17, 66.175))
        self.assertFalse(revised_since(None, 65.94))
        self.assertFalse(revised_since(66.17, None))


class ReviewedGaps(unittest.TestCase):
    def test_only_the_sector_indices_vendor_hole_is_excused(self):
        self.assertIn(("NIFTYFINSERV", "2026-10-08"), REVIEWED_GAPS)
        self.assertNotIn(("NIFTY", "2026-10-08"), REVIEWED_GAPS)


if __name__ == "__main__":
    unittest.main()


class RetiredCrossRevised(unittest.TestCase):
    def test_two_exits_in_a_row_mean_a_revised_price(self):
        from datetime import date
        got = {("sma_20_50_cross", "buy", date(2026, 9, 1)), ("sma_20_50_cross", "exit", date(2026, 10, 7)), ("sma_20_50_cross", "exit", date(2026, 10, 8))}
        self.assertTrue(repeats_side(("sma_20_50_cross", "exit", date(2026, 10, 8)), got))
        self.assertFalse(repeats_side(("sma_20_50_cross", "exit", date(2026, 10, 7)), got), "a buy came before it")
        self.assertFalse(repeats_side(("sma_20_50_cross", "buy", date(2026, 9, 1)), got), "nothing before it")

