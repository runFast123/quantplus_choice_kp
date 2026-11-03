import assert from "node:assert/strict";
import { test } from "node:test";
import { strategyLabel } from "./format";
import { HEALTH_RULES } from "./rule-health";
import { OLD_RULES, RULES, isOldRule, isRule, ruleOf, ruleTag } from "./rules";
import { ruleSentence } from "./signal-trade";
import { isTrendRule } from "./strong-trend";
import { defaultHorizon } from "./trade-odds";

test("five rules in use, trend rules first, an odd number for the layout", () => {
  assert.deepEqual(RULES.map((r) => r.key), ["strong_trend", "sma_trend", "ma200_trend", "rsi_dip", "kk_dip"]);
  assert.deepEqual(RULES.map((r) => r.kind), ["trend", "trend", "trend", "dip", "dip"]);
  assert.equal(RULES.length % 2, 1);
});

test("every page reads the same list: names, health, the trend plan, the odds panel and a sentence for each rule", () => {
  for (const r of RULES) {
    assert.equal(strategyLabel[r.key], r.name, r.key);
    assert.ok(ruleSentence(r.key, "buy").length > 20, r.key);
    assert.equal(isTrendRule(r.key), r.kind === "trend", r.key);
    assert.equal(defaultHorizon(r.key), r.kind === "trend" ? 20 : 5, r.key);
  }
  assert.deepEqual([...HEALTH_RULES], RULES.map((r) => r.key));
});

test("old rules are history with their own tags; unknown keys never pass as a rule", () => {
  for (const o of OLD_RULES) {
    assert.ok(isOldRule(o.key) && !isRule(o.key) && !isTrendRule(o.key));
    assert.match(strategyLabel[o.key], /\(old rule\)/);
    assert.match(ruleTag(o.key), /·old$/);
  }
  assert.equal(ruleTag("ma200_trend"), "200D");
  assert.equal(ruleTag("something_else"), "Signal");
  assert.equal(ruleOf("nope"), undefined);
  assert.ok(!isRule(null) && !isTrendRule(undefined));
});
