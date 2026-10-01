"""End-of-day market data: Yahoo Finance (yfinance) -> Supabase.

    python pipelines/eod/eod.py                 # last 10 days (the daily run)
    python pipelines/eod/eod.py --days 760      # backfill ~2 years
    python pipelines/eod/eod.py --dry-run       # fetch + validate, write nothing

For every ACTIVE NSE row in public.market_symbols it fetches daily candles
(ticker = symbol + ".NS"), upserts public.market_candles, then calls
svc_refresh_market_analytics -> svc_refresh_research -> svc_run_eod_notifier.

Needs SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY,
from the environment or web/.env.local. Secrets are never printed.

Data notes (see docs/DECISIONS.md ADR-026):
  * Prices are split-adjusted "Close", not dividend-adjusted ("Adj Close").
  * Candles are stamped at the session close, 15:30 IST = 10:00 UTC, which the
    notifier and research SQL assume.
  * Today's candle is skipped until 15:45 IST: before that Yahoo serves a
    partial, still-moving bar.
  * Yahoo's terms allow personal, non-commercial use. A licensed feed should
    replace this for a paid product; only fetch() needs to change.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

IST = timezone(timedelta(hours=5, minutes=30))
SESSION_SETTLED = time(15, 45)          # IST; after the 15:30 close + closing auction
CANDLE_UTC = time(10, 0)                # 15:30 IST
BATCH = 500
ROOT = Path(__file__).resolve().parents[2]

# Yahoo tickers that are not simply SYMBOL.NS (none today; add here if one appears).
YAHOO_OVERRIDES: dict[str, str] = {}

# Ignore Yahoo history before these dates. Yahoo files pre-demerger Tata Motors
# prices under TMPV without adjusting for the CV spin-off (a -40% "move" on the
# 14 Oct 2025 ex-date), which would poison RSI, 52-week range and backtests.
HISTORY_FROM: dict[str, date] = {"TMPV": date(2025, 10, 14)}


@dataclass(frozen=True)
class Candle:
    symbol: str
    day: date
    open: float
    high: float
    low: float
    close: float
    volume: int

    def row(self) -> dict:
        ts = datetime.combine(self.day, CANDLE_UTC, tzinfo=timezone.utc)
        return {
            "symbol": self.symbol, "exchange": "NSE", "interval": "1d", "ts": ts.isoformat(),
            "open": self.open, "high": self.high, "low": self.low, "close": self.close, "volume": self.volume,
        }


def yahoo_ticker(symbol: str) -> str:
    return YAHOO_OVERRIDES.get(symbol, f"{symbol}.NS")


def last_settled_day(now: datetime) -> date:
    """Latest trading date whose candle is final at `now`."""
    local = now.astimezone(IST)
    return local.date() if local.time() >= SESSION_SETTLED else local.date() - timedelta(days=1)


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def to_candles(symbol: str, frame, settled: date) -> tuple[list[Candle], list[str]]:
    """Validate one ticker's yfinance frame. Returns (candles, problems)."""
    out: list[Candle] = []
    problems: list[str] = []
    if frame is None or len(frame) == 0:
        return out, [f"{symbol}: no rows"]
    for idx, r in frame.iterrows():
        day = idx.date() if hasattr(idx, "date") else idx
        if day > settled:
            continue                                   # partial bar for a session still in progress
        if symbol in HISTORY_FROM and day < HISTORY_FROM[symbol]:
            continue
        o, h, l, c = (_num(r.get(k)) for k in ("Open", "High", "Low", "Close"))
        if None in (o, h, l, c):
            continue                                   # holiday / suspended: Yahoo leaves NaNs
        if min(o, h, l, c) <= 0 or h < max(o, c, l) or l > min(o, c, h):
            problems.append(f"{symbol} {day}: inconsistent OHLC {o}/{h}/{l}/{c}")
            continue
        vol = _num(r.get("Volume")) or 0
        out.append(Candle(symbol, day, round(o, 2), round(h, 2), round(l, 2), round(c, 2), int(vol)))
    return out, problems


