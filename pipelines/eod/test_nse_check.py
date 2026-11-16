"""Unit tests for nse_check.py: no network, no database. Fixtures are shaped like answers NSE's MCP server gave on
13-14 Nov 2026 (from GitHub Actions; the office network blocks it).

    cd pipelines/eod && python -m unittest test_nse_check
"""

import json
import unittest
from datetime import date

import nse_check as n
from eod import Candle

SSE = "text/event-stream;charset=UTF-8"


def sse(message: dict) -> str:
    return f"event:message\ndata:{json.dumps(message)}\n\n"


def tool_answer(rid: int, doc, is_error: bool = False) -> dict:
    text = doc if isinstance(doc, str) else json.dumps(doc)
    return {"jsonrpc": "2.0", "id": rid, "result": {"content": [{"type": "text", "text": text}], "isError": is_error}}


def candle(**kw) -> Candle:
    base = dict(symbol="RELIANCE", day=date(2026, 11, 13), open=1336.6, high=1350.7, low=1324.0, close=1339.7, volume=13756247)
    base.update(kw)
    return Candle(**base)


QUOTE = {"symbol": "RELIANCE", "close": 1339.7, "open": 1336.6, "high": 1350.7, "low": 1324.0, "prev_close": 1335.4,
         "pct_change": 0.32, "volume": 13756247, "date": "2026-11-13"}


class Parsing(unittest.TestCase):
    def test_sse_answer(self):
        msg = n.parse_body(sse(tool_answer(3, {"count": 1})), SSE, want_id=3)
        self.assertEqual(msg["id"], 3)
        self.assertEqual(n.tool_payload(msg), {"count": 1})

    def test_plain_json_answer(self):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"protocolVersion": "2025-03-26"}})
        self.assertEqual(n.parse_body(body, "application/json", want_id=1)["result"]["protocolVersion"], "2025-03-26")

    def test_html_block_page_is_no_answer(self):
        self.assertIsNone(n.parse_body("<!DOCTYPE html><html><body>Access Blocked</body></html>", "text/html"))

    def test_empty_body_is_no_answer(self):
        self.assertIsNone(n.parse_body("", "application/json"))

    def test_error_document_is_never_empty(self):
        msg = tool_answer(4, {"error": "Corporate actions for RELIANCE could not be fetched from NSE right now. "
                                       "This does NOT mean there are none — try again shortly."})
        with self.assertRaises(n.ToolError) as ctx:
            n.tool_payload(msg)
        self.assertTrue(n.says_retry(ctx.exception))

    def test_tool_flagged_error(self):
        with self.assertRaises(n.ToolError):
            n.tool_payload(tool_answer(5, "boom", is_error=True))

    def test_not_found_is_not_a_retry(self):
        self.assertFalse(n.says_retry("not found"))


class Compare(unittest.TestCase):
    def test_exact_match(self):
        v = n.compare_quote(candle(), QUOTE)
        self.assertEqual(v.status, "match")
        self.assertEqual(v.lines, [])

    def test_inside_tolerance(self):
        self.assertEqual(n.compare_quote(candle(close=1339.74), QUOTE).status, "match")

    def test_price_difference_is_review(self):
        v = n.compare_quote(candle(close=1341.0), QUOTE)
        self.assertEqual(v.status, "review")
        self.assertIn("close", v.lines[0])

    def test_close_not_final_on_nse(self):
        # NSE showed the day's high/low with close == prev_close before its close was final
        q = {**QUOTE, "close": 1335.4, "prev_close": 1335.4}
        v = n.compare_quote(candle(), q)
        self.assertEqual(v.status, "match")
        self.assertTrue(v.not_final)

    def test_not_found(self):
        self.assertEqual(n.compare_quote(candle(symbol="NIFTY 50"), {"symbol": "NIFTY 50", "error": "not found"}).status, "not_found")

    def test_other_error_is_no_answer(self):
        self.assertEqual(n.compare_quote(candle(), {"symbol": "RELIANCE", "error": "busy"}).status, "no_answer")

    def test_date_mismatch_is_not_compared(self):
        v = n.compare_quote(candle(), {**QUOTE, "date": "2026-11-12"})
        self.assertEqual(v.status, "date_differs")
        self.assertEqual(v.lines, [])

    def test_one_sided_split_is_one_line(self):
        q = {**QUOTE, **{k: QUOTE[k] / 2 for k in ("open", "high", "low", "close", "prev_close")}}
        v = n.compare_quote(candle(), q)
        self.assertEqual(v.status, "review")
        self.assertEqual(len(v.lines), 1)
        self.assertIn("split or bonus", v.lines[0])

    def test_small_volume_revision_is_not_listed(self):
        v = n.compare_quote(candle(volume=int(QUOTE["volume"] * 1.05)), QUOTE)
        self.assertEqual(v.status, "match")
        self.assertTrue(v.volume_revised)

    def test_large_volume_difference_is_listed(self):
        self.assertEqual(n.compare_quote(candle(volume=int(QUOTE["volume"] * 1.5)), QUOTE).status, "review")


