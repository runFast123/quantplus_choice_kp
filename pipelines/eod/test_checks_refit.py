"""python -m unittest test_checks_refit   (no network, no database)"""

import json
import math
import unittest
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

import tier_model as T
from checks_refit import clean, quarter_start, refit, training_frame

HERE = Path(__file__).resolve().parent
TEAM = HERE.parents[1] / "research" / "strategies" / "team" / "metalabel"


def synthetic(n=600, seed=0):
    """RSI dip-like trades where breadth200 helps: enough for a model that ranks its own past."""
    rng = np.random.default_rng(seed)
    days = pd.bdate_range("2020-01-01", periods=n)
    X = rng.normal(size=(n, len(T.FEATURES)))
    y = (X[:, T.FEATURES.index("breadth200")] + rng.normal(scale=1.0, size=n)) > 0
    df = pd.DataFrame(X, columns=T.FEATURES)
    df.insert(0, "symbol", [f"S{i % 37}" for i in range(n)])
    df.insert(1, "signal_date", days)
    df.insert(2, "net", np.where(y, 0.02, -0.02))
    df["rule"] = "rsi_dip"
    return df


class Quarter(unittest.TestCase):
    def test_quarter_start(self):
        self.assertEqual(quarter_start(date(2027, 2, 14)), date(2027, 1, 1))
        self.assertEqual(quarter_start(date(2026, 12, 31)), date(2026, 10, 1))
        self.assertEqual(quarter_start(date(2026, 7, 1)), date(2026, 7, 1))


class Refit(unittest.TestCase):
    def test_only_finished_trades_and_clean_json(self):
        df = synthetic()
        q = date(2022, 4, 1)
        model, hr = refit(df, q)
        self.assertEqual(model["n_train"], int((df.signal_date < pd.Timestamp(q) - pd.Timedelta(days=28)).sum()))
        self.assertEqual(model["features"], T.FEATURES)
        self.assertEqual(model["valid_from"], "2022-04-01")
        self.assertTrue(model["shown"], "a model that ranks its own past is in force")
        self.assertGreater(model["coef"][T.FEATURES.index("breadth200")], 0)
        json.dumps(model, allow_nan=False)             # PostgREST refuses NaN
        self.assertIsNotNone(hr)

    def test_model_that_ranks_its_past_backwards_is_not_in_force(self):
        df = synthetic()
        b = df.breadth200.to_numpy()
        flip = np.arange(len(df)) >= len(df) // 2                   # what helped in the first half hurts later
        df["net"] = np.where((b > 0) != flip, 0.02, -0.02)
        model, _ = refit(df, date(2022, 4, 1))
        self.assertEqual(model["platt_a"], 0.0)
        self.assertFalse(model["shown"])

    def test_clean(self):
        self.assertEqual(clean({"a": [1.0, float("nan")], "b": float("inf")}), {"a": [1.0, None], "b": None})

    def test_training_frame_checks_feature_order(self):
        with self.assertRaises(SystemExit):
            training_frame({"features": ["d200"], "rows": []})
        df = training_frame({"features": T.FEATURES, "rows": [["A", "2026-01-05", 0.01, [None] * 25]]})
        self.assertTrue(math.isnan(df.loc[0, "d200"]))


@unittest.skipUnless((TEAM / "out" / "rsi_dip_training_rows.csv").exists(), "research files not present")
class SameAsResearch(unittest.TestCase):
    def test_copy_is_identical(self):
        self.assertEqual((TEAM / "tier_model.py").read_bytes(), (HERE / "tier_model.py").read_bytes())

    def test_refit_reproduces_the_seeded_quarter(self):
        df = pd.read_csv(TEAM / "out" / "rsi_dip_training_rows.csv", parse_dates=["signal_date"])
        model, _ = refit(df, date(2026, 10, 1))
        seeded = next(m for m in json.loads((TEAM / "out" / "rsi_dip_tier_models_by_quarter.json").read_text())
                      if m["valid_from"] == "2026-10-01")
        for k in ("coef", "mean", "sd", "median"):
            np.testing.assert_allclose(model[k], seeded[k], rtol=1e-9, atol=1e-12)
        for k in ("intercept", "platt_a", "platt_b", "cut_lo", "cut_hi"):
            self.assertAlmostEqual(model[k], seeded[k], places=10)


if __name__ == "__main__":
    unittest.main()
