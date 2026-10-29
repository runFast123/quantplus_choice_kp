// Unit tests for the Chrome extension's signal mapping and CORS policy: npm run test:unit
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { extensionCors, isExtensionOrigin } from "./extension-cors";
import { toExtensionSignal } from "./extension-signals";

const at = "2026-08-24T10:00:00+00:00";

describe("toExtensionSignal", () => {
  test("a KK breakdown stored as signal_type exit is a short entry, with its stop", () => {
    const s = toExtensionSignal({
      strategy: "kk_breakout", signal_type: "exit", generated_at: at,
      payload: { action: "sell", label: "KK 20d Breakdown Sell", entry: 512.3, close: 512.3, stop: 530.1 },
    });
    assert.equal(s.kind, "sell");
    assert.equal(s.label, "KK 20d Breakdown Sell");
    assert.equal(s.price, 512.3);
    assert.equal(s.stop, 530.1);
  });

  test("a KK cover is not an exit of a long, and carries no stop", () => {
    const s = toExtensionSignal({
      strategy: "kk_breakout", signal_type: "exit", generated_at: at,
      payload: { action: "cover", label: "KK T1 Cover + Time Exit", close: 516.4, exit_price: 516.4, stop: 530.1 },
    });
    assert.equal(s.kind, "cover");
    assert.equal(s.price, 516.4);
    assert.equal(s.stop, null);
  });

  test("rule signals without an action fall back to signal_type and the strategy's name", () => {
    const buy = toExtensionSignal({
      strategy: "sma_20_50_cross", signal_type: "buy", generated_at: at,
      payload: { close: 292.45, stop: 271.98, target: 327.54 },
    });
    assert.deepEqual([buy.kind, buy.label, buy.price, buy.stop], ["buy", "SMA Golden Cross", 292.45, 271.98]);

    const exit = toExtensionSignal({
      strategy: "rsi_reversal", signal_type: "exit", generated_at: at,
      payload: { close: 1400.5, stop: 1330.48 },
    });
    assert.equal(exit.kind, "exit");
    assert.equal(exit.stop, null);
  });

  test("a KK buy uses its fill/entry price", () => {
    const s = toExtensionSignal({
      strategy: "kk_breakout", signal_type: "buy", generated_at: at,
      payload: { action: "buy", entry: 637.2, fill: 637.2, close: 640, stop: 624 },
    });
    assert.equal(s.price, 637.2);
  });
});

describe("extension CORS", () => {
  const ext = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

  test("only real extension origins count", () => {
    assert.ok(isExtensionOrigin(ext));
    assert.ok(!isExtensionOrigin("https://evil.example"));
    assert.ok(!isExtensionOrigin("chrome-extension://evil.example"));
    assert.ok(!isExtensionOrigin(null));
  });

  test("the extension gets credentials; other sites never do", () => {
    assert.equal(extensionCors(ext, { anyOrigin: false })["Access-Control-Allow-Credentials"], "true");
    assert.equal(extensionCors(ext, { anyOrigin: false })["Access-Control-Allow-Origin"], ext);

    const site = extensionCors("https://kite.zerodha.com", { anyOrigin: true });
    assert.equal(site["Access-Control-Allow-Origin"], "*");
    assert.equal(site["Access-Control-Allow-Credentials"], undefined);

    const blocked = extensionCors("https://evil.example", { anyOrigin: false });
    assert.equal(blocked["Access-Control-Allow-Origin"], undefined);
  });
});
