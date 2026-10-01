"""Read-only accuracy audit of the market data the app shows.

    python pipelines/eod/audit.py              # every active symbol
    python pipelines/eod/audit.py --symbols TCS,INFY

1. Stored candles vs a fresh Yahoo download (same rounding) — must match exactly.
2. Sanity: OHLC consistency, duplicates, gaps, one-day moves > 18 %, stale symbols.
3. Every derived number recomputed independently in pandas and compared with
   what the app reads: market_snapshot (last, prev close, change, change %,
   52-week high/low, RSI), rsi_events (Wilder RSI 14), trading_signals
   (SMA 20/50 crosses, RSI reversals), backtest_ledgers (monthly SIP).
Writes nothing. Exit code 1 if any check fails.
"""

from __future__ import annotations

import argparse
import sys
import urllib.parse
from datetime import datetime, timedelta, timezone

import pandas as pd

from eod import HISTORY_FROM, IST, Rest, fetch, last_settled_day, load_env, to_candles

TOL_PRICE = 0.005    # numeric(14,4) vs 2-dp floats
TOL_RSI = 0.011      # SQL rounds to 2 dp


class Report:
    def __init__(self):
        self.fails: list[str] = []
        self.passes = 0

    def check(self, ok: bool, label: str):
        if ok:
            self.passes += 1
        else:
            self.fails.append(label)


