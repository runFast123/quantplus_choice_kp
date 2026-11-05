import assert from "node:assert/strict";
import { test } from "node:test";
import { groupSales, heldFor, istToday, ledgerError, type RealizedPart } from "./ledger";

const part = (o: Partial<RealizedPart>): RealizedPart => ({
  sell_txn_id: "s1",
  symbol: "INFY",
  buy_date: "2026-01-05",
  sell_date: "2026-03-05",
  quantity: 10,
  buy_price: 100,
  sell_price: 300,
  cost: 1010,
  proceeds: 2990,
  gain: 1980,
  days_held: 59,
  ...o,
});

test("a sale adds up every purchase it drew from (the database test's numbers)", () => {
  const [s] = groupSales([part({}), part({ buy_date: "2026-02-05", quantity: 5, buy_price: 200, cost: 1000, proceeds: 1495, gain: 495, days_held: 28 })]);
  assert.equal(s.quantity, 15);
  assert.equal(s.cost, 2010);
  assert.equal(s.proceeds, 4485);
  assert.equal(s.gain, 2475);
  assert.equal(s.avgBuyPrice, 133.33);
  assert.equal(s.gainPct, 123.13);
  assert.equal(heldFor(s), "held 28 to 59 days");
});

test("sales come newest first and stay apart", () => {
  const out = groupSales([part({ sell_txn_id: "a", sell_date: "2026-01-01" }), part({ sell_txn_id: "b", sell_date: "2026-05-01" })]);
  assert.deepEqual(out.map((s) => s.sellTxnId), ["b", "a"]);
});

test("a loss stays a loss; same-day and one-day wording", () => {
  const [s] = groupSales([part({ gain: -50, proceeds: 960, cost: 1010, days_held: 0 })]);
  assert.equal(s.gain, -50);
  assert.equal(heldFor(s), "same day");
  assert.equal(heldFor({ longestDays: 1, shortestDays: 1 }), "held 1 day");
});

test("the ledger's errors read as plain words", () => {
  const m = ledgerError("SELL_EXCEEDS_HOLDING: INFY sold 15.0000 on 2026-03-05 but held 10");
  assert.match(m ?? "", /^That would sell 15 INFY on .*2026, but you held 10 then\./);
  assert.equal(ledgerError("TRADE_IN_FUTURE: 2026-12-01 is after today"), "The date is after today.");
  assert.equal(ledgerError("duplicate key value"), null);
});

test("today is India's date, not the server's", () => {
  // 20:00 UTC on 4 Nov is 01:30 on 5 Nov in India
  assert.equal(istToday(Date.parse("2026-11-04T20:00:00Z")), "2026-11-05");
  assert.equal(istToday(Date.parse("2026-11-04T18:00:00Z")), "2026-11-04");
});