def fetch(symbols: list[str], start: date, end_exclusive: date) -> dict:
    """{symbol: DataFrame} from Yahoo. The only function tied to the data vendor."""
    import yfinance as yf

    tickers = {yahoo_ticker(s): s for s in symbols}
    data = yf.download(
        list(tickers), start=start.isoformat(), end=end_exclusive.isoformat(), interval="1d",
        auto_adjust=False, actions=False, group_by="ticker", threads=True, progress=False,
    )
    frames = {}
    for t, s in tickers.items():
        # group_by="ticker" gives (ticker, field) columns, even for one ticker in yfinance 1.x
        has = getattr(data.columns, "nlevels", 1) > 1 and t in data.columns.get_level_values(0)
        frames[s] = data[t].dropna(how="all") if has else None
    return frames


# ---------------------------------------------------------------- Supabase
def load_env() -> tuple[str, str]:
    env = dict(os.environ)
    local = ROOT / "web" / ".env.local"
    if local.exists():
        for line in local.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip().strip('"'))
    url = env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (environment or web/.env.local).")
    return url.rstrip("/"), key


class Rest:
    def __init__(self, url: str, key: str):
        self.url, self.key = url, key

    def call(self, method: str, path: str, body=None, prefer: str | None = None):
        headers = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(f"{self.url}/rest/v1/{path}", data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                raw = res.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path.split('?')[0]} -> {e.code}: {e.read()[:300].decode(errors='replace')}") from None
        return json.loads(raw) if raw else None

    def symbols(self) -> list[str]:
        rows = self.call("GET", "market_symbols?select=symbol&exchange=eq.NSE&is_active=is.true&order=symbol")
        return [r["symbol"] for r in rows]

    def upsert_candles(self, rows: list[dict]) -> None:
        for i in range(0, len(rows), BATCH):
            self.call("POST", "market_candles?on_conflict=symbol,exchange,interval,ts", rows[i:i + BATCH],
                      prefer="resolution=merge-duplicates,return=minimal")

    def prune_before(self, symbol: str, day: date) -> None:
        """Remove rows older than HISTORY_FROM (idempotent; cheap when nothing matches)."""
        cut = datetime.combine(day, time(0), tzinfo=IST).isoformat().replace("+", "%2B")
        sym = urllib.parse.quote(symbol)
        for table, col in (("market_candles", "ts"), ("rsi_events", "ts"), ("trading_signals", "generated_at")):
            self.call("DELETE", f"{table}?symbol=eq.{sym}&exchange=eq.NSE&{col}=lt.{cut}", prefer="return=minimal")

    def rpc(self, fn: str, args: dict | None = None):
        return self.call("POST", f"rpc/{fn}", args or {})


# ---------------------------------------------------------------- main
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--days", type=int, default=10, help="calendar days to (re)fetch (default 10; ~760 backfills 2y)")
    ap.add_argument("--dry-run", action="store_true", help="fetch and validate only")
    ap.add_argument("--symbols", help="comma-separated subset (default: every active NSE symbol)")
    args = ap.parse_args(argv)

    url, key = load_env()
    db = Rest(url, key)
    symbols = args.symbols.split(",") if args.symbols else db.symbols()
    settled = last_settled_day(datetime.now(timezone.utc))
    start = settled - timedelta(days=args.days)
    print(f"eod: {len(symbols)} symbols, {start} .. {settled} (settled)")

    frames = fetch(symbols, start, settled + timedelta(days=1))
    rows, problems, missing = [], [], []
    for s in symbols:
        candles, issues = to_candles(s, frames.get(s), settled)
        problems += issues
        if not candles:
            missing.append(s)
        rows += [c.row() for c in candles]
    for p in problems:
        print("  warn:", p)
    print(f"eod: {len(rows)} candles; no data for {len(missing)}: {', '.join(missing) or '-'}")

    if args.dry_run:
        return 0
    if len(missing) > len(symbols) // 2:
        print("eod: more than half the universe returned nothing — not writing (Yahoo outage or block?)")
        return 2

    db.upsert_candles(rows)
    for s, day in HISTORY_FROM.items():
        if s in symbols:
            db.prune_before(s, day)
    print("eod: analytics", db.rpc("svc_refresh_market_analytics", {"p_days": args.days + 5}))
    print("eod: research notes", db.rpc("svc_refresh_research"))
    print("eod: notifier", db.rpc("svc_run_eod_notifier"))
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
