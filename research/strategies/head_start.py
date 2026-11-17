"""Head-start meter: does it matter how far a stock had already run when a rule fired? (16-17 Nov 2026)

The owner's motive is to be in a long trend early (around Rs 200, not after the breakout at Rs 400). early_entry.py
showed the rules are not earlier than random days, so the site cannot say "we are earlier". This study measures the
honest version: at each signal, how far along its one-year range the stock already was, and whether that changed how
the rule's own trade turned out. Everything below was written down BEFORE the first run.

Trades: the six live rules exactly as early_entry.rules() builds them from their record scripts (each year's 300 most
traded stocks, signals 2019-07..2026-10, the rule's own plan, 0.5 % round-trip cost). Closed trades only.

Stage at the signal close (day i), from the long price file (from 2010, so 2019 signals have a full year behind them):
  lo, hi      the lowest low and highest high of the 252 sessions up to and including day i
  position    (close_i - lo) / (hi - lo), 0 = at the one-year low, 1 = at the one-year high
  run         close_i / lo - 1, how far above the one-year low
  A signal with fewer than 200 sessions of history, or hi == lo, gets no stage and is left out.
Buckets (fixed):
  position    "low" < 0.25, "lower middle" 0.25-0.5, "upper middle" 0.5-0.75, "high" >= 0.75
  run         < 25 %, 25-50 %, 50-100 %, >= 100 %
Measured per rule x bucket, all years and the two periods 2019-07..2023-12 / 2024-01..2026-10:
  n, win rate (net > 0), median net result, mean net result, and "room": the median best close in the 60 sessions from
  the entry day, over the entry price (how far the stock went at its best, whatever the plan did).
Decision, per rule (written before the run):
  "stage matters"  in BOTH periods the median net result of the "high" bucket and of the low half (low + lower middle
                   pooled) differ by at least 1.5 points, in the same direction, each side with n >= 30.
  otherwise        "little difference": the meter says how far the stock had run and that, for this rule, it made
                   little difference to the trades. A bucket with n < 30 is shown as "too few trades".
The meter only ever shows these measured numbers, labelled as past results of the rule's plan, never a forecast.

    python head_start.py   -> data/head_start.json
"""
import json

import numpy as np
import pandas as pd

import backtest as B
import early_entry as E
import improve_lr as L

LOOK = 252
MIN_HIST = 200
MIN_N = 30
GAP = 0.015
ROOM = 60
POS_EDGES = [0.25, 0.5, 0.75]
POS_NAMES = ["low", "lower middle", "upper middle", "high"]
RUN_EDGES = [0.25, 0.5, 1.0]
RUN_NAMES = ["<25%", "25-50%", "50-100%", ">=100%"]


def long_ranges():
    """symbol -> DataFrame(lo, hi) indexed by date: rolling 252-session low/high from the long file."""
    long = pd.read_parquet(B.D / "candles_long.parquet").dropna(subset=["high", "low", "close"])
    long = long[(long.close > 0) & (long.low > 0)]
    long["date"] = pd.to_datetime(long.date).dt.tz_localize(None)
    out = {}
    for s, g in long.groupby("symbol"):
        g = g.sort_values("date").drop_duplicates("date")
        out[s] = pd.DataFrame({
            "lo": g.low.rolling(LOOK, min_periods=MIN_HIST).min().to_numpy(),
            "hi": g.high.rolling(LOOK, min_periods=MIN_HIST).max().to_numpy(),
        }, index=g.date.to_numpy())
    return out


def frame(rule, s):
    return L.FR[s] if rule == "ma200_trend" else E.F.ALL[s]


def stage_rows(trades):
    rng = long_ranges()
    rows = []
    for rule, t in trades.items():
        for r in t.itertuples():
            if pd.isna(r.net):
                continue
            f = frame(rule, r.symbol)
            d = pd.Timestamp(f.date.iat[r.i])
            d = d.tz_localize(None) if d.tzinfo is not None else d
            g = rng.get(r.symbol)
            if g is None or d not in g.index:
                continue
            lo, hi = g.at[d, "lo"], g.at[d, "hi"]
            close = float(f.close.iat[r.i])
            if pd.isna(lo) or pd.isna(hi) or hi <= lo:
                continue
            j_end = min(len(f), r.j + ROOM)
            peak = float(np.nanmax(f.close.iloc[r.j:j_end].to_numpy())) if r.j < len(f) else np.nan
            rows.append({
                "rule": rule, "symbol": r.symbol, "date": d, "net": float(r.net),
                "position": (close - lo) / (hi - lo), "run": close / lo - 1,
                "room": peak / r.entry - 1 if r.entry > 0 else np.nan,
            })
    df = pd.DataFrame(rows)
    df["pos_b"] = pd.cut(df.position, [-np.inf, *POS_EDGES, np.inf], right=False, labels=POS_NAMES)
    df["run_b"] = pd.cut(df.run, [-np.inf, *RUN_EDGES, np.inf], right=False, labels=RUN_NAMES)
    df["period"] = np.where(df.date < E.IS_END, "2019-23", "2024-26")
    return df


