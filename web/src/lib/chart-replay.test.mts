import assert from "node:assert/strict";
import { test } from "node:test";
import {
  barsDue,
  buy,
  daysBeforeEnd,
  MIN_BARS,
  NO_PRACTICE,
  openResult,
  practiceSummary,
  revealedBetween,
  revealedUpTo,
  rewindPractice,
  sell,
  startIndex,
  type ReplayBar,
} from "./chart-replay";

// 60 sessions from 1 Jan 2026, closing 100, 101, 102, …
const bars: ReplayBar[] = Array.from({ length: 60 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i, 10, 0));
  return { ts: d.toISOString(), open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1000 };
});

test("the start is the last session on or before the date, with bars to read and bars left to play", () => {
  assert.equal(startIndex(bars, "2026-01-31"), 30);
  assert.equal(startIndex(bars, "2025-01-01"), MIN_BARS - 1, "never before there is something to read");
  assert.equal(startIndex(bars, "2027-01-01"), bars.length - 2, "never the last bar");
  assert.equal(daysBeforeEnd(bars, 30), "2026-01-30"); // the last bar is 1 March
});

test("playback keeps an even pace whatever the frame rate, and a hidden tab doesn't dump a burst", () => {
  for (const hz of [60, 120, 144]) {
    let carry = 0;
    let n = 0;
    for (let f = 0; f < hz; f++) {
      const r = barsDue(1000 / hz, 2, carry);
      carry = r.carryMs;
      n += r.bars;
    }
    assert.equal(n, 2, `${hz} Hz`);
  }
  assert.deepEqual(barsDue(30_000, 5, 0), { bars: 5, carryMs: 0 });
});

test("signals appear on the day they happened, never before", () => {
  const markers = [{ ts: "2026-01-10T15:30:00Z" }, { ts: "2026-01-12T15:30:00Z" }, { ts: "2026-02-20T15:30:00Z" }];
  assert.equal(revealedUpTo(markers, bars, 8).length, 0);
  assert.equal(revealedUpTo(markers, bars, 9).length, 1);
  assert.equal(revealedUpTo(markers, bars, 11).length, 2);
  assert.deepEqual(revealedBetween(markers, bars, 9, 11), [markers[1]]);
  assert.deepEqual(revealedBetween(markers, bars, 11, 11), []);
});

test("practice: buy at the close with whole shares, sell later, results in rupees and percent", () => {
  let p = buy(NO_PRACTICE, bars, 20); // close 120 → 833 shares of ₹1 lakh
  assert.deepEqual(p.position, { entryIndex: 20, entryPrice: 120, shares: 833 });
  assert.equal(buy(p, bars, 21), p, "one position at a time");
  assert.equal(sell(p, bars, 20), p, "not on the day it was bought");
  assert.deepEqual(openResult(p, bars, 30), { gain: 8330, pct: 8.33, days: 10 });
  p = sell(p, bars, 30);
  assert.equal(p.position, null);
  assert.deepEqual([p.trades[0].exitPrice, p.trades[0].gain, p.trades[0].pct], [130, 8330, 8.33]);
  p = sell(buy(p, bars, 40), bars, 45);
  assert.deepEqual(practiceSummary(p.trades), { count: 2, won: 2, gain: 8330 + Math.floor(100000 / 140) * 5 });
});

test("stepping back undoes what happened after the day on screen", () => {
  const p = sell(buy(NO_PRACTICE, bars, 20), bars, 30);
  assert.deepEqual(rewindPractice(p, 25), { position: { entryIndex: 20, entryPrice: 120, shares: 833 }, trades: [] }, "the sale is undone, the buy stays");
  assert.deepEqual(rewindPractice(p, 15), { position: null, trades: [] }, "both undone");
  assert.deepEqual(rewindPractice(p, 30), p, "nothing after the day: unchanged");
});
