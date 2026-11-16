"""Second opinion on the stored end-of-day prices, from NSE's own bhavcopy. Read-only: writes nothing anywhere.

    python pipelines/eod/nse_check.py                    # every active NSE stock and fund, newest session
    python pipelines/eod/nse_check.py --symbols TCS,INFY
    python pipelines/eod/nse_check.py --limit 200        # the first 200 symbols only
    python pipelines/eod/nse_check.py --strict           # exit 1 when anything is listed for review, 2 when NSE gave no answer
    python pipelines/eod/nse_check.py --selftest         # talks ONLY to NSE (no database, no secrets)

The app's prices are Yahoo's (ADR-026) and audit.py compares the database with Yahoo, so neither can see Yahoo's
own mistakes. NSE runs a public MCP server over its bhavcopy (Streamable HTTP, no key). Its terms say "for
educational and research purposes only", so this is an internal check of OUR numbers and nothing else: NSE's
figures are never stored, never shown to users, and never used to correct a price. They appear only in this
job's log, next to ours, on the lines somebody should look at.

A. Newest session, every active symbol that is not an index: stored open/high/low/close/volume against
   `get_bulk_quote`, 50 symbols a call, only when both sides are on the same date.
   Stored prices are Yahoo's "Close" with auto_adjust=False (eod.py `fetch`): adjusted for later splits and bonuses,
   not for dividends. Nothing comes after the newest session, so it is the one bar that is comparable raw with
   NSE's unadjusted bhavcopy. An ex-date ON the newest session still trades at the new price on both sides; if one
   side has applied a split the other has not, every price is off by the same standard ratio and the symbol gets
   one line saying so instead of four price lines.
B. Splits and bonuses: symbols whose stored closes move more than 33 % in a day in the last 30 sessions are asked
   about with `get_corporate_actions`. A split or bonus on that date means our earlier history was not adjusted
   (eod.py `repair_series` should have); none means the move was real.

Nothing here fails the nightly job: a difference is a REVIEW line, an unreachable NSE is one line, exit code 0.
The client identifies itself as QuantsPulseBot (AGENTS.md rule 18), paces itself, and stops at a hard cap on
requests and on run time.
"""

from __future__ import annotations

import argparse
import http.client
import json
import re
import sys
import time as _time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from eod import BONUS_FACTORS, CALENDAR_STOCKS, IST, SPLIT_FACTORS, Candle, Rest, _num, chunks, load_env

NSE_MCP = "https://mcp.nseindia.in/bhavcopy/cm/mcp"
USER_AGENT = "QuantsPulseBot/1.0 (+https://quantplus-ten.vercel.app)"
PROTOCOL = "2025-03-26"
TIMEOUT = 20                 # seconds per request
TRIES = 3                    # per request, and per tool answer that says "try again"
BACKOFF = 1.0                # seconds before the second try; doubles
PACE = 0.25                  # seconds between requests: at most 4 a second
MAX_CALLS = 400              # requests per run (a full run needs ~75 + 40)
MAX_SECONDS = 360            # whole run, database reads included
MAX_BODY = 5_000_000         # bytes read from one answer
BULK = 50                    # symbols per get_bulk_quote (NSE's limit)
DB_CHUNK = 100               # symbols per database read
TOL_PRICE = 0.05             # rupees; stored prices are rounded to 2 dp
TOL_VOLUME = 0.20            # Yahoo revises volume; only a difference over 20 % is listed
BIG_MOVE = 0.33              # a one-day close-to-close change beyond this may be a split or bonus
MOVE_SESSIONS = 30
MAX_ACTION_SYMBOLS = 40      # get_corporate_actions calls per run
MAX_LINES = 50               # review lines printed
PRICE_FIELDS = ("open", "high", "low", "close")


class NseError(Exception):
    """Anything that stopped NSE from giving a usable answer."""


class NseUnreachable(NseError):
    """Network failure, a block, or an answer that is not MCP."""


class OutOfBudget(NseError):
    """The cap on requests or on run time was reached."""


class ToolError(NseError):
    """The tool answered with an error instead of data."""


