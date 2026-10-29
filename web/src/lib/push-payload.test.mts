// Unit tests for browser notification payloads: npm run test:unit
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { notificationUrl, toPushPayload } from "./push-payload";

describe("push payloads", () => {
  test("alerts, exits and stance changes open the stock", () => {
    assert.equal(notificationUrl("price_alert", { symbol: "TCS" }), "/app/markets/TCS");
    assert.equal(notificationUrl("exit_signal", { symbol: "M&M" }), "/app/markets/M%26M");
    assert.equal(notificationUrl("research_stance", { symbol: "INFY" }), "/app/markets/INFY");
  });

  test("anything else lands somewhere sensible, never on a crafted path", () => {
    assert.equal(notificationUrl("plan_expiry", {}), "/app/billing");
    assert.equal(notificationUrl("price_alert", {}), "/app/alerts");
    assert.equal(notificationUrl("price_alert", { symbol: "../../evil" }), "/app/alerts");
    assert.equal(notificationUrl("something_new", null), "/app");
  });

  test("title and body are capped, and the tag replaces rather than stacks", () => {
    const p = toPushPayload({ id: "n1", type: "price_alert", title: "x".repeat(300), body: null, data: { symbol: "TCS" } });
    assert.equal(p.title.length, 120);
    assert.equal(p.body, "");
    assert.equal(p.tag, "price_alert:n1");
  });
});
