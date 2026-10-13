import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { generateCleanPineScript } from "./pine-script";

describe("generateCleanPineScript", () => {
  test("generates valid Pine Script v5 for default core strategy", () => {
    const code = generateCleanPineScript("RELIANCE", "core");
    assert.ok(code.includes("//@version=5"));
    assert.ok(code.includes('indicator("QuantsPulse Quantitative Signals & Levels (RELIANCE)"'));
    assert.ok(code.includes("ta.sma(close, 20)"));
    assert.ok(code.includes("ta.sma(close, 50)"));
    assert.ok(code.includes("ta.rsi(close, rsiPeriod)"));
    assert.ok(code.includes("QuantsPulse Core (Platform Match)"));
  });

  test("generates valid Pine Script v5 for swing strategy", () => {
    const code = generateCleanPineScript("TCS", "swing");
    assert.ok(code.includes("//@version=5"));
    assert.ok(code.includes('indicator("QuantsPulse Quantitative Signals & Levels (TCS)"'));
    assert.ok(code.includes("Fast Swing (Price vs SMA20)"));
  });

  test("handles empty or generic symbol gracefully", () => {
    const code = generateCleanPineScript("", "core");
    assert.ok(code.includes("//@version=5"));
    assert.ok(code.includes('indicator("QuantsPulse Quantitative Signals & Levels (NSE Equities)"'));
  });
});