_RETRY = re.compile(r"try again|shortly|right now|temporar|timed? ?out|unavailable|could not be fetched|busy|rate.?limit|too many", re.I)


def says_retry(message) -> bool:
    """An error that is about NSE's own source being down for a moment, not about the question asked."""
    return bool(_RETRY.search(str(message or "")))


def parse_body(text: str, content_type: str = "", want_id=None) -> dict | None:
    """The JSON-RPC answer in an HTTP body: plain JSON, or Server-Sent Events (`event:message` / `data:{...}`).
    Returns the message with `want_id`, else the first one carrying a result or an error; None when there is none
    (an HTML block page, an empty body). Plain JSON that does not parse raises ValueError."""
    text = (text or "").lstrip("﻿").strip()
    if not text:
        return None
    if "text/event-stream" in (content_type or "").lower() or not text.startswith(("{", "[")):
        messages, data = [], []
        for line in [*text.splitlines(), ""]:
            if line.startswith("data:"):
                data.append(line[5:].removeprefix(" "))
            elif not line.strip() and data:
                try:
                    messages.append(json.loads("\n".join(data)))
                except ValueError:
                    pass
                data = []
    else:
        doc = json.loads(text)
        messages = doc if isinstance(doc, list) else [doc]
    messages = [m for m in messages if isinstance(m, dict)]
    if want_id is not None:
        for m in messages:
            if m.get("id") == want_id:
                return m
    return next((m for m in messages if "result" in m or "error" in m), None)


def tool_payload(message: dict) -> dict:
    """The JSON document inside a tools/call answer's text content. Anything else raises ToolError, including a
    document with an `error` key: NSE answers HTTP 200 with {"error": "... could not be fetched ... try again
    shortly"} when its own source is down, and that never means "nothing found"."""
    if message.get("error"):
        err = message["error"]
        raise ToolError(str(err.get("message") if isinstance(err, dict) else err))
    result = message.get("result") or {}
    text = next((c.get("text") for c in result.get("content") or [] if isinstance(c, dict) and c.get("type") == "text"), None)
    if result.get("isError"):
        raise ToolError(str(text or "the tool reported an error"))
    if text is None:
        raise ToolError("the answer has no text content")
    try:
        doc = json.loads(text)
    except ValueError:
        raise ToolError(f"the answer is not JSON: {text[:120]}") from None
    if not isinstance(doc, dict):
        raise ToolError("the answer is not a JSON object")
    if doc.get("error"):
        raise ToolError(str(doc["error"]))
    return doc


def _read(res, sse: bool, timeout: float) -> str:
    if not sse:
        return res.read(MAX_BODY).decode("utf-8", errors="replace")
    # A stream may stay open after the answer: stop at the first complete JSON-RPC answer.
    started, lines, size = _time.monotonic(), [], 0
    while size < MAX_BODY and _time.monotonic() - started < timeout:
        raw = res.readline()
        if not raw:
            break
        lines.append(raw.decode("utf-8", errors="replace"))
        size += len(raw)
        if not raw.strip() and parse_body("".join(lines), "text/event-stream") is not None:
            break
    return "".join(lines)


def http_post(url: str, data: bytes, headers: dict, timeout: float) -> tuple[int, dict, str]:
    """-> (status, headers, body text). The only function that touches the network; a failure raises OSError."""
    req = urllib.request.Request(url, data=data, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            sse = "text/event-stream" in (res.headers.get("Content-Type") or "").lower()
            return res.status, dict(res.headers.items()), _read(res, sse, timeout)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers.items()) if e.headers else {}, e.read(2000).decode("utf-8", errors="replace")


