// Unit tests for quantitative trade plan and position sizing: npm run test:unit
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  calculatePositionSize,
  calculateTradePlan,
  evaluateSentiment,
} from "./trade-plan";

describe("calculateTradePlan", () => {
  test("calculates asymmetric 0.75R, 2.0R, 3.0R multiples correctly", () => {
    const res = calculateTradePlan({ entry: 1000, stop: 950 });
    assert.equal(res.isValid, true);
    assert.equal(res.riskPerShare, 50);
    assert.equal(res.riskPercent, 5);
    assert.equal(res.t1, 1037.5); // 1000 + 0.75 * 50
    assert.equal(res.t2, 1100); // 1000 + 2.0 * 50
    assert.equal(res.t3, 1150); // 1000 + 3.0 * 50
  });

  test("handles fractional decimals without floating point drift", () => {
    const res = calculateTradePlan({ entry: 254.35, stop: 242.15 });
    assert.equal(res.isValid, true);
    // 254.35 - 242.15 = 12.20
    assert.equal(Number(res.riskPerShare.toFixed(2)), 12.2);
    assert.equal(res.t1, Number((254.35 + 0.75 * 12.2).toFixed(2)));
    assert.equal(res.t2, Number((254.35 + 2.0 * 12.2).toFixed(2)));
    assert.equal(res.t3, Number((254.35 + 3.0 * 12.2).toFixed(2)));
  });

  test("rejects invalid stop loss (stop >= entry)", () => {
    const resEqual = calculateTradePlan({ entry: 500, stop: 500 });
    assert.equal(resEqual.isValid, false);

    const resHigher = calculateTradePlan({ entry: 500, stop: 550 });
    assert.equal(resHigher.isValid, false);
  });

  test("rejects non-positive entry or stop values", () => {
    const resZeroEntry = calculateTradePlan({ entry: 0, stop: 10 });
    assert.equal(resZeroEntry.isValid, false);

    const resNegativeStop = calculateTradePlan({ entry: 100, stop: -10 });
    assert.equal(resNegativeStop.isValid, false);
  });
});

describe("calculatePositionSize", () => {
  test("computes standard fixed-fractional sizing when capital is sufficient", () => {
    const res = calculatePositionSize({
      capital: 100000,
      riskPct: 1.0, // 1,000 risk budget
      entry: 500,
      stop: 475, // 25 risk per share -> 40 units
    });

    assert.equal(res.units, 40);
    assert.equal(res.exposure, 20000);
    assert.equal(res.exposurePct, 20);
    assert.equal(res.maxLoss, 1000);
    assert.equal(res.isCappedByCash, false);
    assert.equal(res.gainT1, 40 * (500 + 0.75 * 25 - 500)); // 40 * 18.75 = 750
    assert.equal(res.gainT2, 40 * 50); // 2000
    assert.equal(res.gainT3, 40 * 75); // 3000
  });

  test("enforces capital ceiling on ultra-tight stops (fixes Issue #6 overleveraging)", () => {
    // With 0.20 stop risk, raw units would be 1000 / 0.20 = 5,000 shares (500,000 exposure = 5x capital!)
    const res = calculatePositionSize({
      capital: 100000,
      riskPct: 1.0,
      entry: 100,
      stop: 99.8,
    });

    // Cash ceiling: 100,000 / 100 = 1,000 shares max
    assert.equal(res.units, 1000);
    assert.equal(res.exposure, 100000);
    assert.equal(res.exposurePct, 100);
    assert.equal(res.isCappedByCash, true);
    // Realized loss is capped safely below budget (1000 * 0.2 = 200)
    assert.ok(res.maxLoss <= res.riskBudget);
  });

  test("returns zero units safely for invalid inputs", () => {
    const resZeroCapital = calculatePositionSize({
      capital: 0,
      riskPct: 1.0,
      entry: 100,
      stop: 90,
    });
    assert.equal(resZeroCapital.units, 0);
    assert.equal(resZeroCapital.exposure, 0);

    const resInvertedStop = calculatePositionSize({
      capital: 50000,
      riskPct: 1.0,
      entry: 100,
      stop: 110,
    });
    assert.equal(resInvertedStop.units, 0);
  });
});

describe("evaluateSentiment", () => {
  test("identifies Sentiment Peak exhaustion for RSI >= 80", () => {
    const res = evaluateSentiment(84.2);
    assert.ok(res);
    assert.equal(res?.zone, "sentiment_peak");
    assert.equal(res?.node, 3);
    assert.equal(res?.tone, "loss");
  });

  test("identifies Overbought Zone for RSI in 70-79", () => {
    const res = evaluateSentiment(73.5);
    assert.ok(res);
    assert.equal(res?.zone, "overbought");
    assert.equal(res?.node, 2);
    assert.equal(res?.tone, "loss");
  });

  test("identifies Momentum Expansion for RSI in 60-69", () => {
    const res = evaluateSentiment(64.1);
    assert.ok(res);
    assert.equal(res?.zone, "momentum");
    assert.equal(res?.node, 1);
    assert.equal(res?.tone, "gain");
  });

  test("identifies Oversold Accumulation for RSI <= 30", () => {
    const res = evaluateSentiment(27.8);
    assert.ok(res);
    assert.equal(res?.zone, "oversold");
    assert.equal(res?.node, 0);
    assert.equal(res?.tone, "gain");
  });

  test("identifies Equilibrium for RSI in 31-59", () => {
    const res = evaluateSentiment(51.3);
    assert.ok(res);
    assert.equal(res?.zone, "equilibrium");
    assert.equal(res?.node, 0);
    assert.equal(res?.tone, "neutral");
  });

  test("returns null safely for null or undefined RSI", () => {
    assert.equal(evaluateSentiment(null), null);
    assert.equal(evaluateSentiment(undefined), null);
    assert.equal(evaluateSentiment(Number.NaN), null);
  });
});
