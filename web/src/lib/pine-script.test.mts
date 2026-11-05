import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { PINE_RULES, pineRuleForChart, pineScript } from "./pine-script";

describe("pineScript: one TradingView script per rule", () => {
  test("every rule makes a v6 indicator named after that rule and the stock", () => {
    for (const r of PINE_RULES) {
      const code = pineScript(r.key, "reliance");
      assert.ok(code.startsWith("//@version=6"));
      assert.ok(code.includes(`indicator("QuantsPulse ${r.label} (RELIANCE)"`), r.key);
      assert.ok(code.includes(`alertcondition(buyNow, "QuantsPulse ${r.label}: buy"`), r.key);
    }
  });

  test("a script holds its own rule and none of the others", () => {
    const kk = pineScript("kk_dip");
    assert.ok(kk.includes("low <= 0.99 * lo20"));
    assert.ok(!kk.includes("rsi2 < 10") && !kk.includes("ta.crossover") && !kk.includes("INDIAVIX") && !kk.includes("linreg"));
    const rsi = pineScript("rsi_dip");
    assert.ok(rsi.includes("rsi2 < 10") && !rsi.includes("low <= 0.99 * lo20"));
    const sma = pineScript("sma_trend");
    assert.ok(sma.includes("ta.crossover(sma20, sma50)") && sma.includes("leaderGap") && !sma.includes("INDIAVIX"));
    const st = pineScript("strong_trend");
    assert.ok(st.includes("volume >= 2 * vol50") && st.includes("INDIAVIX") && !st.includes("ta.crossover"));
    const ma = pineScript("ma200_trend");
    assert.ok(ma.includes("ta.linreg(sma200, 100, 0)") && ma.includes("slopePct >= -0.25") && ma.includes("rr >= 0.5"));
    assert.ok(!ma.includes("ta.crossover") && !ma.includes("INDIAVIX"));
  });

  test("the plans match the live rules", () => {
    for (const k of ["sma_trend", "strong_trend", "ma200_trend"] as const) {
      const c = pineScript(k);
      assert.ok(c.includes("math.round(close - 4 * atr, 2)") && c.includes("held >= 60") && c.includes("ta.sma(ta.tr(true), 14)"), k);
    }
    for (const k of ["kk_dip", "rsi_dip"] as const) {
      const c = pineScript(k);
      assert.ok(c.includes("low <= limPx * 0.998") && c.includes("math.round(entryPx - 5 * sigAtr, 2)") && c.includes("held >= 10"), k);
      assert.ok(c.includes("close > sma5") && c.includes("close > sma200"), k);
    }
  });

  test("the chart's rule filter picks the script; all / none ask", () => {
    assert.equal(pineRuleForChart("kk_breakout"), "kk_dip");
    assert.equal(pineRuleForChart("sma_cross"), "sma_trend");
    assert.equal(pineRuleForChart("rsi_reversal"), "rsi_dip");
    assert.equal(pineRuleForChart("strong_trend"), "strong_trend");
    assert.equal(pineRuleForChart("ma200_trend"), "ma200_trend");
    assert.equal(pineRuleForChart("all"), null);
    assert.equal(pineRuleForChart("none"), null);
  });

  test("an empty symbol still makes a script", () => {
    assert.ok(pineScript("kk_dip", "").includes('indicator("QuantsPulse KK dip (NSE stock)"'));
  });
});