def stats(g):
    return {"n": int(len(g)),
            "win": round(float((g.net > 0).mean()) * 100, 1) if len(g) else None,
            "median": round(float(g.net.median()) * 100, 2) if len(g) else None,
            "mean": round(float(g.net.mean()) * 100, 2) if len(g) else None,
            "room": round(float(g.room.median()) * 100, 1) if len(g) else None}


def decide(d):
    gaps = {}
    for p in ("2019-23", "2024-26"):
        x = d[d.period == p]
        hi, low = x[x.pos_b == "high"], x[x.pos_b.isin(["low", "lower middle"])]
        if len(hi) < MIN_N or len(low) < MIN_N:
            return "little difference", gaps
        gaps[p] = float(hi.net.median() - low.net.median())
    a, b = gaps["2019-23"], gaps["2024-26"]
    same = np.sign(a) == np.sign(b)
    return ("stage matters" if same and abs(a) >= GAP and abs(b) >= GAP else "little difference"), gaps


def main():
    E.K.attach()                                     # Special K columns, as early_entry.main() does
    df = stage_rows(E.rules())
    out = {}
    for rule in E.RULES:
        d = df[df.rule == rule]
        verdict, gaps = decide(d)
        out[rule] = {
            "verdict": verdict,
            "gap_high_minus_low_half": {k: round(v * 100, 2) for k, v in gaps.items()},
            "all": stats(d),
            "period": {p: stats(d[d.period == p]) for p in ("2019-23", "2024-26")},
            "position": {b: {"all": stats(d[d.pos_b == b]), **{p: stats(d[(d.pos_b == b) & (d.period == p)])
                                                               for p in ("2019-23", "2024-26")}} for b in POS_NAMES},
            # descriptive only (the decision above is on position): shown in the app next to both periods
            "run": {b: {"all": stats(d[d.run_b == b]), **{p: stats(d[(d.run_b == b) & (d.period == p)])
                                                          for p in ("2019-23", "2024-26")}} for b in RUN_NAMES},
            "position_share": {b: round(float((d.pos_b == b).mean()) * 100, 1) for b in POS_NAMES},
        }
        print(f"\n== {rule}: {verdict}  gaps {out[rule]['gap_high_minus_low_half']}  n={len(d)}")
        for b in POS_NAMES:
            s = out[rule]["position"][b]
            print(f"  {b:13s} all {s['all']}  | 19-23 med {s['2019-23']['median']} n {s['2019-23']['n']}"
                  f" | 24-26 med {s['2024-26']['median']} n {s['2024-26']['n']}")
        for b in RUN_NAMES:
            print(f"  run {b:8s} {out[rule]['run'][b]['all']}")
    (B.D / "head_start.json").write_text(json.dumps(out, indent=1))


TS = B.D.parent.parent.parent / "web" / "src" / "lib" / "head-start-data.ts"


def export_ts():
    """data/head_start.json -> web/src/lib/head-start-data.ts (the numbers the app's meter shows; no recompute)."""
    d = json.loads((B.D / "head_start.json").read_text())
    keep = lambda s: {"n": s["n"], "win": s["win"], "median": s["median"]}
    out = {rule: {"all": keep(v["all"]), "periods": {p: keep(s) for p, s in v["period"].items()},
                  "bands": {b: {k: keep(s) for k, s in bv.items()} for b, bv in v["run"].items()}}
           for rule, v in d.items()}
    TS.write_text(
        "// Generated by research/strategies/head_start.py --ts from data/head_start.json. Do not edit by hand.\n"
        "// Each rule's closed trades, 2019-07..2026-10, each year's 300 most traded NSE stocks, the rule's own plan,\n"
        "// after 0.5 % costs; by how far the stock stood above its 1-year low at the signal. win and median in %.\n"
        "import type { RuleKey } from \"./rules\";\n\n"
        "export interface BandStats {\n  n: number;\n  win: number | null;\n  median: number | null;\n}\n"
        "type Split = { all: BandStats; \"2019-23\": BandStats; \"2024-26\": BandStats };\n"
        "export interface RuleRecord {\n  all: BandStats;\n  periods: { \"2019-23\": BandStats; \"2024-26\": BandStats };\n"
        "  bands: { \"<25%\": Split; \"25-50%\": Split; \"50-100%\": Split; \">=100%\": Split };\n}\n\n"
        f"export const HEAD_START: Record<RuleKey, RuleRecord> = {json.dumps(out, indent=2)};\n",
        encoding="utf-8")
    print("wrote", TS)


if __name__ == "__main__":
    import sys
    export_ts() if "--ts" in sys.argv else main()