class NseMcp:
    """A small MCP client for NSE's server: handshake, `call(tool, args)`, retries, pacing and hard caps.
    `transport`, `clock` and `sleep` are injected by the tests."""

    def __init__(self, url: str = NSE_MCP, transport=http_post, clock=_time.monotonic, sleep=_time.sleep,
                 timeout: float = TIMEOUT, tries: int = TRIES, backoff: float = BACKOFF, pace: float = PACE,
                 max_calls: int = MAX_CALLS, max_seconds: float = MAX_SECONDS):
        self.url, self.transport, self.clock, self.sleep = url, transport, clock, sleep
        self.timeout, self.tries, self.backoff, self.pace = timeout, tries, backoff, pace
        self.max_calls, self.max_seconds = max_calls, max_seconds
        self.started = clock()           # the run-time cap counts from here
        self.calls = 0                   # HTTP requests sent, retries included
        self.session: str | None = None
        self._id = 0
        self._last: float | None = None

    def elapsed(self) -> float:
        return self.clock() - self.started

    def remaining(self) -> float:
        return self.max_seconds - self.elapsed()

    def _pause(self, seconds: float) -> None:
        left = self.remaining()
        if left <= 0:
            raise OutOfBudget(f"the {self.max_seconds:g} s run-time cap was reached")
        if seconds > 0:
            self.sleep(min(seconds, left))

    def _post(self, body: dict) -> tuple[int, dict, str]:
        """One paced request, inside both caps."""
        if self.calls >= self.max_calls:
            raise OutOfBudget(f"the cap of {self.max_calls} requests was reached")
        if self._last is not None:
            self._pause(self.pace - (self.clock() - self._last))
        left = self.remaining()
        if left <= 0:
            raise OutOfBudget(f"the {self.max_seconds:g} s run-time cap was reached")
        headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "User-Agent": USER_AGENT}
        if self.session:
            headers["Mcp-Session-Id"] = self.session
        self.calls += 1
        try:
            status, head, text = self.transport(self.url, json.dumps(body).encode(), headers, min(self.timeout, left))
        finally:
            self._last = self.clock()
        return status, {str(k).lower(): v for k, v in (head or {}).items()}, text

    def _rpc(self, method: str, params: dict | None = None, notify: bool = False, handshake: bool = False):
        """-> (message, headers). Network errors, 5xx, 429 and unreadable answers are retried with backoff."""
        last = "no answer"
        for attempt in range(self.tries):
            if attempt:
                self._pause(self.backoff * 2 ** (attempt - 1))
            body: dict = {"jsonrpc": "2.0", "method": method}
            if not notify:
                self._id += 1
                body["id"] = self._id
            if params is not None:
                body["params"] = params
            try:
                status, head, text = self._post(body)
            except (OSError, http.client.HTTPException) as e:
                last = f"{type(e).__name__}: {e}"[:160]
                continue
            if status == 404 and self.session and not handshake:
                self.session = None                    # the session ended on NSE's side: start another
                self.connect()
                last = "the session expired"
                continue
            if status >= 500 or status == 429:
                last = f"HTTP {status}"
                continue
            if status >= 400:
                raise NseUnreachable(f"{method}: HTTP {status}")
            if notify:
                return None, head
            try:
                message = parse_body(text, head.get("content-type", ""), body["id"])
            except ValueError:
                message = None
            if message is None:
                last = "an answer that is not MCP"
                continue
            return message, head
        raise NseUnreachable(f"{method}: {last} (after {self.tries} tries)")

    def connect(self) -> dict:
        """initialize -> keep the Mcp-Session-Id header -> notifications/initialized. Returns the server's result."""
        message, head = self._rpc("initialize", {"protocolVersion": PROTOCOL, "capabilities": {},
                                                 "clientInfo": {"name": "QuantsPulseBot", "version": "1.0"}}, handshake=True)
        if message.get("error") or not isinstance(message.get("result"), dict):
            raise NseUnreachable(f"initialize refused: {str(message.get('error'))[:160]}")
        self.session = head.get("mcp-session-id")
        self._rpc("notifications/initialized", notify=True, handshake=True)
        return message["result"]

    def call(self, tool: str, args: dict) -> dict:
        """A tool's JSON document. An error that says "try again" is retried; after the last try, and for any other
        error, ToolError is raised: the caller must never read an error as an empty result."""
        last: Exception | None = None
        for attempt in range(self.tries):
            if attempt:
                self._pause(self.backoff * 2 ** (attempt - 1))
            message, _ = self._rpc("tools/call", {"name": tool, "arguments": args})
            try:
                return tool_payload(message)
            except ToolError as e:
                if not says_retry(e):
                    raise
                last = e
        raise ToolError(f"{last} (after {self.tries} tries)")


