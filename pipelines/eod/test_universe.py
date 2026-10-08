"""python -m unittest test_universe   (no network)"""

import unittest

from universe import clean_name, merge, retire_allowed, split_ticker


class Tickers(unittest.TestCase):
    def test_sme_suffix_stripped(self):
        self.assertEqual(split_ticker("ZEAL-SM.NS"), ("ZEAL", "SM"))

    def test_hyphenated_symbols_kept(self):
        self.assertEqual(split_ticker("BAJAJ-AUTO.NS"), ("BAJAJ-AUTO", None))
        self.assertEqual(split_ticker("M&M.NS"), ("M&M", None))

    def test_alternate_series(self):
        self.assertEqual(split_ticker("ABC-BE.NS"), ("ABC", "BE"))


class Names(unittest.TestCase):
    def test_legal_suffix(self):
        self.assertEqual(clean_name("Reliance Industries Limited"), "Reliance Industries")
        self.assertEqual(clean_name("ZEAL GLOBAL SERVICES LTD"), "ZEAL GLOBAL SERVICES")
        self.assertEqual(clean_name("Z-TECH (INDIA)  Ltd."), "Z-TECH (INDIA)")


class Merge(unittest.TestCase):
    def row(self, symbol, **kw):
        return {"symbol": symbol, "exchange": "NSE", "name": f"{symbol} Yahoo", "sector": "Technology",
                "segment": "equity", "vendor_ticker": None, "mcap_rank": 1, **kw}

    def test_existing_keep_name_and_history_new_get_400(self):
        existing = [{"symbol": "TCS", "name": "Tata Consultancy Services", "sector": "IT", "segment": "equity",
                     "history_days": 760, "is_active": True, "status_note": None}]
        rows, gone = merge([self.row("TCS"), self.row("NEWCO")], existing)
        by = {r["symbol"]: r for r in rows}
        self.assertEqual(by["TCS"]["name"], "Tata Consultancy Services")
        self.assertEqual(by["TCS"]["history_days"], 760)
        self.assertEqual(by["TCS"]["sector"], "Technology")          # one sector vocabulary everywhere
        self.assertEqual(by["NEWCO"]["history_days"], 400)
        self.assertEqual(gone, [])

    def test_retired_on_purpose_stays_retired(self):
        existing = [{"symbol": "TATAMOTORS", "name": "x", "sector": None, "segment": "equity", "history_days": 760,
                     "is_active": False, "status_note": "demerged"}]
        rows, _ = merge([self.row("TATAMOTORS")], existing)
        self.assertEqual(rows, [])

    def test_missing_symbols_reported_indices_never(self):
        existing = [
            {"symbol": "GONE", "name": "x", "sector": None, "segment": "equity", "history_days": 400, "is_active": True, "status_note": None},
            {"symbol": "NIFTY", "name": "x", "sector": None, "segment": "index", "history_days": 760, "is_active": True, "status_note": None},
        ]
        _, gone = merge([], existing)
        self.assertEqual(gone, ["GONE"])

    def test_retire_only_when_screener_complete(self):
        self.assertTrue(retire_allowed(3500, 3520))
        self.assertFalse(retire_allowed(1000, 3520))


if __name__ == "__main__":
    unittest.main()
