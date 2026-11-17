// Unit tests for the Stay-in Plan's state: npm run test:unit
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { stayInState } from "./stay-in";
import type { Candle, Signal } from "./types";

// n daily candles, day i = 2025-01-01 + i (IST midnight), close from `close(i)`, low from `low(i)` (default: the close).
function candles(n: number, close: (i: number) => number, low?: (i: number) => number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = close(i);
    return { ts: new Date(Date.parse("2025-01-01T00:00:00+05:30") + i * 86_400_000).toISOString(), open: c, high: c, low: low ? low(i) : c, close: c, volume: 1 };
  });
}
const dayTs = (i: number) => new Date(Date.parse("2025-01-01T12:00:00+05:30") + i * 86_400_000).toISOString();
const buy = (i: number, strategy = "sma_trend", stop: number | null = 50): Signal => ({
  id: i,
  symbol: "X",
  exchange: "NSE",
  strategy,
  signal_type: "buy",
  payload: { close: 150, stop },
  generated_at: dayTs(i),
});

describe("Stay-in Plan state", () => {
  test("no trend-rule buy, no plan", () => {
    assert.equal(stayInState(candles(250, () => 100), [buy(10, "rsi_dip")]), null);
  });
  test("running while every close stays at or above the 200-day average", () => {
    const s = stayInState(candles(260, (i) => 100 + i * 0.1), [buy(230)])!;
    assert.equal(s.status, "running");
    assert.equal(s.endedOn, null);
    assert.ok(s.sma200! < s.last!);
  });
  test("ends at the first close under the 200-day average after the buy", () => {
    const s = stayInState(candles(260, (i) => (i === 250 ? 90 : 150)), [buy(230)])!;
    assert.equal(s.status, "ended");
    assert.equal(s.how, "ma200");
    assert.equal(s.endedOn, "2025-09-08"); // day 250
  });
  test("a close under the average on or before the buy day does not count", () => {
    const s = stayInState(candles(260, (i) => (i === 230 ? 90 : 150)), [buy(230)])!;
    assert.equal(s.status, "running");
  });
  test("the safety stop ends it when reached first", () => {
    const s = stayInState(candles(260, (i) => (i === 250 ? 90 : 150), (i) => (i === 240 ? 45 : i === 250 ? 90 : 150)), [buy(230)])!;
    assert.equal(s.how, "stop");
    assert.equal(s.endedOn, "2025-08-29"); // day 240
  });
  test("the latest trend-rule buy is the one followed", () => {
    const s = stayInState(candles(260, (i) => (i === 220 ? 90 : 150)), [buy(200, "strong_trend"), buy(240, "secular_trend")])!;
    assert.equal(s.signal.strategy, "secular_trend");
    assert.equal(s.status, "running"); // the dip on day 220 was before this buy
  });
  test("under 200 closes there is no average, so only the stop can end it", () => {
    const s = stayInState(candles(120, (i) => (i === 100 ? 60 : 150)), [buy(50, "sma_trend", null)])!;
    assert.equal(s.sma200, null);
    assert.equal(s.stop, null);
    assert.equal(s.status, "running");
  });
});