# ---------------------------------------------------------------- A. newest session
@dataclass
class Verdict:
    status: str                              # match | review | not_found | no_answer | date_differs
    lines: list[str] = field(default_factory=list)
    not_final: bool = False                  # NSE's close for the day is not published yet
    volume_revised: bool = False             # volumes differ, by no more than 20 %
    nse_day: str | None = None


def split_factor(ours: float, theirs: float) -> float | None:
    """The standard split/bonus ratio (eod.py's lists, either way) our price is of NSE's, else None."""
    if ours <= 0 or theirs <= 0:
        return None
    r = ours / theirs
    return next((f for k in (*SPLIT_FACTORS, *BONUS_FACTORS) for f in (k, 1 / k) if abs(r / f - 1) <= 0.03), None)


def compare_quote(ours: Candle, quote: dict | None) -> Verdict:
    """Our newest stored candle against NSE's quote for the same symbol."""
    if not isinstance(quote, dict):
        return Verdict("no_answer")
    if quote.get("error"):
        # "not found": an index, or a fund NSE files under another name. Anything else is NSE not answering.
        return Verdict("not_found" if "not found" in str(quote["error"]).lower() else "no_answer")
    nse_day = str(quote.get("date") or "")[:10]
    if nse_day != ours.day.isoformat():
        return Verdict("date_differs", nse_day=nse_day or None)
    nse = {k: _num(quote.get(k)) for k in (*PRICE_FIELDS, "prev_close", "volume")}
    if all(nse[k] is None for k in PRICE_FIELDS):
        return Verdict("no_answer", nse_day=nse_day)
    v = Verdict("match", nse_day=nse_day)
    off = [k for k in PRICE_FIELDS if nse[k] is not None and round(abs(getattr(ours, k) - nse[k]), 4) > TOL_PRICE]
    if "close" in off and nse["prev_close"] is not None and nse["close"] == nse["prev_close"]:
        # NSE shows the day's high and low with the close still equal to the previous close until its close is
        # final (seen 13 Nov 2026): not a difference.
        off.remove("close")
        v.not_final = True
    where = f"{ours.symbol} {ours.day}"
    factors = {split_factor(getattr(ours, k), nse[k]) for k in off}
    one_sided = len(off) >= 3 and len(factors) == 1 and None not in factors
    if one_sided:
        v.lines.append(f"{where}: every price is x{factors.pop():.4g} NSE's (open: ours {ours.open:.2f}, NSE {nse['open']:.2f})"
                       " - a split or bonus applied on one side only")
    else:
        v.lines += [f"{where} {k}: ours {getattr(ours, k):.2f}, NSE {nse[k]:.2f} ({getattr(ours, k) - nse[k]:+.2f})" for k in off]
    if nse["volume"] is not None and int(nse["volume"]) != ours.volume and not one_sided and not v.not_final:
        if abs(ours.volume - nse["volume"]) > TOL_VOLUME * nse["volume"]:
            pct = f" ({ours.volume / nse['volume'] - 1:+.0%})" if nse["volume"] else ""
            v.lines.append(f"{where} volume: ours {ours.volume}, NSE {int(nse['volume'])}{pct}")
        else:
            v.volume_revised = True
    if v.lines:
        v.status = "review"
    return v


