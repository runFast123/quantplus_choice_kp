import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareTrades,
  comparisonCsv,
  reasonOf,
  ruleMatchesBuy,
  sessionsBetween,
  splitFactor,
  windowEnd,
  type BuyLot,
  type LotSale,
  type RuleTrade,
} from "./rule-compare";

// Weekdays of 2026 as trading sessions (holidays don't matter for these tests).
const sessions: string[] = [];
for (let d = new Date("2026-01-01T00:00:00Z"); d.getUTCFullYear() === 2026; d.setUTCDate(d.getUTCDate() + 1)) {
  if (d.getUTCDay() % 6 !== 0) sessions.push(d.toISOString().slice(0, 10));
}

const lot = (o: Partial<BuyLot> = {}): BuyLot => ({
  buy_txn_id: "b1",
  portfolio_id: "p1",
  symbol: "HDFCBANK",
  buy_date: "2026-03-12",
  kind: "buy",
  buy_quantity: 10,
  buy_price: 1100,
  open_quantity: 10,
  open_price: 1100,
  charges: 20,
  ...o,
});
const trade = (o: Partial<RuleTrade> = {}): RuleTrade => ({
  strategy: "sma_trend",
  symbol: "HDFCBANK",
  entry_day: "2026-02-20",
  entry_price: 900,
  exit_day: "2026-05-15",
  exit_price: 1180,
  exit_entry_fill: 900,
  result: "REVIEW_60",
  exit_label: "SMA 20/50 trend: 60-session review",
  ...o,
});
const last = new Map([["HDFCBANK", { price: 1188, day: "2026-11-06" }]]);
const run = (o: { lots?: BuyLot[]; sales?: LotSale[]; trades?: RuleTrade[]; splits?: { symbol: string; ex_date: string; factor: number }[] } = {}) =>
  compareTrades({
    lots: o.lots ?? [lot()],
    sales: o.sales ?? [],
    ruleTrades: o.trades ?? [trade()],
    splits: o.splits ?? [],
    sessions,
    last,
    recordsFrom: "2023-12-07",
  });

test("the owner's example: the rule bought earlier and lower, and its whole trade made more", () => {
  const c = run();
  assert.equal(c.buys.length, 1);
  const m = c.buys[0];
  assert.equal(m.when, "earlier");
  assert.equal(m.sessionsApart, 14);
  assert.equal(m.rulePrice, 900);
  assert.equal(m.paidLessPerShare, 200);
  assert.equal(m.paidLessTotal, 2000); // "You would have paid ₹2,000 less"
  assert.equal(m.ruleReturnPct, 31.11);
  // ₹11,000 × 280/900 = 3,422.22, less ₹20 buy + ₹20 sale charges (you still hold, so a sale charge equal to the buy's)
  assert.equal(m.ruleGain, 3382.22);
  assert.equal(m.yourGain, 860); // 10 × (1,188 − 1,100) − ₹20
  assert.equal(m.madeMore, 2522.22); // "You would have made ₹2,522.22 more"
  assert.equal(m.ruleReason, "60-session review");
  assert.equal(m.yourStatus, "held");
  assert.deepEqual(c.summary.perRule[0], {
    strategy: "sma_trend", ruleName: "SMA 20/50 trend", buys: 1, paidLess: 1, paidMore: 0,
    ruleGain: 3382.22, yourGain: 860, priced: 1, ruleBetter: 1, ruleWorse: 0,
  });
});

test("a rule that lost is shown the same way: it would have made less", () => {
  const m = run({ trades: [trade({ entry_price: 1140, exit_entry_fill: 1140, exit_price: 1060, exit_day: "2026-03-20", result: "STOP_HIT", exit_label: null })] }).buys[0];
  assert.equal(m.paidLessPerShare, -40); // you paid ₹40 less than the rule
  assert.equal(m.ruleReason, "safety stop");
  assert.equal(m.ruleGain, -811.93); // 11,000 × (1060/1140 − 1) − 40
  assert.equal(m.madeMore, -1671.93);
});

test("the matching window: open on your buy day, or bought within the next 10 sessions", () => {
  const end = windowEnd(sessions, "2026-03-12");
  assert.equal(end, "2026-03-26"); // 10 weekdays later
  assert.equal(ruleMatchesBuy(trade({ entry_day: "2026-03-12" }), "2026-03-12", end), "same day");
  assert.equal(ruleMatchesBuy(trade({ entry_day: "2026-03-26" }), "2026-03-12", end), "later");
  assert.equal(ruleMatchesBuy(trade({ entry_day: "2026-03-27" }), "2026-03-12", end), null);
  assert.equal(ruleMatchesBuy(trade({ exit_day: "2026-03-12" }), "2026-03-12", end), null); // sold that day: not open
  assert.equal(ruleMatchesBuy(trade({ exit_day: "2026-03-11" }), "2026-03-12", end), null);
  assert.equal(ruleMatchesBuy(trade({ exit_day: null, exit_price: null }), "2026-03-12", end), "earlier");
  assert.equal(sessionsBetween(sessions, "2026-03-12", "2026-03-26"), 10);
});

