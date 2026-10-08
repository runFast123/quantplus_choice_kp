// Unit tests for quantitative trade plan and position sizing: npm run test:unit
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  auditStockSentiment,
  calculatePositionSize,
  calculateTradePlan,
  deduplicateChartSignals,
  evaluateSentiment,
  evaluateSignalProgress,
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

describe("evaluateSignalProgress", () => {
  // Entry = 1000, Stop = 950 -> risk = 50. T1 = 1037.5, T2 = 1100, T3 = 1150
  test("detects Target 3 (+3.0R) hit when price reaches T3", () => {
    const res = evaluateSignalProgress(1000, 950, 1155, 78);
    assert.equal(res.targetStatus, "t3_hit");
    assert.equal(res.statusLabel, "T3 (+3.0R)");
    assert.equal(res.statusTone, "gain");
    assert.equal(res.progressR, 3.1);
    assert.equal(res.sentiment?.node, 2);
  });

  test("detects Target 2 (+2.0R) hit when price is between T2 and T3", () => {
    const res = evaluateSignalProgress(1000, 950, 1105, 68);
    assert.equal(res.targetStatus, "t2_hit");
    assert.equal(res.statusLabel, "T2 (+2.0R)");
    assert.equal(res.statusTone, "gain");
    assert.equal(res.progressR, 2.1);
    assert.equal(res.sentiment?.zone, "momentum");
  });

  test("detects Target 1 (+0.75R) de-risking milestone hit", () => {
    const res = evaluateSignalProgress(1000, 950, 1040, 55);
    assert.equal(res.targetStatus, "t1_hit");
    assert.equal(res.statusLabel, "T1 (+0.75R)");
    assert.equal(res.statusTone, "gain");
    assert.equal(res.progressR, 0.8);
  });

  test("detects stop loss breach when price falls to or below stop", () => {
    const res = evaluateSignalProgress(1000, 950, 945, 28);
    assert.equal(res.targetStatus, "stop_breached");
    assert.equal(res.statusLabel, "Stop Breached");
    assert.equal(res.statusTone, "loss");
    assert.equal(res.sentiment?.zone, "oversold");
  });

  test("tracks in-progress signal before targets or stop are hit", () => {
    const res = evaluateSignalProgress(1000, 950, 1020, 52);
    assert.equal(res.targetStatus, "in_progress");
    assert.equal(res.statusLabel, "+0.4R");
    assert.equal(res.statusTone, "neutral");
  });

  test("handles missing or invalid prices safely", () => {
    const resNullPrice = evaluateSignalProgress(1000, 950, null, 50);
    assert.equal(resNullPrice.targetStatus, "in_progress");
    assert.equal(resNullPrice.statusLabel, "Awaiting close");

    const resInvalidStop = evaluateSignalProgress(1000, 1050, 1020, 50);
    assert.equal(resInvalidStop.targetStatus, "invalid");
    assert.equal(resInvalidStop.statusLabel, "Invalid Stop");
  });
});

describe("auditStockSentiment", () => {
  test("audits stock in Sentiment Peak (Node 3) with scale-out guidance", () => {
    const res = auditStockSentiment({
      symbol: "TCS",
      entryBase: 3800,
      lastPrice: 4200,
      rsi: 82.5,
    });

    assert.equal(res.symbol, "TCS");
    assert.equal(res.pnlPct, 10.53);
    assert.equal(res.sentiment?.zone, "sentiment_peak");
    assert.equal(res.sentiment?.node, 3);
    assert.ok(res.actionGuidance.includes("Extreme overbought exhaustion"));
    assert.equal(res.plan.isValid, true);
  });

  test("audits stock in Momentum Expansion (Node 1)", () => {
    const res = auditStockSentiment({
      symbol: "INFY",
      entryBase: 1800,
      lastPrice: 1890,
      rsi: 64,
    });

    assert.equal(res.sentiment?.zone, "momentum");
    assert.equal(res.sentiment?.node, 1);
    assert.ok(res.actionGuidance.includes("Healthy upward trend expansion"));
  });

  test("audits stock in Oversold Accumulation (Node 0)", () => {
    const res = auditStockSentiment({
      symbol: "RELIANCE",
      entryBase: 1300,
      lastPrice: 1210,
      rsi: 28,
    });

    assert.equal(res.sentiment?.zone, "oversold");
    assert.equal(res.sentiment?.node, 0);
    assert.ok(res.actionGuidance.includes("Oversold accumulation"));
  });
});

describe("deduplicateChartSignals", () => {
  test("merges multiple signals on the same day", () => {
    const raw = [
      { ts: "2026-03-10T09:15:00Z", kind: "buy" as const, label: "MA", price: 100 },
      { ts: "2026-03-10T14:30:00Z", kind: "buy" as const, label: "RSI", price: 100 },
    ];
    const res = deduplicateChartSignals(raw, "all");
    assert.equal(res.length, 1);
    assert.equal(res[0].label, "MA + RSI");
  });

  test("suppresses consecutive same-direction signals in clean mode", () => {
    const raw = [
      { ts: "2026-03-01T09:15:00Z", kind: "exit" as const, label: "RSI", price: 200 },
      { ts: "2026-03-02T09:15:00Z", kind: "exit" as const, label: "RSI", price: 202 },
      { ts: "2026-03-03T09:15:00Z", kind: "exit" as const, label: "MA", price: 201 },
      { ts: "2026-03-15T09:15:00Z", kind: "exit" as const, label: "RSI", price: 210 },
    ];
    const clean = deduplicateChartSignals(raw, "clean");
    // Initial exit on Mar 01 and spaced exit on Mar 15 should survive; Mar 02 and Mar 03 suppressed
    assert.equal(clean.length, 2);
    assert.equal(clean[0].ts, "2026-03-01T09:15:00Z");
    assert.equal(clean[1].ts, "2026-03-15T09:15:00Z");
  });

  test("allows alternating buy and exit signals even within close proximity", () => {
    const raw = [
      { ts: "2026-03-01T09:15:00Z", kind: "buy" as const, label: "MA", price: 150 },
      { ts: "2026-03-03T09:15:00Z", kind: "exit" as const, label: "RSI", price: 160 },
      { ts: "2026-03-05T09:15:00Z", kind: "buy" as const, label: "RSI", price: 155 },
    ];
    const clean = deduplicateChartSignals(raw, "clean");
    assert.equal(clean.length, 3);
  });
});