def wilder_rsi(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    gain, loss = d.clip(lower=0), (-d).clip(lower=0)
    ag, al = [float("nan")] * len(close), [float("nan")] * len(close)
    if len(close) > n:
        g, l = gain.iloc[1:n + 1].mean(), loss.iloc[1:n + 1].mean()
        ag[n], al[n] = g, l
        for i in range(n + 1, len(close)):
            g = (g * (n - 1) + gain.iloc[i]) / n
            l = (l * (n - 1) + loss.iloc[i]) / n
            ag[i], al[i] = g, l
    ag, al = pd.Series(ag, index=close.index), pd.Series(al, index=close.index)
    rsi = 100 - 100 / (1 + ag / al)
    return rsi.where(al != 0, 100.0).where(ag.notna())


def get(db: Rest, table: str, query: str) -> pd.DataFrame:
    return pd.DataFrame(db.call("GET", f"{table}?{query}"))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols")
    ap.add_argument("--days", type=int, default=30, help="window for the Yahoo re-download comparison")
    args = ap.parse_args(argv)

    db = Rest(*load_env())
    symbols = args.symbols.split(",") if args.symbols else db.symbols()
    settled = last_settled_day(datetime.now(timezone.utc))
    r = Report()

    # ---- 1. stored vs fresh Yahoo
    frames = fetch(symbols, settled - timedelta(days=args.days), settled + timedelta(days=1))
    latest_dates = {}
    for s in symbols:
        fresh, _ = to_candles(s, frames.get(s), settled)
        q = urllib.parse.quote(s)
        stored = get(db, "market_candles", f"select=ts,open,high,low,close,volume&symbol=eq.{q}&exchange=eq.NSE&interval=eq.1d"
                                           f"&ts=gte.{(settled - timedelta(days=args.days)).isoformat()}&order=ts")
        st = {pd.Timestamp(x["ts"]).tz_convert(IST).date(): x for x in stored.to_dict("records")} if len(stored) else {}
        for c in fresh:
            row = st.get(c.day)
            if row is None:
                r.check(False, f"{s} {c.day}: on Yahoo, missing in DB")
                continue
            same = all(abs(float(row[k]) - getattr(c, k)) <= TOL_PRICE for k in ("open", "high", "low", "close")) and int(row["volume"]) == c.volume
            r.check(same, f"{s} {c.day}: DB {row['open']}/{row['high']}/{row['low']}/{row['close']} v{row['volume']} "
                          f"!= Yahoo {c.open}/{c.high}/{c.low}/{c.close} v{c.volume}")
        extra = set(st) - {c.day for c in fresh}
        r.check(not extra, f"{s}: DB has days Yahoo doesn't: {sorted(extra)}")
        latest_dates[s] = max(st) if st else None

    newest = max(d for d in latest_dates.values() if d)
    for s, d in latest_dates.items():
        r.check(d == newest, f"{s}: latest candle {d}, others have {newest} (stale)")

    snap = get(db, "market_snapshot", "select=*").set_index("symbol")

    for s in symbols:
        q = urllib.parse.quote(s)
        c = get(db, "market_candles", f"select=ts,open,high,low,close,volume&symbol=eq.{q}&exchange=eq.NSE&interval=eq.1d&order=ts")
        if c.empty:
            r.check(False, f"{s}: no candles")
            continue
        c["ts"] = pd.to_datetime(c["ts"], utc=True)
        for k in ("open", "high", "low", "close"):
            c[k] = c[k].astype(float)
        c = c.set_index("ts")

        # ---- 2. sanity
        r.check(c.index.is_unique, f"{s}: duplicate candles")
        bad = c[(c.high < c[["open", "close", "low"]].max(axis=1)) | (c.low > c[["open", "close", "high"]].min(axis=1)) | (c.low <= 0)]
        r.check(bad.empty, f"{s}: {len(bad)} inconsistent OHLC rows")
        mv = c.close.pct_change().abs()
        r.check((mv > 0.18).sum() == 0, f"{s}: one-day moves > 18 % on {[str(t.date()) for t in mv[mv > 0.18].index]}")
        gaps = c.index.to_series().diff().dt.days
        r.check((gaps > 6).sum() == 0, f"{s}: gaps over 6 days at {[str(t.date()) for t in gaps[gaps > 6].index]}")
        if s in HISTORY_FROM:
            r.check(c.index.min().tz_convert(IST).date() >= HISTORY_FROM[s], f"{s}: history before {HISTORY_FROM[s]}")

        # ---- 3a. snapshot
        last, prev = c.iloc[-1], c.iloc[-2]
        yr = c[c.index > c.index[-1] - pd.Timedelta(days=365)]
        rsi = wilder_rsi(c.close).round(2)
        if s not in snap.index:
            r.check(False, f"{s}: not in market_snapshot")
            continue
        sn = snap.loc[s]
        expect = {
            "last_price": last.close, "prev_close": prev.close, "change": last.close - prev.close,
            "change_pct": round((last.close - prev.close) / prev.close * 100, 2),
            "high_52w": yr.high.max(), "low_52w": yr.low.min(), "rsi": rsi.iloc[-1],
        }
        for k, v in expect.items():
            tol = TOL_RSI if k == "rsi" else TOL_PRICE
            r.check(abs(float(sn[k]) - float(v)) <= tol, f"{s}: snapshot {k} {sn[k]} != expected {v:.4f}")

        # ---- 3b. RSI history
        ev = get(db, "rsi_events", f"select=ts,rsi&symbol=eq.{q}&exchange=eq.NSE&order=ts")
        if len(ev):
            ev["ts"] = pd.to_datetime(ev["ts"], utc=True)
            ev = ev.set_index("ts").rsi.astype(float)
            diff = (ev - rsi.reindex(ev.index)).abs()
            r.check((diff > TOL_RSI).sum() == 0, f"{s}: {int((diff > TOL_RSI).sum())} RSI values off (max {diff.max():.3f})")

        # ---- 3c. signals
        sma20, sma50 = c.close.rolling(20, min_periods=1).mean(), c.close.rolling(50, min_periods=1).mean()
        n = pd.Series(range(1, len(c) + 1), index=c.index)
        up = (sma20 > sma50) & (sma20.shift() <= sma50.shift())
        dn = (sma20 < sma50) & (sma20.shift() >= sma50.shift())
        prsi = rsi.shift()
        exp = set()
        for t in c.index[(n > 50) & (up | dn)]:
            exp.add(("sma_20_50_cross", "buy" if up[t] else "exit", t.date()))
        for t in c.index[((prsi < 30) & (rsi >= 30)) | ((prsi > 70) & (rsi <= 70))]:
            exp.add(("rsi_reversal", "buy" if prsi[t] < 30 else "exit", t.date()))
        sg = get(db, "trading_signals", f"select=strategy,signal_type,generated_at&symbol=eq.{q}&exchange=eq.NSE")
        got = {(x["strategy"], x["signal_type"], pd.Timestamp(x["generated_at"]).tz_convert("UTC").date()) for x in sg.to_dict("records")} if len(sg) else set()
        r.check(got == exp, f"{s}: signals differ — missing {sorted(exp - got)[:3]}, unexpected {sorted(got - exp)[:3]}")

        # ---- 3d. SIP backtest
        led = get(db, "backtest_ledgers", f"select=ledger,roi_pct&symbol=eq.{q}&exchange=eq.NSE")
        if len(led):
            month = c.index.tz_convert(IST).tz_localize(None).to_period("M")
            firsts = c.groupby(month).head(1)
            units = (10000 / firsts.close).round(4)
            invested = 10000 * len(firsts)
            final = round(units.sum() * c.close.iloc[-1], 2)
            roi = round((units.sum() * c.close.iloc[-1] - invested) / invested * 100, 4)
            L = led.iloc[0]
            r.check(int(L.ledger["invested"]) == invested and abs(float(L.ledger["final_value"]) - final) <= 0.02
                    and abs(float(L.roi_pct) - roi) <= 0.0002,
                    f"{s}: backtest invested/final/roi {L.ledger['invested']}/{L.ledger['final_value']}/{L.roi_pct} != {invested}/{final}/{roi}")

    print(f"audit: {len(symbols)} symbols, latest session {newest}; {r.passes} checks passed, {len(r.fails)} failed")
    for f in r.fails:
        print("  FAIL", f)
    return 1 if r.fails else 0


if __name__ == "__main__":
    sys.exit(main())
