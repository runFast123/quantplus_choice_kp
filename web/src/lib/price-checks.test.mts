import assert from "node:assert/strict";
import { test } from "node:test";
import { lookedWrong, setAsideSentence, wrongParts, type CandleCheck } from "./price-checks";

const cleanmax: CandleCheck = {
  symbol: "CLEANMAX",
  exchange: "NSE",
  day: "2026-11-06",
  prev_close: 1276.5,
  open: 1021.2,
  high: 1314.7,
  low: 1021.2,
  close: 1259.7,
  bad_open: true,
  bad_high: false,
  bad_low: true,
  status: "suspect",
};

test("the 6 Nov CLEANMAX day: open and low more than 12 % under both closes, high fine", () => {
  assert.deepEqual(lookedWrong(1276.5, cleanmax), { open: true, high: false, low: true });
});

test("a real fall that closes low is not flagged: the day's own close is one of the two closes", () => {
  assert.deepEqual(lookedWrong(100, { open: 85, high: 86, low: 79, close: 80 }), { open: false, high: false, low: false });
});

test("exactly 12 % away is not flagged; just past it is", () => {
  assert.equal(lookedWrong(100, { open: 100, high: 100, low: 88, close: 100 }).low, false);
  assert.equal(lookedWrong(100, { open: 100, high: 112.01, low: 87.99, close: 100 }).low, true);
  assert.equal(lookedWrong(100, { open: 100, high: 112.01, low: 99, close: 100 }).high, true);
});

test("what looked wrong, in words", () => {
  assert.equal(wrongParts(cleanmax), "opening price of ₹1,021.20 and low of ₹1,021.20");
  assert.equal(wrongParts({ ...cleanmax, bad_open: false }), "low of ₹1,021.20");
  assert.equal(wrongParts({ ...cleanmax, bad_high: true }), "opening price of ₹1,021.20, low of ₹1,021.20 and high of ₹1,314.70");
});

test("the stock page sentence says what the rules do", () => {
  assert.equal(
    setAsideSentence(cleanmax),
    "On 06 Nov 2026 Yahoo's opening price of ₹1,021.20 and low of ₹1,021.20 was far from the closes around it " +
      "(₹1,276.50 the day before, ₹1,259.70 that day). Until it is checked, our rules use the close for that day.",
  );
  assert.match(setAsideSentence({ ...cleanmax, status: "bad" }), /We checked it and set it aside: our rules use the close/);
});