class FakeServer:
    """Answers like NSE's: initialize with a session header, then SSE tool answers."""

    def __init__(self, answers=None, status=200):
        self.answers = list(answers or [])
        self.status = status
        self.seen = []

    def __call__(self, url, data, headers, timeout):
        body = json.loads(data)
        self.seen.append((body.get("method"), headers.get("Mcp-Session-Id"), headers.get("User-Agent")))
        if self.status != 200:
            return self.status, {"Content-Type": "text/html"}, "<html>blocked</html>"
        if body["method"] == "initialize":
            return 200, {"Content-Type": "application/json", "Mcp-Session-Id": "abc"}, json.dumps(
                {"jsonrpc": "2.0", "id": body["id"], "result": {"protocolVersion": "2025-03-26", "serverInfo": {"name": "nse-bhavcopy-redis-mcp"}}})
        if body["method"] == "notifications/initialized":
            return 202, {}, ""
        doc = self.answers.pop(0) if self.answers else {"count": 0, "quotes": []}
        return 200, {"Content-Type": SSE}, sse(tool_answer(body["id"], doc))


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def now(self):
        return self.t

    def sleep(self, s):
        self.t += s


class Client(unittest.TestCase):
    def make(self, server, **kw):
        clock = FakeClock()
        return n.NseMcp(transport=server, clock=clock.now, sleep=clock.sleep, **kw), clock

    def test_handshake_keeps_session_and_identifies_honestly(self):
        server = FakeServer([{"count": 1, "quotes": [QUOTE]}])
        nse, _ = self.make(server)
        nse.connect()
        doc = nse.call("get_bulk_quote", {"symbols": ["RELIANCE"]})
        self.assertEqual(doc["quotes"][0]["symbol"], "RELIANCE")
        self.assertEqual(server.seen[-1][1], "abc")
        self.assertTrue(all(ua.startswith("QuantsPulseBot/") for _, _, ua in server.seen))

    def test_retry_then_success(self):
        flaky = {"error": "could not be fetched from NSE right now, try again shortly"}
        server = FakeServer([flaky, {"count": 3, "actions": []}])
        nse, _ = self.make(server)
        nse.connect()
        self.assertEqual(nse.call("get_corporate_actions", {"symbol": "RELIANCE"})["count"], 3)

    def test_persistent_flake_raises(self):
        flaky = {"error": "try again shortly"}
        nse, _ = self.make(FakeServer([flaky] * 5))
        nse.connect()
        with self.assertRaises(n.ToolError):
            nse.call("get_corporate_actions", {"symbol": "RELIANCE"})

    def test_blocked_is_unreachable(self):
        nse, _ = self.make(FakeServer(status=403))
        with self.assertRaises(n.NseUnreachable):
            nse.connect()

    def test_run_time_cap_stops_the_run(self):
        server = FakeServer([{"count": 0, "quotes": []}] * 50)
        nse, clock = self.make(server, max_seconds=10)
        nse.connect()
        clock.t = 11  # time passes (database reads, slow answers)
        with self.assertRaises(n.OutOfBudget):
            nse.call("get_bulk_quote", {"symbols": ["TCS"]})

    def test_request_cap_stops_the_run(self):
        nse, _ = self.make(FakeServer([{"count": 0, "quotes": []}] * 50), max_calls=3)
        nse.connect()  # 2 requests
        nse.call("get_bulk_quote", {"symbols": ["TCS"]})  # 3
        with self.assertRaises(n.OutOfBudget):
            nse.call("get_bulk_quote", {"symbols": ["INFY"]})


if __name__ == "__main__":
    unittest.main()
