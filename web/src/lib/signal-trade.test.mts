// Unit tests for chart signal actions, trade pairing and explanations: npm run test:unit
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { explainMarker, isWinningExit, signalAction, tradeFor } from "./signal-trade";
import type { RawChartMarker } from "./trade-plan";

const m = (o: Partial<RawChartMarker> & Pick<RawChartMarker, "ts" | "kind">): RawChartMarker => ({ label: "", ...o });

describe("signalAction", () => {
  test("reads the stored action, and labels for older rows", () => {
    assert.equal(signalAction(m({ ts: "2026-01-01", kind: "exit", action: "sell", label: "KK 20d Breakdown Sell" })), "sell");
    assert.equal(signalAction(m({ ts: "2026-01-01", kind: "exit", action: "cover", label: "KK Cover" })), "cover");
    assert.equal(signalAction(m({ ts: "2026-01-01", kind: "buy", label: "SMA Golden Cross" })), "buy");
    assert.equal(signalAction(m({ ts: "2026-01-01", kind: "exit", label: "KK T1 Cover + Time Exit" })), "cover");
    assert.equal(signalAction(m({ ts: "2026-01-01", kind: "exit", label: "SMA Death Cross" })), "exit");
  });

  test("a winning exit is one that made R or hit a target", () => {
    assert.ok(isWinningExit(m({ ts: "x", kind: "exit", realizedR: 0.69 })));
    assert.ok(isWinningExit(m({ ts: "x", kind: "exit", resultType: "TARGET_2_HIT" })));
    assert.ok(!isWinningExit(m({ ts: "x", kind: "exit", realizedR: -1 })));
  });
});

describe("tradeFor", () => {
  const buy = m({ ts: "2026-08-21", kind: "buy", action: "buy", strategy: "kk_breakout", label: "KK 20d Breakout Buy", price: 100, stop: 96, target1: 103, target2: 108 });
  const exit = m({ ts: "2026-08-27", kind: "exit", action: "exit", strategy: "kk_breakout", label: "KK Exit", price: 103 });
  const sma = m({ ts: "2026-08-25", kind: "exit", action: "exit", strategy: "sma_20_50_cross", label: "SMA Death Cross", price: 99 });
  const all = [exit, sma, buy];

  test("an entry pairs with the next exit of the same strategy, with R-labelled targets", () => {
    const t = tradeFor(buy, all)!;
    assert.equal(t.direction, "long");
    assert.equal(t.exit, exit);
    assert.equal(t.stop, 96);
    assert.equal(t.risk, 4);
    assert.deepEqual(t.targets, [{ label: "T1 +0.75R", price: 103 }, { label: "T2 +2R", price: 108 }]);
  });

  test("an exit finds the entry before it; another strategy's exit is ignored", () => {
    assert.equal(tradeFor(exit, all)!.entry, buy);
    assert.equal(tradeFor(sma, all), null);
  });

  test("a short has its stop above entry and targets below", () => {
    const sell = m({ ts: "2026-09-01", kind: "exit", action: "sell", strategy: "kk_breakout", label: "KK 20d Breakdown Sell", price: 200, stop: 208, target1: 194, target2: 184 });
    const t = tradeFor(sell, [sell])!;
    assert.equal(t.direction, "short");
    assert.equal(t.exit, null);
    assert.equal(t.risk, 8);
    assert.deepEqual(t.targets.map((x) => x.label), ["T1 +0.75R", "T2 +2R"]);
  });

  test("a stop on the wrong side of entry is dropped rather than drawn", () => {
    const bad = m({ ts: "2026-09-01", kind: "buy", action: "buy", strategy: "rsi_reversal", price: 100, stop: 104, target1: 110 });
    const t = tradeFor(bad, [bad])!;
    assert.equal(t.stop, null);
    assert.deepEqual(t.targets, [{ label: "Target", price: 110 }]);
  });
});

describe("explainMarker", () => {
  test("says what the rule saw and how a closed trade ended", () => {
    assert.match(explainMarker(m({ ts: "x", kind: "buy", strategy: "rsi_reversal", label: "RSI" })), /climbed back above 30/);
    assert.equal(
      explainMarker(m({ ts: "x", kind: "exit", action: "cover", strategy: "kk_breakout", label: "KK Cover", resultType: "SL_HIT", realizedR: -1 })),
      "The KK short trade closed. The stop was hit. Result −1.00R.",
    );
  });
});
