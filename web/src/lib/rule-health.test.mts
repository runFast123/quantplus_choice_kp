import assert from "node:assert/strict";
import { test } from "node:test";
import { HEALTH_STATUS, healthSentence, isHealthRule, mainCause, mistakeSentence, pos, type HealthRow } from "./rule-health";

const row = (o: Partial<HealthRow>): HealthRow => ({
  strategy: "sma_trend",
  day: "2026-11-02",
  trades: 40,
  made: 7,
  made_pct: 17.5,
  expected_pct: 52,
  low_pct: 39,
  high_pct: 65,
  avg_pct: -9.63,
  status: "below",
  causes: { market: 26, stock: 6, small: 1 },
  first_exit: "2026-09-16",
  last_exit: "2026-10-30",
  ...o,
});

test("rule health: the four rules, words for every status, never advice", () => {
  assert.ok(isHealthRule("kk_dip") && isHealthRule("strong_trend") && !isHealthRule("rsi_reversal"));
  assert.deepEqual(Object.keys(HEALTH_STATUS).sort(), ["above", "below", "too_few", "within"]);
  assert.match(HEALTH_STATUS.below.title, /not changed or switched off automatically/);
  assert.match(HEALTH_STATUS.above.title, /not a reason to expect more/);
});

test("rule health: the sentence gives the record, the tested rate and the normal range", () => {
  assert.equal(
    healthSentence(row({})),
    "7 of its last 40 finished trades made money (18 in 100). In testing 52 in 100; with 40 trades, anything from 39 to 65 is normal.",
  );
  assert.match(healthSentence(row({ status: "too_few", trades: 10, made: 6, made_pct: 60 })), /Too few to judge yet; in testing it made money 52 times in 100\./);
  assert.equal(healthSentence(row({ trades: 0, made: 0, made_pct: null })), "No finished trades yet.");
});

test("mistake review: the biggest cause, in plain words", () => {
  assert.deepEqual(mainCause(row({})), { cause: "market", n: 26, of: 33 });
  assert.equal(mistakeSentence(row({})), "Most of its 33 losing trades (26) came when the whole market fell.");
  assert.equal(mistakeSentence(row({ causes: { market: 0, stock: 6, small: 4 } })), "Most of its 10 losing trades (6) were the stock falling on its own.");
  assert.equal(mistakeSentence(row({ causes: { market: 3, stock: 2, small: 4 } })), "The largest group of its 9 losing trades (4) were small losses (costs and noise).");
  assert.equal(mistakeSentence(row({ causes: {} })), "No losing trades in this stretch.");
  assert.equal(pos(140), 100);
  assert.equal(pos(null), 0);
});
