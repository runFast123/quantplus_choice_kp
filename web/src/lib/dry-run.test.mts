// Unit tests for the Dry Run math: npm run test:unit
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { badDays, guardrails, replayPlan, sizePlan, tradedValue, type PlanStock, type ReplayPoint } from "./dry-run";
import type { Candle } from "./types";

const stock = (symbol: string, price: number, extra: Partial<PlanStock> = {}): PlanStock => ({
  symbol,
  sector: "Tech",
  segment: "equity",
  price,
  stop: price * 0.95,
  tradedValue: 1e9,
  ...extra,
});

// Daily candles from a list of closes, one per day from 1 Jan 2026.
const candles = (closes: number[], from = 0): Candle[] =>
  closes.map((c, i) => ({ ts: new Date(Date.UTC(2026, 0, 1 + from + i)).toISOString(), open: c, high: c, low: c, close: c, volume: 1000 }));

describe("sizePlan", () => {
  test("splits evenly after the cash, in whole shares, and the rest stays cash", () => {
    const p = sizePlan([stock("A", 1000), stock("B", 333)], 100_000, 10);
    assert.equal(p.rows[0].shares, 45); // 45,000 / 1,000
    assert.equal(p.rows[1].shares, 135); // floor(45,000 / 333)
    assert.equal(p.invested, 45_000 + 135 * 333);
    assert.equal(p.cash, 100_000 - p.invested);
    assert.ok(Math.abs(p.rows[0].lossAtStop! - 45 * 50) < 1e-6);
  });
  test("a stop at or above the price counts as no stop", () => {
    const p = sizePlan([stock("A", 100, { stop: 101 })], 10_000, 0);
    assert.equal(p.rows[0].lossAtStop, null);
    assert.equal(p.lossAtStops, 0);
  });
  test("no picks, no investment", () => {
    const p = sizePlan([], 50_000, 10);
    assert.equal(p.invested, 0);
    assert.equal(p.cash, 50_000);
  });
});

describe("replayPlan", () => {
  test("starts when every stock has a price, carries missing days, and adds the cash", () => {
    const p = sizePlan([stock("A", 100), stock("B", 100)], 10_000, 0); // 50 shares each, 5,000 each
    const r = replayPlan(p, { A: candles([10, 20, 20, 40]), B: candles([50, 50, 100], 1) })!;
    assert.equal(r.start, "2026-01-02"); // B starts a day later
    assert.deepEqual(r.limitedBy, ["B"]);
    assert.equal(r.points.length, 3);
    // A: 5,000 at 20 → ×2 at 40; B: 5,000 at 50 → ×2 at 100.
    assert.equal(r.startValue, 10_000);
    assert.equal(r.endValue, 20_000);
  });
  test("the benchmark gets the same total", () => {
    const p = sizePlan([stock("A", 100)], 10_000, 50);
    const r = replayPlan(p, { A: candles([100, 110]) }, candles([200, 220]))!;
    assert.equal(r.points[0].bench, 10_000);
    assert.equal(r.benchEnd, 11_000);
    assert.equal(r.endValue, 5_000 * 1.1 + 5_000); // half stays cash
  });
  test("nothing to replay without candles", () => {
    assert.equal(replayPlan(sizePlan([stock("A", 100)], 10_000, 0), {}), null);
  });
});

describe("badDays", () => {
  const pts = (values: number[]): ReplayPoint[] => values.map((value, i) => ({ ts: `2026-01-${String(i + 1).padStart(2, "0")}`, value, bench: null }));
  test("finds the worst day, the worst five sessions and the deepest fall with its recovery", () => {
    const b = badDays(pts([100, 110, 90, 95, 80, 85, 100, 111, 112]));
    assert.equal(b.worstDay!.change, -20); // 110 → 90
    assert.equal(b.worstWeek!.change, -15); // 100 → 85, five sessions apart
    assert.equal(b.biggestFall!.change, -30); // 110 → 80
    assert.equal(b.biggestFall!.recoveredOn, "2026-01-08"); // back to 110+
    assert.equal(b.biggestFall!.sessionsToRecover, 3);
  });
  test("a fall not yet recovered says so; a rising line has no falls", () => {
    assert.equal(badDays(pts([100, 80, 90])).biggestFall!.recoveredOn, null);
    const up = badDays(pts([1, 2, 3, 4, 5, 6, 7]));
    assert.equal(up.worstDay, null);
    assert.equal(up.biggestFall, null);
  });
});

describe("guardrails", () => {
  const passed = (stocks: PlanStock[], total = 100_000, cash = 10) =>
    Object.fromEntries(guardrails(sizePlan(stocks, total, cash)).map((g) => [g.key, g.pass]));
  test("a spread plan with stops passes all seven", () => {
    const five = ["IT", "Bank", "Energy", "IT", "Pharma"].map((sector, i) => stock(`S${i}`, 100, { sector }));
    assert.deepEqual(Object.values(passed(five)), [true, true, true, true, true, true, true]);
  });
  test("each guardrail catches its own problem", () => {
    const g = passed([stock("A", 100, { stop: null, segment: "sme", tradedValue: 1e6 })], 100_000, 0);
    assert.equal(g.one_stock, false); // 100% in one stock
    assert.equal(g.sectors, false);
    assert.equal(g.stops, false);
    assert.equal(g.risk, false);
    assert.equal(g.liquid, false);
    assert.equal(g.main_board, false);
    assert.equal(g.cash, false);
  });
  test("wide stops fail the 5% loss check", () => {
    const wide = ["IT", "Bank", "Energy", "Auto", "Pharma"].map((sector, i) => stock(`S${i}`, 100, { sector, stop: 80 }));
    assert.equal(passed(wide).risk, false); // 20% below on 90% invested = 18%
  });
});

test("tradedValue averages close × volume", () => {
  assert.equal(tradedValue(candles([10, 20])), 15_000);
  assert.equal(tradedValue([]), null);
});
