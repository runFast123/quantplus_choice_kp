"""Quarterly refit of the RSI dip check (ADR-038, migration 39).

At each quarter start: read the training set (the research record plus the live RSI dip trades closed since, each
with the 25 numbers it was scored on), fit tier_model.py on the trades signalled more than 28 days before the quarter
(so every result is final), and store the model for the quarter. From then on the database scores every new RSI dip
setup with it (private.refresh_rsi_checks). tier_model.py is a byte-for-byte copy of the research team's file
(research/strategies/team/metalabel/tier_model.py); test_checks_refit.py keeps them equal.

  python checks_refit.py                         # the current quarter (IST)
  python checks_refit.py --quarter 2027-01-01 --dry-run

Re-running a quarter fits the same model again. Credentials as for eod.py; secrets are never printed.
"""
from __future__ import annotations

import argparse
import math
import sys
from datetime import date, datetime

import pandas as pd

import tier_model as T
from eod import IST, Rest, load_env


def quarter_start(d: date) -> date:
    return date(d.year, 3 * ((d.month - 1) // 3) + 1, 1)


def clean(x):
    """JSON for PostgREST: NaN / inf become null."""
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    if isinstance(x, list):
        return [clean(v) for v in x]
    if isinstance(x, float) and not math.isfinite(x):
        return None
    return x


def training_frame(payload: dict) -> pd.DataFrame:
    if payload["features"] != T.FEATURES:
        raise SystemExit("the database's feature order differs from tier_model.FEATURES")
    rows = [[s, d, n, *f] for s, d, n, f in payload["rows"]]
    df = pd.DataFrame(rows, columns=["symbol", "signal_date", "net", *T.FEATURES])
    df[T.FEATURES] = df[T.FEATURES].astype(float)          # missing values arrive as null
    df["signal_date"] = pd.to_datetime(df.signal_date)
    df["rule"] = "rsi_dip"
    return df


def refit(df: pd.DataFrame, q: date) -> tuple[dict, float | None]:
    model = T.fit(df, asof=q.isoformat())
    model["valid_from"] = q.isoformat()
    hr = T.hr_rule(df, q.isoformat())
    return clean(model), (hr if math.isfinite(hr) else None)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--quarter", help="quarter start, YYYY-MM-DD (default: the current quarter in IST)")
    ap.add_argument("--dry-run", action="store_true", help="fit and print; store nothing")
    args = ap.parse_args(argv)
    q = date.fromisoformat(args.quarter) if args.quarter else quarter_start(datetime.now(IST).date())
    if q != quarter_start(q):
        sys.exit("--quarter must be the first day of a quarter")

    db = Rest(*load_env())
    df = training_frame(db.rpc("svc_signal_check_training", {"p_strategy": "rsi_dip"}))
    model, hr = refit(df, q)
    print(f"refit {q}: {model['n_train']} finished trades (of {len(df)}) through {model['trained_through']}; "
          f"in force: {model['shown']}; calibration slope {model.get('platt_a')}; self-test AUC "
          f"{model.get('self_test_auc')}; hr_rule {hr}")
    if args.dry_run:
        return 0
    db.rpc("svc_put_signal_check_model",
           {"p_strategy": "rsi_dip", "p_valid_from": q.isoformat(), "p_hr_rule": hr, "p_model": model})
    print("stored")
    return 0


if __name__ == "__main__":
    sys.exit(main())
