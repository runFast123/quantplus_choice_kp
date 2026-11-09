import assert from "node:assert/strict";
import { test } from "node:test";
import { price, priceMean, rupees, signed, signedRupees, toPaise } from "./format";

test("an exact half paisa rounds away from zero, as the database does", () => {
  // TCS's 20-day average on 7 Nov 2026 was exactly 2430.025 (SQL); the screen showed 2,430.02.
  assert.equal(price(2430.025), "2,430.03");
  assert.equal(price(1.005), "1.01");
  assert.equal(price(-1.005), "-1.01");
  assert.equal(rupees(1.005), "₹1.01");
  assert.equal(signed(-2.675), "−2.68");
  assert.equal(signedRupees(10.125), "+₹10.13");
});

test("an average of prices is exact, so its half paisa rounds up too", () => {
  const closes = [...Array(19).fill(2430), 2430.5]; // sums to 48600.5, average exactly 2430.025
  assert.equal(priceMean(closes), 2430.025);
  assert.equal(price(priceMean(closes)), "2,430.03");
  assert.equal(priceMean([0.1, 0.2]), 0.15);
});

test("everything else is unchanged", () => {
  assert.equal(price(1234567.891), "12,34,567.89");
  assert.equal(price(0), "0.00");
  assert.equal(price(null), "—");
  assert.equal(rupees(99.994), "₹99.99");
  assert.equal(rupees(1520, { decimals: false }), "₹1,520");
  assert.equal(toPaise(1e-7), 0);
  assert.equal(toPaise(2.5e21), 2.5e21);
});
