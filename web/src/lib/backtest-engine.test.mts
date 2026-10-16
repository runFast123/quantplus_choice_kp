// Unit tests for backtest engine: npm run test:unit
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  generateBacktestPineScript,
  simulateCustomStrategy,
  simulateSip,
  simulateTechnicalStrategy,
} from "./backtest-engine";
import type { Candle } from "./types";

function createMockCandles(count: number, startPrice = 100, trend = 0.5): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  const baseDate = new Date("2024-01-01T00:00:00Z");

  for (let i = 0; i < count; i++) {
    const d = new Date(baseDate.getTime() + i * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    price += (Math.sin(i / 5) * 2) + trend;
    candles.push({
      ts: dateStr,
      open: price,
      high: price + 1,
      low: price - 1,
      close: Number(price.toFixed(2)),
      volume: 100000,
    });
  }
  return candles;
}

describe("simulateSip", () => {
  test("computes monthly SIP accumulation and ROI", () => {
    // 365 days of candles
    const candles = createMockCandles(365, 100, 0.2);
    const res = simulateSip(candles, 10000);

    assert.ok(res);
    assert.equal(res.totalInvested, res.durationMonths * 10000);
    assert.ok(res.finalValue > 0);
    assert.ok(res.totalUnits > 0);
    assert.ok(res.entries.length >= 12);
    assert.equal(typeof res.roiPct, "number");
    assert.equal(typeof res.lumpSumRoiPct, "number");
  });

  test("handles short or empty candle series safely", () => {
    assert.equal(simulateSip([], 10000), null);
    assert.equal(simulateSip(createMockCandles(10), 10000), null);
    assert.equal(simulateSip(createMockCandles(100), 0), null);
  });
});

describe("simulateTechnicalStrategy", () => {
  test("simulates SMA cross strategy over historical candles", () => {
    const candles = createMockCandles(200, 100, 0.3);
    const res = simulateTechnicalStrategy(candles, "sma_cross");

    assert.ok(res);
    assert.equal(typeof res.totalTrades, "number");
    assert.equal(typeof res.winRatePct, "number");
    assert.equal(typeof res.profitFactor, "number");
    assert.equal(typeof res.maxDrawdownPct, "number");
  });

  test("returns null for insufficient candle length", () => {
    const shortCandles = createMockCandles(30);
    assert.equal(simulateTechnicalStrategy(shortCandles), null);
  });
});

describe("simulateCustomStrategy", () => {
  test("simulates customized SMA cross with stop loss and equity curve", () => {
    const candles = createMockCandles(250, 100, 0.4);
    const res = simulateCustomStrategy(candles, {
      type: "sma_cross",
      fastMa: 10,
      slowMa: 30,
      stopLossPct: 3.5,
      takeProfitPct: 8.0,
      initialCapital: 100000,
    });

    assert.ok(res);
    assert.equal(typeof res.totalTrades, "number");
    assert.equal(typeof res.winRatePct, "number");
    assert.equal(typeof res.totalReturnPct, "number");
    assert.equal(typeof res.benchmarkReturnPct, "number");
    assert.equal(typeof res.alphaPct, "number");
    assert.ok(res.equityCurve.length > 0);
    assert.ok(res.finalCapital > 0);
  });

  test("simulates RSI mean reversion strategy", () => {
    const candles = createMockCandles(200, 100, 0.2);
    const res = simulateCustomStrategy(candles, {
      type: "rsi_reversal",
      rsiPeriod: 14,
      rsiOversold: 35,
      rsiOverbought: 65,
      stopLossPct: 5.0,
    });

    assert.ok(res);
    assert.equal(typeof res.winRatePct, "number");
    assert.ok(res.equityCurve.length > 0);
  });

  test("generates valid Pine Script v5 strategy for each mode", () => {
    const smaScript = generateBacktestPineScript({ type: "sma_cross", fastMa: 9, slowMa: 21 }, "TCS");
    assert.ok(smaScript.includes("//@version=5"));
    assert.ok(smaScript.includes('strategy("QuantsPulse MA Cross: TCS"'));

    const rsiScript = generateBacktestPineScript({ type: "rsi_reversal", rsiPeriod: 14 }, "INFY");
    assert.ok(rsiScript.includes("ta.rsi"));
    assert.ok(rsiScript.includes('strategy("QuantsPulse RSI Mean Reversion: INFY"'));

    const boScript = generateBacktestPineScript({ type: "breakout", breakoutPeriod: 20 }, "RELIANCE");
    assert.ok(boScript.includes("ta.highest"));
    assert.ok(boScript.includes('strategy("QuantsPulse Donchian Breakout: RELIANCE"'));
  });
});