@dataclass
class Tally:
    compared: int = 0
    matched: int = 0
    review_symbols: int = 0
    not_found: int = 0
    date_differs: int = 0
    no_answer: int = 0
    not_final: int = 0
    volume_revised: int = 0
    unchecked: int = 0
    nse_days: Counter = field(default_factory=Counter)
    lines: list[str] = field(default_factory=list)       # REVIEW lines, both checks
    stopped: str | None = None
    moved: int = 0                                       # symbols with a big one-day move
    asked: int = 0
    unadjusted: int = 0
    real: list[str] = field(default_factory=list)
    unknown: list[str] = field(default_factory=list)     # NSE could not say (never read as "no action")
    over_cap: int = 0

    def add(self, v: Verdict) -> None:
        if v.status in ("match", "review"):
            self.compared += 1
            self.matched += v.status == "match"
            self.review_symbols += v.status == "review"
            self.not_final += v.not_final
            self.volume_revised += v.volume_revised
            self.lines += v.lines
        elif v.status == "date_differs":
            self.date_differs += 1
            self.nse_days[v.nse_day or "no date"] += 1
        elif v.status == "not_found":
            self.not_found += 1
        else:
            self.no_answer += 1


def check_prices(nse: NseMcp, newest: dict[str, Candle], tally: Tally) -> None:
    symbols = sorted(newest)
    failed = 0
    for i, part in enumerate(chunks(symbols, BULK)):
        try:
            doc = nse.call("get_bulk_quote", {"symbols": part})
        except OutOfBudget as e:
            tally.stopped, tally.unchecked = str(e), len(symbols) - i * BULK
            return
        except NseError as e:
            tally.no_answer += len(part)
            failed += 1
            if failed >= 3:                              # three batches in a row: NSE has stopped answering
                tally.stopped = f"NSE stopped answering ({str(e)[:120]})"
                tally.unchecked = max(0, len(symbols) - (i + 1) * BULK)
                return
            continue
        failed = 0
        quotes = {str(q.get("symbol")): q for q in doc.get("quotes") or [] if isinstance(q, dict)}
        for s in part:
            tally.add(compare_quote(newest[s], quotes.get(s)))


# ---------------------------------------------------------------- B. splits and bonuses
_ADJUSTING = re.compile(r"demerg|scheme of arrangement|rights|consolidat|face value|sub-?division|capital reduction", re.I)


def big_moves(candles: list[Candle], sessions: int = MOVE_SESSIONS, limit: float = BIG_MOVE) -> list[tuple[date, date, float]]:
    """(day before, day, change) for each close-to-close change beyond the limit in the last `sessions` sessions."""
    tail = candles[-(sessions + 1):]
    return [(a.day, b.day, b.close / a.close - 1) for a, b in zip(tail, tail[1:]) if a.close > 0 and abs(b.close / a.close - 1) > limit]


def _ex_date(action: dict) -> date | None:
    try:
        return date.fromisoformat(str(action.get("exDate"))[:10])
    except ValueError:
        return None


def judge_move(symbol: str, prev_day: date, day: date, change: float, actions: list) -> tuple[str, str]:
    """-> ("unadjusted" | "other" | "real", line). An ex-date after the bar before the move and up to the move's own
    day is "on that date" (a thin stock may not trade on the ex-date itself)."""
    inside = [a for a in actions if isinstance(a, dict) and (d := _ex_date(a)) and prev_day < d <= day]
    hit = next((a for a in inside if str(a.get("actionType")).upper() in ("SPLIT", "BONUS")), None)
    if hit:
        return "unadjusted", (f'{symbol} {day}: {change:+.0%} in one day, and NSE lists {str(hit.get("actionType")).upper()} '
                              f'"{hit.get("purpose")}" ex {hit.get("exDate")} (factor {hit.get("adjustmentFactor")}): '
                              "our earlier prices were not adjusted for it")
    other = next((a for a in inside if _ADJUSTING.search(str(a.get("purpose") or ""))), None)
    if other:
        return "other", (f'{symbol} {day}: {change:+.0%} in one day, and NSE lists "{other.get("purpose")}" ex {other.get("exDate")}: '
                         "not a split or bonus, check by hand")
    return "real", f"{symbol} {day} {change:+.0%}"


