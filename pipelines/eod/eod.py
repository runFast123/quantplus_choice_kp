"""End-of-day market data: Yahoo Finance (yfinance) -> Supabase.

    python pipelines/eod/eod.py --sync-universe   # refresh the symbol list, then the daily load
    python pipelines/eod/eod.py                   # last 10 days for every active symbol
    python pipelines/eod/eod.py --days 760        # re-fetch ~2 years
    python pipelines/eod/eod.py --dry-run         # fetch + validate, write nothing
    python pipelines/eod/eod.py --symbols TCS,INFY

Covers every active row in public.market_symbols (~3,600: NSE main board +
SME, major ETFs, NSE indices — see universe.py). Symbols with no data yet get
their full `history_days`; the rest get the last `--days`. Then, in batches
small enough for PostgREST's 8 s statement limit:
svc_refresh_market_analytics -> svc_refresh_research -> svc_run_eod_notifier.

Needs SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY,
from the environment or web/.env.local. Secrets are never printed.

Data notes (see docs/DECISIONS.md ADR-026, ADR-027):
  * Prices are split-adjusted "Close", not dividend-adjusted ("Adj Close").
  * Candles are stamped at the session close, 15:30 IST = 10:00 UTC, which the
    notifier and research SQL assume.
  * Today's candle is skipped until 15:45 IST: before that Yahoo serves a
    partial, still-moving bar.
  * Yahoo's terms allow personal, non-commercial use. A licensed feed should
    replace this for a paid product; only fetch() and universe.py touch Yahoo.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time as _time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

IST = timezone(timedelta(hours=5, minutes=30))
SESSION_SETTLED = time(15, 45)          # IST; after the 15:30 close + closing auction
CANDLE_UTC = time(10, 0)                # 15:30 IST
BATCH = 1000                            # candle rows per upsert
FETCH_CHUNK = 100                       # tickers per Yahoo download
ANALYTICS_CHUNK = 100                   # symbols per analytics RPC (8 s statement limit)
RESEARCH_CHUNK = 300                    # symbols per research RPC
ROOT = Path(__file__).resolve().parents[2]

# Ignore Yahoo history before these dates. Yahoo files pre-demerger Tata Motors
# prices under TMPV without adjusting for the CV spin-off (a -40% "move" on the
# 14 Oct 2025 ex-date), which would poison RSI, 52-week range and backtests.
HISTORY_FROM: dict[str, date] = {"TMPV": date(2025, 10, 14)}

# When Yahoo reports a split/bonus, it rescales that stock's entire history. The
# daily run only fetches a few days, so it re-fetches this much for that stock.
FULL_HISTORY_DAYS = 800


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


def yahoo_ticker(symbol: str, vendor_ticker: str | None = None) -> str:
    return vendor_ticker or f"{symbol}.NS"


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
        if min(o, h, l, c) > 0 and l <= c <= h and not l <= o <= h:
            # Thin stocks: Yahoo sometimes carries a stale open outside the day's range while
            # high/low/close agree. Keep the day (dropping it would fake the next day's change)
            # and pull the open into the range.
            o = min(max(o, l), h)
        if min(o, h, l, c) <= 0 or h < max(o, c, l) or l > min(o, c, h):
            problems.append(f"{symbol} {day}: inconsistent OHLC {o}/{h}/{l}/{c}")
            continue
        vol = _num(r.get("Volume")) or 0
        out.append(Candle(symbol, day, round(o, 2), round(h, 2), round(l, 2), round(c, 2), int(vol)))
    return out, problems


def fetch(symbols, start: date, end_exclusive: date) -> dict:
    """{symbol: DataFrame} from Yahoo, in chunks. `symbols` is a list of NSE symbols
    or a {symbol: yahoo ticker} map. The only function tied to the data vendor."""
    import yfinance as yf

    tickers = symbols if isinstance(symbols, dict) else {s: yahoo_ticker(s) for s in symbols}
    by_ticker = {t: s for s, t in tickers.items()}
    frames: dict = {}
    items = list(by_ticker.items())
    for i in range(0, len(items), FETCH_CHUNK):
        chunk = dict(items[i:i + FETCH_CHUNK])
        data = yf.download(
            list(chunk), start=start.isoformat(), end=end_exclusive.isoformat(), interval="1d",
            auto_adjust=False, actions=True, group_by="ticker", threads=True, progress=False,
        )
        for t, s in chunk.items():
            frames[s] = _pick(data, t)
        if i + FETCH_CHUNK < len(items):
            _time.sleep(1)
    # The threaded download occasionally drops a ticker ("database is locked" in yfinance's
    # timezone cache). Retry those one at a time before calling them missing — but not
    # when most of a big run is empty (an outage: retrying thousands would only crawl).
    empty = [s for s in tickers if frames.get(s) is None or frames[s].empty]
    if len(empty) <= max(25, len(tickers) // 20):
        for s in empty:
            one = yf.download(
                tickers[s], start=start.isoformat(), end=end_exclusive.isoformat(), interval="1d",
                auto_adjust=False, actions=True, group_by="ticker", threads=False, progress=False,
            )
            frames[s] = _pick(one, tickers[s])
    return frames


def _pick(data, ticker: str):
    # group_by="ticker" gives (ticker, field) columns, even for one ticker in yfinance 1.x
    has = getattr(data.columns, "nlevels", 1) > 1 and ticker in data.columns.get_level_values(0)
    return data[ticker].dropna(how="all") if has else None


def split_symbols(frames: dict) -> list[str]:
    """Symbols whose frame shows a split or bonus (Yahoo's "Stock Splits" ratio, 0 = none)."""
    out = []
    for s, f in frames.items():
        if f is not None and "Stock Splits" in f.columns:
            ratio = f["Stock Splits"].fillna(0)
            if ((ratio > 0) & (ratio != 1)).any():
                out.append(s)
    return out


# NSE was open on a date if NIFTY 50 has a bar for it, or if at least two of these large
# caps traded (volume > 0). Yahoo's NIFTY series itself skips the odd session (14 Sep 2026),
# and its holiday bars are flat with zero volume, so neither source alone is enough.
CALENDAR_SYMBOL = "NIFTY"
CALENDAR_STOCKS = ("RELIANCE", "HDFCBANK", "TCS", "INFY", "ICICIBANK")


def sessions(index_days: set[date], stock_days: dict[str, set[date]]) -> set[date]:
    """Trading days from the index's bars and the large caps' traded days."""
    counts: dict[date, int] = {}
    for days in stock_days.values():
        for d in days:
            counts[d] = counts.get(d, 0) + 1
    return set(index_days) | {d for d, n in counts.items() if n >= 2}


def on_trading_days(rows: list[dict], calendar: set[date], trust_after: date) -> tuple[list[dict], int]:
    """Drop rows dated on days the exchange was closed. Yahoo sometimes emits a flat,
    zero-volume bar for a holiday (2 Oct 2026: 209 symbols, mostly ETFs). Dates after
    `trust_after` are kept unjudged (the calendar can't speak for them)."""
    if not calendar:
        return rows, 0
    kept = [r for r in rows if (d := date.fromisoformat(r["ts"][:10])) in calendar or d > trust_after]
    return kept, len(rows) - len(kept)


BREAK = 0.35                 # a one-day move this large is a data break, not trading …
OPEN_GAP = 0.10              # … unless the session opened near the previous close (it traded there)
SPLIT_FACTORS = (2, 3, 4, 5, 10, 20, 25, 50, 100)


def is_break(prev: Candle | float, cur: Candle) -> bool:
    """A data break gaps at the open; a real crash or rally (PB Fintech, 24 Sep 2026: opened
    -6 %, closed -33 % on 11x volume) happens during the session."""
    pc = prev.close if isinstance(prev, Candle) else prev
    if pc <= 0 or abs(cur.close / pc - 1) <= BREAK:
        return False
    return abs(cur.open / pc - 1) > OPEN_GAP


def repair_series(candles: list[Candle]) -> tuple[list[Candle], list[str]]:
    """Fix price breaks Yahoo left in a symbol's history.

    * A one-day ratio within 3 % of a standard split/bonus/consolidation factor
      (1:2 … 1:100 either way) is an unadjusted split: every earlier bar is scaled by
      that factor (volume inversely) — what Yahoo should have done.
    * Any other move over 35 % (demergers, bad vendor history) cuts the history to
      start at the break, so indicators only ever see one consistent price level.
    """
    out = list(candles)
    notes: list[str] = []
    i = 1
    while i < len(out):
        if not is_break(out[i - 1], out[i]):
            i += 1
            continue
        r = out[i].close / out[i - 1].close
        factor = next((f for f in (*SPLIT_FACTORS, *(1 / k for k in SPLIT_FACTORS)) if abs(r / f - 1) <= 0.03), None)
        if factor is not None:
            out[:i] = [Candle(c.symbol, c.day, round(c.open * factor, 2), round(c.high * factor, 2), round(c.low * factor, 2),
                              round(c.close * factor, 2), int(round(c.volume / factor))) for c in out[:i]]
            notes.append(f"{out[i].day}: unadjusted split ×{factor:g} applied to earlier history")
            i += 1
        else:
            notes.append(f"{out[i].day}: {r - 1:+.0%} break — history before it dropped")
            out = out[i:]
            i = 1
    return out, notes


def has_break(candles: list[Candle], last_close: float | None, last_day: date | None) -> bool:
    """Daily run: a break inside the new bars, or between the stored close and the first new bar."""
    seq = [c for c in candles if last_day is None or c.day > last_day]
    prevs: list[Candle | float] = [last_close, *seq[:-1]] if last_close else seq[:-1]
    cur = seq if last_close else seq[1:]
    return any(is_break(p, c) for p, c in zip(prevs, cur))


def chunks(xs: list, n: int):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


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

    def call(self, method: str, path: str, body=None, prefer: str | None = None, retries: int = 2):
        headers = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        data = None if body is None else json.dumps(body).encode()
        for attempt in range(retries + 1):
            req = urllib.request.Request(f"{self.url}/rest/v1/{path}", data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=120) as res:
                    raw = res.read()
                return json.loads(raw) if raw else None
            except urllib.error.HTTPError as e:
                msg = e.read()[:300].decode(errors="replace")
                if e.code >= 500 and attempt < retries:
                    _time.sleep(2 * (attempt + 1))
                    continue
                raise RuntimeError(f"{method} {path.split('?')[0]} -> {e.code}: {msg}") from None
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt < retries:
                    _time.sleep(2 * (attempt + 1))
                    continue
                raise RuntimeError(f"{method} {path.split('?')[0]} -> {e}") from None

    def get_all(self, path: str) -> list[dict]:
        """GET past PostgREST's 1,000-row cap (path must include an order=)."""
        out, offset = [], 0
        while True:
            rows = self.call("GET", f"{path}&limit=1000&offset={offset}") or []
            out += rows
            if len(rows) < 1000:
                return out
            offset += 1000

    def symbols(self) -> list[dict]:
        return self.get_all("market_symbols?select=symbol,vendor_ticker,history_days,segment"
                            "&exchange=eq.NSE&is_active=is.true&order=symbol")

    def quoted(self) -> dict[str, tuple[float, date]]:
        """Symbols that have data -> (last close, its session date)."""
        return {r["symbol"]: (float(r["last_price"]), date.fromisoformat(r["as_of"][:10]))
                for r in self.get_all("market_quotes?select=symbol,last_price,as_of&exchange=eq.NSE&order=symbol")}

    def replace_history(self, symbol: str) -> None:
        """Delete a symbol's candles and everything derived from them (before a repaired reload)."""
        sym = urllib.parse.quote(symbol)
        for table in ("market_candles", "rsi_events", "trading_signals"):
            self.call("DELETE", f"{table}?symbol=eq.{sym}&exchange=eq.NSE", prefer="return=minimal")

    def upsert(self, table: str, rows: list[dict], on_conflict: str, ignore: bool = False, batch: int = BATCH) -> None:
        how = "ignore-duplicates" if ignore else "merge-duplicates"
        for part in chunks(rows, batch):
            self.call("POST", f"{table}?on_conflict={on_conflict}", part, prefer=f"resolution={how},return=minimal")

    def prune_before(self, symbol: str, day: date) -> None:
        """Remove rows older than HISTORY_FROM (idempotent; cheap when nothing matches)."""
        cut = datetime.combine(day, time(0), tzinfo=IST).isoformat().replace("+", "%2B")
        sym = urllib.parse.quote(symbol)
        for table, col in (("market_candles", "ts"), ("rsi_events", "ts"), ("trading_signals", "generated_at")):
            self.call("DELETE", f"{table}?symbol=eq.{sym}&exchange=eq.NSE&{col}=lt.{cut}", prefer="return=minimal")

    def rpc(self, fn: str, args: dict | None = None):
        return self.call("POST", f"rpc/{fn}", args or {})


def sync_universe(db: Rest) -> None:
    import universe

    fresh = universe.fetch_universe()
    existing = db.get_all("market_symbols?select=symbol,name,sector,segment,history_days,is_active,status_note"
                          "&exchange=eq.NSE&order=symbol")
    rows, gone = universe.merge(fresh, existing)
    db.upsert("market_symbols", rows, "symbol,exchange", batch=500)
    active = sum(1 for r in existing if r["is_active"] and r["segment"] in ("equity", "sme"))
    listed = sum(1 for r in fresh if r["segment"] in ("equity", "sme"))
    if gone and universe.retire_allowed(listed, active):
        for part in chunks(gone, 100):
            ids = ",".join(json.dumps(s) for s in part)
            db.call("PATCH", f"market_symbols?exchange=eq.NSE&symbol=in.({urllib.parse.quote(ids)})",
                    {"is_active": False}, prefer="return=minimal")
    # Per-company news search: the 300 largest (plus anything watched/held — DB trigger).
    top = [{"symbol": r["symbol"], "exchange": "NSE"} for r in fresh
           if r["segment"] == "equity" and r.get("mcap_rank") and r["mcap_rank"] <= 300]
    db.upsert("news_search_cursor", top, "symbol,exchange", ignore=True)
    print(f"universe: {len(fresh)} listed ({listed} equities), {len(rows)} upserted, "
          f"{len(gone)} missing{' → retired' if gone and universe.retire_allowed(listed, active) else ' (kept: screener looked partial)' if gone else ''}")


# ---------------------------------------------------------------- main
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--days", type=int, default=10, help="calendar days to (re)fetch for symbols that have data (default 10)")
    ap.add_argument("--dry-run", action="store_true", help="fetch and validate only")
    ap.add_argument("--symbols", help="comma-separated subset (default: every active symbol)")
    ap.add_argument("--sync-universe", action="store_true", help="refresh market_symbols from Yahoo's NSE screener first")
    ap.add_argument("--repair", action="store_true", help="re-fetch the full history of --symbols and repair price breaks")
    args = ap.parse_args(argv)

    if args.repair and not args.symbols:
        ap.error("--repair needs --symbols (a full re-fetch of every symbol is a backfill, not a repair)")
    db = Rest(*load_env())
    if args.sync_universe and not args.dry_run:
        sync_universe(db)

    meta = {r["symbol"]: r for r in db.symbols()}
    if args.symbols:
        meta = {s: meta[s] for s in args.symbols.split(",") if s in meta}
    tick = {s: yahoo_ticker(s, r.get("vendor_ticker")) for s, r in meta.items()}
    have = db.quoted()
    settled = last_settled_day(datetime.now(timezone.utc))

    old = [s for s in meta if s in have]
    new = [s for s in meta if s not in have]
    print(f"eod: {len(meta)} symbols ({len(old)} with data, {len(new)} new), settled {settled}")

    frames = fetch({s: tick[s] for s in old}, settled - timedelta(days=args.days), settled + timedelta(days=1)) if old else {}
    resync = set() if args.days >= FULL_HISTORY_DAYS else set(split_symbols(frames))
    if resync:
        print(f"eod: split/bonus for {', '.join(sorted(resync))} — re-fetching their full history (Yahoo rescales it)")
    # A price break against the stored history (an unadjusted split, a demerger) needs the
    # whole series re-fetched and repaired; --repair forces that for the listed symbols.
    breaks = {s for s in old if meta[s]["segment"] != "index"
              and has_break(to_candles(s, frames.get(s), settled)[0], *have[s])}
    repair = (set(meta) if args.repair else set()) | breaks
    if breaks:
        print(f"eod: price break for {', '.join(sorted(breaks))} — re-fetching and repairing their history")
    full = sorted(set(new) | resync | repair)
    for days in sorted({meta[s]["history_days"] for s in full}):
        group = [s for s in full if meta[s]["history_days"] == days]
        frames.update(fetch({s: tick[s] for s in group}, settled - timedelta(days=days), settled + timedelta(days=1)))

    per: dict[str, list[Candle]] = {}
    problems, missing, replaced = [], [], []
    for s in meta:
        candles, issues = to_candles(s, frames.get(s), settled)
        problems += [p for p in issues if not p.endswith("no rows")]
        if s in full and meta[s]["segment"] != "index":
            candles, notes = repair_series(candles)
            problems += [f"{s} {n}" for n in notes]
            if s in have and (notes or args.repair):     # --repair restores the full re-fetched series
                replaced.append(s)
        if not candles:
            missing.append(s)
        per[s] = candles
    rows = [c.row() for cs in per.values() for c in cs]
    for p in problems[:40]:
        print("  warn:", p)
    # Trading calendar from this run's bars and what's stored (see `sessions`). If this run
    # produced a calendar it speaks for every day up to `settled`; otherwise only for the
    # days already stored.
    oldest = min((date.fromisoformat(r["ts"][:10]) for r in rows), default=settled)
    index_days = {c.day for c in to_candles(CALENDAR_SYMBOL, frames.get(CALENDAR_SYMBOL), settled)[0]}
    stock_days: dict[str, set[date]] = {s: {c.day for c in to_candles(s, frames.get(s), settled)[0] if c.volume > 0}
                                        for s in CALENDAR_STOCKS}
    fresh_cal = sessions(index_days, stock_days)
    names = ",".join([CALENDAR_SYMBOL, *CALENDAR_STOCKS])
    for r in db.get_all(f"market_candles?select=symbol,ts,volume&exchange=eq.NSE&interval=eq.1d&symbol=in.({names})"
                        f"&ts=gte.{oldest.isoformat()}&order=symbol,ts"):
        d = date.fromisoformat(r["ts"][:10])
        if r["symbol"] == CALENDAR_SYMBOL:
            index_days.add(d)
        elif r["volume"]:
            stock_days[r["symbol"]].add(d)
    calendar = sessions(index_days, stock_days)
    rows, dropped = on_trading_days(rows, calendar, settled if fresh_cal else max(calendar, default=settled))
    if dropped:
        print(f"eod: dropped {dropped} bars dated on exchange holidays")
    missing_old = [s for s in missing if s in have]
    print(f"eod: {len(rows)} candles; no data for {len(missing)} "
          f"({len(missing_old)} previously covered{': ' + ', '.join(missing_old[:20]) if missing_old else ''})")

    if args.dry_run:
        return 0
    if old and len(missing_old) > len(old) // 2:
        print("eod: more than half the covered symbols returned nothing — not writing (Yahoo outage or block?)")
        return 2

    for s in replaced:                    # repaired series replace what's stored, derived rows too
        db.replace_history(s)
    if replaced:
        print(f"eod: replaced the history of {len(replaced)} repaired symbol(s)")
    db.upsert("market_candles", rows, "symbol,exchange,interval,ts")
    for s, day in HISTORY_FROM.items():
        if s in meta:
            db.prune_before(s, day)

    touched = [s for s in meta if s not in missing]
    totals: dict[str, int] = {}
    for group, days in (([s for s in touched if s not in full], args.days + 5), ([s for s in touched if s in full], FULL_HISTORY_DAYS)):
        for part in chunks(group, ANALYTICS_CHUNK if days < 100 else ANALYTICS_CHUNK // 2):
            for k, v in (db.rpc("svc_refresh_market_analytics", {"p_days": days, "p_symbols": part}) or {}).items():
                totals[k] = totals.get(k, 0) + v
    print("eod: analytics", totals)
    notes = sum(db.rpc("svc_refresh_research", {"p_symbols": part}) or 0 for part in chunks(touched, RESEARCH_CHUNK))
    print("eod: research notes", notes)
    print("eod: notifier", db.rpc("svc_run_eod_notifier"))
    # A handful of suspended / illiquid names always come back empty; flag the run only
    # when more than 2 % of previously covered symbols are missing.
    return 1 if len(missing_old) > max(5, len(old) // 50) else 0


if __name__ == "__main__":
    sys.exit(main())
