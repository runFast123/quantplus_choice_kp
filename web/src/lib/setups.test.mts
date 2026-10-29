// Unit tests for the daily setup labels: npm run test:unit
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isSetupKey, SETUPS, setupsOf } from "./setups";

describe("daily setups", () => {
  test("tags come back in the canonical order, unknown ones dropped", () => {
    assert.deepEqual(setupsOf(["oversold", "breakout_20d", "made_up"]).map((s) => s.key), ["breakout_20d", "oversold"]);
    assert.deepEqual(setupsOf(null), []);
  });

  test("only the five scanned rules are valid filter values", () => {
    assert.equal(SETUPS.length, 5);
    assert.ok(isSetupKey("bull_flag"));
    assert.ok(!isSetupKey("buy"));
  });

  test("every rule is described as a rule, never as advice", () => {
    for (const s of SETUPS) assert.doesNotMatch(s.rule + s.label, /\b(buy|sell|winner|recommend)/i);
  });
});