def check_actions(nse: NseMcp, series: dict[str, list[Candle]], tally: Tally, cap: int = MAX_ACTION_SYMBOLS) -> None:
    moves = {s: m for s, cs in series.items() if (m := big_moves(cs))}
    order = sorted(moves, key=lambda s: (-max(d.toordinal() for _, d, _ in moves[s]), s))    # the newest moves first
    tally.moved, tally.over_cap = len(order), max(0, len(order) - cap)
    failed = 0
    for i, s in enumerate(order[:cap]):
        since = min(p for p, _, _ in moves[s]) - timedelta(days=3)
        try:
            doc = nse.call("get_corporate_actions", {"symbol": s, "fromDate": since.isoformat(), "toDate": series[s][-1].day.isoformat()})
            actions = doc.get("actions")
            if not isinstance(actions, list):
                raise ToolError("no list of actions in the answer")
            failed = 0
        except OutOfBudget as e:
            tally.stopped = tally.stopped or str(e)
            tally.unknown += order[i:cap]
            return
        except NseError:
            # NSE's corporate-actions source is flaky; an error is "could not say", never "no action".
            tally.unknown.append(s)
            failed += 1
            if failed >= 5:                              # the source is down: stop asking
                tally.unknown += order[i + 1:cap]
                return
            continue
        tally.asked += 1
        for prev_day, day, change in moves[s]:
            kind, line = judge_move(s, prev_day, day, change, actions)
            if kind == "real":
                tally.real.append(line)
            else:
                tally.unadjusted += kind == "unadjusted"
                tally.lines.append(line)


