// Unit tests for the Behaviour mirror: npm run test:unit
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AFTER_SESSIONS, at, median, mirror, sentences, type Close, type MirrorInput } from "./behaviour-mirror";
import type { BuyLot, LotSale } from "./rule-compare";

// Trading days from 2025-01-01, weekdays only.
function sessions(n: number): string[] {
  const out: string[] = [];
  for (let d = Date.parse("2025-01-01"); out.length < n; d += 86_400_000) {
    const wd = new Date(d).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(new Date(d).toISOString().slice(0, 10));
  }
  return out;
}
const DAYS = sessions(200);
const flat = (price: number): Close[] => DAYS.map((day) => ({ day, close: price }));

let id = 0;
function lot(symbol: string, buyDay: string, price: number, qty = 10, kind: BuyLot["kind"] = "buy", open = 0): BuyLot {
  return {
    buy_txn_id: `b${++id}`,
    portfolio_id: "p",
    symbol,
    buy_date: buyDay,
    kind,
    buy_quantity: qty,
    buy_price: price,
    open_quantity: open,
    open_price: price,
    charges: 0,
  };
}
function sale(l: BuyLot, sellDay: string, price: number, qty = l.buy_quantity): LotSale {
  const cost = qty * l.buy_price;
  const proceeds = qty * price;
  return { buy_txn_id: l.buy_txn_id, sell_txn_id: `s${++id}`, symbol: l.symbol, sell_date: sellDay, quantity: qty, sell_price: price, cost, proceeds, gain: proceeds - cost };
}
const base = (over: Partial<MirrorInput>): MirrorInput => ({
  lots: [],
  sales: [],
  splits: [],
  closes: new Map(),
  last: new Map(),
  today: DAYS[DAYS.length - 1],
  ...over,
});

describe("helpers", () => {
  test("median of odd and even lists", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([]), null);
  });
  test("at finds the first session on or after a day", () => {
    const cs = flat(1);
    assert.equal(at(cs, DAYS[5]), 5);
    assert.equal(at(cs, "2025-01-04"), at(cs, "2025-01-06")); // a Saturday maps to Monday
  });
});

describe("holding time", () => {
  test("losers held longer than winners reads as a multiple", () => {
    const lots = Array.from({ length: 6 }, (_, i) => lot(`S${i}`, DAYS[0], 100));
    const sales = [
      ...lots.slice(0, 3).map((l) => sale(l, DAYS[10], 120)), // winners: 14 calendar days
      ...lots.slice(3).map((l) => sale(l, DAYS[40], 80)), // losers: 56 calendar days
    ];
    const m = mirror(base({ lots, sales }));
    assert.equal(m.holding.winners, 3);
    assert.equal(m.holding.losers, 3);
    assert.equal(m.holding.winDays, 14);
    assert.equal(m.holding.lossDays, 56);
    assert.match(sentences(m).holding!, /about 4\.0 times as long/);
  });
  test("opening balances are left out, and too few trades say nothing", () => {
    const opening = lot("OPEN", DAYS[0], 100, 10, "opening");
    const m = mirror(base({ lots: [opening], sales: [sale(opening, DAYS[5], 200)] }));
    assert.equal(m.holding.trades, 0);
    assert.equal(sentences(m).holding, null);
  });
});

