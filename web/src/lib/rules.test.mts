import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { strategyLabel } from "./format";
import { HEALTH_RULES } from "./rule-health";
import { DEFAULT_EXIT_RULES, OLD_RULES, RULES, isOldRule, isRule, ruleOf, ruleTag } from "./rules";
import { ruleSentence } from "./signal-trade";
import { isTrendRule } from "./strong-trend";
import { defaultHorizon } from "./trade-odds";

test("six rules in use, trend rules first (the Signals page lays out any number in whole rows)", () => {
  assert.deepEqual(RULES.map((r) => r.key), ["strong_trend", "sma_trend", "ma200_trend", "secular_trend", "rsi_dip", "kk_dip"]);
  assert.deepEqual(RULES.map((r) => r.kind), ["trend", "trend", "trend", "trend", "dip", "dip"]);
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
  assert.equal(ruleTag("secular_trend"), "SEC");
  assert.equal(ruleTag("something_else"), "Signal");
  assert.equal(ruleOf("nope"), undefined);
  assert.ok(!isRule(null) && !isTrendRule(undefined));
});

test("holders hear from the first three trend rules by default, as notification_prefs does (migration 50)", () => {
  assert.deepEqual([...DEFAULT_EXIT_RULES], ["strong_trend", "sma_trend", "ma200_trend"]);
  const sql = readFileSync(new URL("../../../supabase/migrations/20261001000050_holdings_trust.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("default array['strong_trend', 'sma_trend', 'ma200_trend']"), "table default");
  assert.ok(sql.includes("coalesce(p.exit_rules, array['strong_trend', 'sma_trend', 'ma200_trend'])"), "notifier default");
  const now = readFileSync(new URL("../../../supabase/migrations/20261001000055_secular_trend.sql", import.meta.url), "utf8");
  const allowed = now.match(/check \(exit_rules <@ array\[([^\]]+)\]\)/)?.[1] ?? "";
  for (const r of RULES) assert.ok(allowed.includes(`'${r.key}'`), `${r.key} can be chosen (migration 55)`);
  assert.ok(!DEFAULT_EXIT_RULES.includes("secular_trend"), "Secular trend is chosen, not on by default");
});
