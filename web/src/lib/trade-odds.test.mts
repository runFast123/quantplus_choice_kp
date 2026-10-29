// Unit tests for the trade odds engine: npm run test:unit
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { barIndex, historicalOdds, oddsVerdict, plainOdds, rng, simulateOdds, wholeCounts, type SimOdds } from "./trade-odds";
import type { Candle } from "./types";

// Daily candles from a list of [high, low, close] multipliers applied to the close before.
function series(n: number, move: (i: number) => [number, number, number], start = 100): Candle[] {
  const out: Candle[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const [h, l, c] = move(i);
    out.push({ ts: new Date(Date.UTC(2026, 0, 1 + i, 10)).toISOString(), open: p, high: p * h, low: p * l, close: p * c, volume: 1 });
    p *= c;
  }
  return out;
}

describe("simulateOdds", () => {
  test("same seed, same numbers", () => {
    const a = rng(19), b = rng(19);
    assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  });

  test("a market that only rises always reaches a long target first", () => {
    const c = series(120, () => [1.01, 1.0, 1.01]);
    const sim = simulateOdds(c, 119, { direction: "long", entry: 100, stop: 95, target: 103, horizon: 5 }, { paths: 2000 })!;
    assert.equal(sim.pTarget, 1);
    assert.equal(sim.rAtTarget, 0.6);
    assert.ok(Math.abs(sim.avgR - 0.6) < 1e-9);
  });

  test("a market that only falls always stops a long out", () => {
    const c = series(120, () => [1.0, 0.98, 0.98]);
    const sim = simulateOdds(c, 119, { direction: "long", entry: 100, stop: 95, target: 110, horizon: 5 }, { paths: 2000 })!;
    assert.equal(sim.pStop, 1);
    assert.equal(sim.avgR, -1);
  });

  test("a day that touches both sides counts as the stop", () => {
    const c = series(120, () => [1.06, 0.94, 1.0]);
    const sim = simulateOdds(c, 119, { direction: "long", entry: 100, stop: 95, target: 105, horizon: 3 }, { paths: 500 })!;
    assert.equal(sim.pStop, 1);
  });

  test("shorts mirror longs", () => {
    const c = series(120, () => [1.0, 0.98, 0.98]);
    const sim = simulateOdds(c, 119, { direction: "short", entry: 100, stop: 105, target: 96, horizon: 5 }, { paths: 1000 })!;
    assert.equal(sim.pTarget, 1);
  });

  test("only days before the entry are drawn (no look-ahead)", () => {
    // Up days until index 99, crash days after: an entry at 99 must never see the crash.
    const c = series(200, (i) => (i < 100 ? [1.01, 1.0, 1.01] : [1.0, 0.9, 0.9]));
    const sim = simulateOdds(c, 99, { direction: "long", entry: 100, stop: 95, target: 103, horizon: 5 }, { paths: 1000, lookback: 80 })!;
    assert.equal(sim.pStop, 0);
    assert.equal(sim.poolDays, 80);
  });

  test("too little history or a malformed plan gives no answer", () => {
    const c = series(40, () => [1.01, 0.99, 1.0]);
    assert.equal(simulateOdds(c, 39, { direction: "long", entry: 100, stop: 95, target: 105, horizon: 5 }), null);
    const long = series(120, () => [1.01, 0.99, 1.0]);
    assert.equal(simulateOdds(long, 119, { direction: "long", entry: 100, stop: 101, target: 105, horizon: 5 }), null);
  });
});

describe("historicalOdds", () => {
  test("walks each past entry over the real bars after it, at the same R", () => {
    // Flat for 30 days, then +1 %/day: an entry on day 5 stays flat (neither), one on day 28 runs to target.
    const c = series(60, (i) => (i < 30 ? [1.001, 0.999, 1.0] : [1.01, 1.0, 1.01]));
    const h = historicalOdds(
      c,
      [
        { ts: c[5].ts, price: c[5].close, stop: c[5].close * 0.95 },
        { ts: c[28].ts, price: c[28].close, stop: c[28].close * 0.98 },
        { ts: c[58].ts, price: c[58].close, stop: c[58].close * 0.98 }, // too recent: skipped
        { ts: c[10].ts, price: c[10].close, stop: null }, // no stop: skipped
      ],
      "long",
      1,
      5,
    );
    assert.equal(h.fired, 2);
    assert.equal(h.neither, 1);
    assert.equal(h.target, 1);
  });

  test("barIndex finds the bar at or before a time", () => {
    const c = series(5, () => [1, 1, 1]);
    assert.equal(barIndex(c, c[2].ts), 2);
    assert.equal(barIndex(c, "2025-01-01T00:00:00Z"), -1);
  });
});

describe("oddsVerdict", () => {
  const sim = (pTarget: number, pStop: number, rAtTarget = 1, avgR = 0): SimOdds => ({
    paths: 10000, horizon: 5, poolDays: 250, seed: 19, pTarget, pStop, pNeither: 1 - pTarget - pStop, avgR, rAtTarget,
  });
  test("the reel's TSLA numbers read as a coin flip", () => {
    assert.equal(oddsVerdict(sim(0.294, 0.255)).headline, "Close to a coin flip");
  });
  test("leans and strong verdicts, judged against break-even at the target's R", () => {
    assert.equal(oddsVerdict(sim(0.6, 0.4)).headline, "Leans toward the target");
    assert.equal(oddsVerdict(sim(0.2, 0.7)).headline, "Strongly toward the stop");
    // At 2R, winning a third of decided paths is break-even, not "toward the stop".
    assert.equal(oddsVerdict(sim(0.3, 0.6, 2)).headline, "Close to break-even");
  });
  test("many undecided paths and a contrary average are called out", () => {
    const v = oddsVerdict(sim(0.15, 0.05, 1, -0.1));
    assert.ok(v.notes.some((n) => /hit neither/.test(n)));
    assert.ok(v.notes.some((n) => /Average result is −0.10R/.test(n)));
    assert.equal(oddsVerdict(sim(0, 0)).headline, "Undecided");
  });
});

describe("plainOdds", () => {
  const sim = (pTarget: number, pStop: number, rAtTarget = 1): SimOdds => ({
    paths: 10000, horizon: 5, poolDays: 250, seed: 19, pTarget, pStop, pNeither: 1 - pTarget - pStop, avgR: 0, rAtTarget,
  });
  test("counts out of 100 always add up to 100", () => {
    assert.deepEqual(wholeCounts([0.294, 0.451, 0.255]), [29, 45, 26]);
    assert.deepEqual(wholeCounts([1 / 3, 1 / 3, 1 / 3]).reduce((a, b) => a + b, 0), 100);
  });
  test("plain words, same thresholds as the verdict", () => {
    assert.equal(plainOdds(sim(0.294, 0.255)).headline, "About even");
    assert.equal(plainOdds(sim(0.6, 0.4)).headline, "Leans toward the target");
    assert.equal(plainOdds(sim(0.2, 0.7)).headline, "Clearly toward the stop");
    assert.equal(plainOdds(sim(0, 0)).headline, "Too early to tell");
  });
  test("the pass mark moves with the target's distance", () => {
    const p = plainOdds(sim(0.3, 0.6, 2));
    assert.equal(p.needed, 33);
    assert.equal(p.won, 33);
    assert.equal(p.tone, "even");
    assert.equal(plainOdds(sim(0.5, 0.5)).needed, 50);
  });
});
