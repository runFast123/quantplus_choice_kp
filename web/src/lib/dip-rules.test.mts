import assert from "node:assert/strict";
import { test } from "node:test";
import { DIP_TESTED, dipStatus, dipTestedSentence, isDipRule } from "./dip-rules";
import { ruleSentence } from "./signal-trade";
import { signalDisplayName, strategyLabel } from "./format";
import { defaultHorizon } from "./trade-odds";

test("dip rules: names, sentences and the odds horizon", () => {
  assert.ok(isDipRule("rsi_dip") && isDipRule("kk_dip") && !isDipRule("rsi_reversal"));
  assert.equal(strategyLabel.rsi_dip, "RSI dip");
  assert.equal(strategyLabel.rsi_reversal, "RSI reversal (old rule)");
  assert.equal(signalDisplayName("kk_dip", "buy"), "KK dip buy");
  assert.match(ruleSentence("rsi_dip", "buy"), /2-day RSI under 10.*200-day average/);
  assert.match(ruleSentence("kk_dip", "buy"), /20-day low/);
  assert.match(ruleSentence("kk_dip", "exit", "BOUNCE"), /sold on the bounce/);
  assert.match(ruleSentence("rsi_dip", "exit", "STOP_HIT"), /safety stop/);
  assert.equal(defaultHorizon("rsi_dip"), 5);
});

test("dip status: below the safety stop only when the last close reaches it", () => {
  assert.equal(dipStatus(95, 94).label, "Below safety stop");
  assert.equal(dipStatus(95, 99).label, "Open");
});

test("tested record: consistent, and the card sentence says it plainly", () => {
  for (const rule of ["rsi_dip", "kk_dip"] as const) {
    const t = DIP_TESTED[rule];
    assert.ok(t.madeMoneyPct > 100 - t.before.wrongPct, `${rule} beats the rule it replaced`);
    assert.ok(t.avgWinPct > 0 && t.avgLossPct < 0);
    assert.match(dipTestedSentence(rule), /in 100 made money after costs/);
    assert.match(dipTestedSentence(rule), /The old rule it replaced/);
  }
  assert.match(dipTestedSentence("rsi_dip"), /3,058 trades.*64 in 100.*\+0\.67%.*38 in 100, −0\.64%/);
});