describe("after the sale", () => {
  test("measures 60 sessions after each sale, in today's shares", () => {
    const closes = new Map<string, Close[]>();
    const lots: BuyLot[] = [];
    const sales: LotSale[] = [];
    for (let i = 0; i < 5; i++) {
      const sym = `A${i}`;
      // the stock trades at 100 until session 60, then 130 (a sale on session 5 is measured on session 65)
      closes.set(sym, DAYS.map((day, k) => ({ day, close: k < 60 ? 100 : 130 })));
      const l = lot(sym, DAYS[0], 90);
      lots.push(l);
      sales.push(sale(l, DAYS[5], 100));
    }
    const m = mirror(base({ lots, sales, closes }));
    assert.equal(m.after.counted, 5);
    assert.equal(m.after.rose, 5);
    assert.ok(Math.abs(m.after.medianPct! - 0.3) < 1e-9);
    assert.ok(Math.abs(m.after.rupees - 5 * 30 * 10) < 1e-6);
    assert.match(sentences(m).after!, /In 5 the stock went on to rise 10% or more/);
  });
  test("a split after the sale is put in today's shares", () => {
    const closes = new Map([["SPL", flat(50)]]);
    const l = lot("SPL", DAYS[0], 90);
    const m = mirror(
      base({ lots: [l], sales: [sale(l, DAYS[5], 100)], closes, splits: [{ symbol: "SPL", ex_date: DAYS[20], factor: 2 }] }),
    );
    // sold at 100 = 50 in today's shares; still 50 sixty sessions later
    assert.equal(m.after.counted, 1);
    assert.ok(Math.abs(m.after.rupees) < 1e-9);
  });
  test("a sale without 60 later sessions is not counted", () => {
    const closes = new Map([["LATE", flat(100)]]);
    const l = lot("LATE", DAYS[0], 90);
    const m = mirror(base({ lots: [l], sales: [sale(l, DAYS[DAYS.length - AFTER_SESSIONS + 1], 100)], closes }));
    assert.equal(m.after.counted, 0);
  });
});

describe("buying after a run-up", () => {
  test("splits purchases by the 20-session rise before them", () => {
    const closes = new Map<string, Close[]>();
    const lots: BuyLot[] = [];
    const sales: LotSale[] = [];
    for (let i = 0; i < 6; i++) {
      const sym = `R${i}`;
      const runUp = i < 3;
      // 100 until session 30; the run-up stocks are at 120 from session 30, the others stay at 100
      closes.set(sym, DAYS.map((day, k) => ({ day, close: runUp && k >= 30 ? 120 : 100 })));
      const l = lot(sym, DAYS[40], runUp ? 120 : 100);
      lots.push(l);
      sales.push(sale(l, DAYS[60], runUp ? 108 : 105)); // −10 % against +5 %
    }
    const m = mirror(base({ lots, sales, closes }));
    assert.equal(m.runUp.counted, 6);
    assert.equal(m.runUp.after, 3);
    assert.ok(Math.abs(m.runUp.afterMedian! + 0.1) < 1e-9);
    assert.ok(Math.abs(m.runUp.otherMedian! - 0.05) < 1e-9);
    assert.match(sentences(m).runUp!, /3 of your 6 purchases came after the stock had risen 10% or more/);
  });
});

describe("size of wins and losses", () => {
  test("average win, average loss and the three largest losses' share", () => {
    const lots = Array.from({ length: 7 }, (_, i) => lot(`Z${i}`, DAYS[0], 100));
    const prices = [130, 120, 110, 110, 90, 80, 70]; // gains 300, 200, 100, 100; losses −100, −200, −300
    const sales = lots.map((l, i) => sale(l, DAYS[10], prices[i]));
    const m = mirror(base({ lots, sales }));
    assert.ok(Math.abs(m.size.avgWin! - 0.175) < 1e-9);
    assert.ok(Math.abs(m.size.avgLoss! + 0.2) < 1e-9);
    assert.ok(Math.abs(m.size.bigLossShare! - 600 / 700) < 1e-9);
    assert.equal(sentences(m).size, "Your average win was +18% and your average loss −20%. Your three largest losses took back 86% of everything your winning trades made.");
  });
  test("no sentence claims what to do next", () => {
    const lots = Array.from({ length: 7 }, (_, i) => lot(`Y${i}`, DAYS[0], 100));
    const m = mirror(base({ lots, sales: lots.map((l, i) => sale(l, DAYS[10 + i * 5], i % 2 ? 80 : 120)) }));
    for (const s of Object.values(sentences(m))) if (s) assert.doesNotMatch(s, /\b(should|must|buy now|sell now|recommend)\b/i);
  });
});
