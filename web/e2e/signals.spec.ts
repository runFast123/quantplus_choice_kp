import { expect, test } from "./helpers/fixtures";

/**
 * Signals page (ADR-035): four rules, Strong trend with its tested record, today's market weather and a
 * track record that grades every signal. Copy stays research, never advice.
 */
test.describe("signals @mobile", () => {
  test("shows the four rules, the market weather and the track record", async ({ proPage }) => {
    await proPage.goto("/app/signals?scope=all");
    const card = proPage.getByRole("link", { name: /Strong trend/ }).first();
    await expect(card).toContainText("52-week high");
    await expect(card).toContainText("Tested on past prices");
    await expect(card).toContainText("made money after costs");
    for (const rule of ["SMA 20/50 cross", "RSI reversal", "KK 20d Breakout"]) {
      await expect(proPage.getByRole("link", { name: new RegExp(rule) }).first()).toBeVisible();
    }
    await expect(proPage.getByRole("region", { name: "Market weather" })).toContainText(/Market weather: (Sunny|Mixed|Stormy|Unknown)/);
    await expect(proPage.getByRole("heading", { name: "Track record" })).toBeVisible();
    await expect(proPage.getByText("Signals are research prompts, not advice.", { exact: false })).toBeVisible();
  });

  test("the Strong trend filter lists only its signals", async ({ proPage }) => {
    await proPage.goto("/app/signals?scope=all&strategy=strong_trend");
    const rows = proPage.locator("table").last().locator("tbody tr");
    await expect(rows.first().or(proPage.getByText("No signals."))).toBeVisible();
    const n = await rows.count();
    test.skip(n === 0, "No Strong trend signals stored yet.");
    for (let i = 0; i < Math.min(n, 10); i++) await expect(rows.nth(i)).toContainText("Strong trend");
  });
});