test("every rule that matches gets its own card, never only the best one", () => {
  const c = run({ trades: [trade(), trade({ strategy: "ma200_trend", entry_day: "2026-03-16", entry_price: 1120, exit_entry_fill: 1120, exit_day: "2026-06-10", exit_price: 1150, exit_label: null, result: "REVIEW_60" })] });
  assert.deepEqual(c.buys.map((m) => [m.strategy, m.when]).sort(), [["ma200_trend", "later"], ["sma_trend", "earlier"]]);
  assert.equal(c.summary.matchedBuys, 1);
});

test("a split between the two buys is applied to the rule's price", () => {
  // the rule bought at 2,000 before a 1:2 split; you bought after it at 1,100: the rule's price is 1,000 in your shares
  const m = run({ trades: [trade({ entry_price: 2000, exit_entry_fill: 1000, exit_price: 1180 })], splits: [{ symbol: "HDFCBANK", ex_date: "2026-03-01", factor: 2 }] }).buys[0];
  assert.equal(m.rulePrice, 1000);
  assert.equal(m.paidLessTotal, 1000);
  assert.equal(m.ruleReturnPct, 18); // 1,180 / 1,000, both in the exit day's shares
  assert.equal(splitFactor([{ symbol: "X", ex_date: "2026-03-01", factor: 2 }], "X", "2026-02-01", "2026-03-01"), 2);
  assert.equal(splitFactor([{ symbol: "X", ex_date: "2026-03-01", factor: 2 }], "X", "2026-03-01", "2026-04-01"), 1);
});

test("an open rule trade is valued at the last close", () => {
  const m = run({ trades: [trade({ exit_day: null, exit_price: null, exit_entry_fill: null, result: null, exit_label: null })] }).buys[0];
  assert.equal(m.ruleOpen, true);
  assert.equal(m.ruleReturnPct, 32); // 1,188 / 900
  assert.equal(m.ruleGain, 3500); // 11,000 × 0.32 − 20 (no sale yet on either side)
  assert.equal(m.madeMore, 2640);
});

test("a purchase you sold: your gain is the sale's, after charges", () => {
  const sales: LotSale[] = [{ buy_txn_id: "b1", sell_txn_id: "s1", symbol: "HDFCBANK", sell_date: "2026-04-01", quantity: 10, sell_price: 1500, cost: 11020, proceeds: 14980, gain: 3960 }];
  const c = run({ lots: [lot({ open_quantity: 0 })], sales, trades: [trade({ exit_day: "2026-06-02", exit_price: 1650 })] });
  const m = c.buys[0];
  assert.equal(m.yourStatus, "sold");
  assert.equal(m.yourGain, 3960);
  assert.equal(m.ruleGain, 9126.67); // 11,000 × 750/900 − (20 buy + 20 sale)
  // the sale: the rule was holding on 1 Apr and sold on 2 Jun at 1,650
  assert.equal(c.sales.length, 1);
  assert.equal(c.sales[0].madeMore, 1500); // (1,650 − 1,500) × 10: "you would have made ₹1,500 more"
  assert.equal(c.sales[0].ruleSellDate, "2026-06-02");
});

test("opening balances, buys before the records and buys with no rule nearby are counted, not compared", () => {
  const c = run({
    lots: [lot({ buy_txn_id: "o", kind: "opening" }), lot({ buy_txn_id: "old", buy_date: "2023-06-01" }), lot({ buy_txn_id: "far", buy_date: "2026-09-01" })],
  });
  assert.equal(c.buys.length, 0);
  assert.deepEqual(
    [c.summary.openings, c.summary.yourBuys, c.summary.beforeRecords, c.summary.noRule, c.summary.matchedBuys],
    [1, 2, 1, 1, 0],
  );
});

test("a stock with no last price: your side is unknown, so no 'made more' is claimed", () => {
  const c = compareTrades({ lots: [lot()], sales: [], ruleTrades: [trade()], splits: [], sessions, last: new Map(), recordsFrom: null });
  assert.equal(c.buys[0].yourGain, null);
  assert.equal(c.buys[0].madeMore, null);
  assert.equal(c.buys[0].paidLessTotal, 2000);
  assert.equal(c.summary.perRule[0].priced, 0);
});

test("reasons and CSV", () => {
  assert.equal(reasonOf({ exit_label: "KK dip: sold on the bounce", result: "BOUNCE" }), "sold on the bounce");
  assert.equal(reasonOf({ exit_label: null, result: "REVIEW_60" }), "60-session review");
  const csv = comparisonCsv(run());
  const [head, row] = csv.trim().split("\n");
  assert.ok(head.startsWith("type,symbol,rule,your_date"));
  assert.ok(row.startsWith("buy,HDFCBANK,SMA 20/50 trend,2026-03-12,10,1100,2026-02-20,900,2026-05-15,1180,60-session review,false,2000,3382.22,860,2522.22"));
});