# ---------------------------------------------------------------- stored candles
def stored_series(db: Rest, symbols: list[str], since: date, out_of_time=lambda: False) -> dict[str, list[Candle]]:
    """Stored daily candles since `since`, oldest first: the rows audit.py reads (market_candles, NSE, 1d, the
    session's date in IST), a batch of symbols per request."""
    out: dict[str, list[Candle]] = {}
    for part in chunks(symbols, DB_CHUNK):
        if out_of_time():
            break
        names = urllib.parse.quote(",".join(f'"{x}"' for x in part))
        for r in db.get_all(f"market_candles?select=symbol,ts,open,high,low,close,volume&exchange=eq.NSE&interval=eq.1d"
                            f"&symbol=in.({names})&ts=gte.{since.isoformat()}&order=symbol,ts"):
            day = datetime.fromisoformat(r["ts"]).astimezone(IST).date()
            out.setdefault(r["symbol"], []).append(
                Candle(r["symbol"], day, float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"]), int(r["volume"] or 0)))
    return out


# ---------------------------------------------------------------- report
def report(tally: Tally, session, skipped: dict[str, int], nse: NseMcp) -> None:
    other_day = ""
    if tally.nse_days:
        day, n = tally.nse_days.most_common(1)[0]
        other_day = f" (NSE has {day} for {n})"
    skips = [f"{tally.not_found} NSE does not list", f"{tally.date_differs} on a different date{other_day}",
             f"{tally.no_answer} not answered", *(f"{n} {why}" for why, n in skipped.items() if n)]
    if tally.unchecked:
        skips.append(f"{tally.unchecked} not reached")
    print(f"nse_check: {tally.compared} symbols compared with NSE for {session}; {tally.matched} matched, "
          f"{tally.review_symbols} to review; skipped: {', '.join(skips)}; NSE close not final for {tally.not_final}, "
          f"volume revised within {TOL_VOLUME:.0%} for {tally.volume_revised}; NSE reachable ({nse.calls} requests, {nse.elapsed():.0f} s)"
          + (f"; stopped early: {tally.stopped}" if tally.stopped else ""))
    print(f"nse_check: splits and bonuses - {tally.moved} symbol(s) moved over {BIG_MOVE:.0%} in a day in the last {MOVE_SESSIONS} sessions; "
          f"NSE answered for {tally.asked}: {tally.unadjusted} not adjusted, {len(tally.real)} real move(s); "
          f"{len(tally.unknown)} NSE could not say, {tally.over_cap} over the cap of {MAX_ACTION_SYMBOLS}")
    for line in tally.lines[:MAX_LINES]:
        print("  REVIEW", line)
    if len(tally.lines) > MAX_LINES:
        print(f"  ... and {len(tally.lines) - MAX_LINES} more review line(s)")
    if tally.real:
        print("  real moves (NSE lists no split or bonus on the date):", ", ".join(tally.real[:15]))
    if tally.unknown:
        print("  NSE could not say (not read as 'no action'):", ", ".join(tally.unknown[:15]))


def selftest(nse: NseMcp) -> int:
    """Talks only to NSE. Non-zero only when the handshake fails."""
    print(f"nse_check selftest: {nse.url} as {USER_AGENT}")
    try:
        info = nse.connect()
    except NseError as e:
        print("  handshake FAILED:", e)
        return 1
    print(f"  handshake ok: server {json.dumps(info.get('serverInfo'))}, protocol {info.get('protocolVersion')}, "
          f"session id {'received' if nse.session else 'not sent by the server'}")
    today = datetime.now(IST).date()
    for label, tool, args in (
        ("bulk quote", "get_bulk_quote", {"symbols": list(CALENDAR_STOCKS)}),
        ("history", "get_stock_history", {"symbol": "RELIANCE", "months": 1, "endDate": "today"}),
        ("corporate actions", "get_corporate_actions", {"symbol": "RELIANCE", "fromDate": "2021-01-01", "toDate": today.isoformat()}),
    ):
        t = nse.clock()
        try:
            doc = nse.call(tool, args)
            print(f"  {label} ok ({nse.clock() - t:.1f} s): {json.dumps(doc)[:700]}")
        except NseError as e:
            print(f"  {label} gave no data ({nse.clock() - t:.1f} s): {type(e).__name__}: {e}")
    print(f"  {nse.calls} requests in {nse.elapsed():.1f} s")
    return 0


def main(argv: list[str] | None = None, nse: NseMcp | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--symbols", help="comma-separated subset (default: every active symbol that is not an index)")
    ap.add_argument("--limit", type=int, help="check only the first N symbols")
    ap.add_argument("--strict", action="store_true", help="exit 1 when anything is listed for review, 2 when NSE could not be asked")
    ap.add_argument("--selftest", action="store_true", help="talk only to NSE (no database, no secrets) and print what comes back")
    args = ap.parse_args(argv)

    nse = nse or NseMcp()                    # the run-time cap counts from here, database reads included
    if args.selftest:
        return selftest(nse)
    try:                                     # before touching the database: an unreachable NSE ends the run here
        nse.connect()
    except NseError as e:
        print(f"nse_check: NSE unreachable ({e}); nothing compared")
        return 2 if args.strict else 0

    skipped = {"indices": 0, "with no stored candle": 0}
    try:
        db = Rest(*load_env())
        meta = {m["symbol"]: m for m in db.symbols()}
        if args.symbols:
            meta = {s: meta[s] for s in args.symbols.split(",") if s in meta}
        skipped["indices"] = sum(1 for m in meta.values() if m["segment"] == "index")     # not in the equity bhavcopy
        symbols = sorted(s for s, m in meta.items() if m["segment"] != "index")[:args.limit]
        # ~50 calendar days hold the 31 sessions check B needs; check A uses each symbol's newest bar.
        series = stored_series(db, symbols, datetime.now(IST).date() - timedelta(days=52), lambda: nse.remaining() <= 0)
    except (RuntimeError, SystemExit) as e:
        print(f"nse_check: stored prices not readable ({str(e)[:160]}); nothing compared")
        return 2 if args.strict else 0
    skipped["with no stored candle"] = len(symbols) - len(series)
    if not series:
        print("nse_check: no stored candles for the symbols asked; nothing compared")
        return 2 if args.strict else 0

    tally = Tally()
    newest = {s: cs[-1] for s, cs in series.items()}
    session = Counter(c.day for c in newest.values()).most_common(1)[0][0]
    check_prices(nse, newest, tally)
    if not tally.stopped:
        check_actions(nse, series, tally)
    report(tally, session, skipped, nse)
    if not args.strict:
        return 0
    return 1 if tally.lines else 2 if tally.stopped or not tally.compared else 0


if __name__ == "__main__":
    sys.exit(main())
