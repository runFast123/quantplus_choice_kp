import { expect, test } from "./helpers/fixtures";

/**
 * Signals page (ADR-035, ADR-039): today's market, fresh buys and next-session levels first; the full list, the five
 * rules with their health, and the track record one tab at a time. Copy stays research, never advice.
 */
test.describe("signals @mobile", () => {
  test("today first, then the five rules and the track record in their own tabs", async ({ proPage }, info) => {
    await proPage.goto("/app/signals?scope=all");
    await expect(proPage.getByRole("region", { name: "Market weather" })).toContainText(/Market weather: (Sunny|Mixed|Stormy|Unknown)/);
    await expect(proPage.getByText("Signals are research prompts, not advice.", { exact: false })).toBeVisible();
    const tabs = proPage.getByRole("tablist", { name: "Signals" });
    await expect(tabs.getByRole("tab", { name: "Today" })).toHaveAttribute("aria-selected", "true");
    await expect(proPage.getByRole("heading", { name: "Fresh buys from the five rules" })).toBeVisible();
    await expect(proPage.getByRole("heading", { name: "Dip-buy levels for the next session" })).toBeVisible();
    await proPage.screenshot({ path: info.outputPath("signals.png"), fullPage: true });

    await tabs.getByRole("tab", { name: "The five rules" }).click();
    await expect(proPage).toHaveURL(/#rules$/);
    const strong = proPage.getByRole("article", { name: "Strong trend" });
    await expect(strong).toContainText("52-week high");
    await strong.getByText("Tested record").click();
    await expect(strong).toContainText("made money after costs");
    for (const rule of ["SMA 20/50 trend", "200-day trend", "RSI dip", "KK dip"]) await expect(proPage.getByRole("article", { name: rule })).toBeVisible();

    await tabs.getByRole("tab", { name: "Track record" }).click();
    await expect(proPage.getByRole("heading", { name: "Track record" })).toBeVisible();
  });

  test("the Strong trend filter lists only its signals", async ({ proPage }) => {
    await proPage.goto("/app/signals?scope=all&strategy=strong_trend#all");
    const rows = proPage.locator("main").locator("tbody tr:visible, [data-testid=signal-cards] > li:visible");
    await expect(rows.first().or(proPage.getByText("No signals.", { exact: true }))).toBeVisible();
    const n = await rows.count();
    test.skip(n === 0, "No Strong trend signals stored yet.");
    for (let i = 0; i < Math.min(n, 10); i++) await expect(rows.nth(i)).toContainText("Strong trend");
  });

  test("the list shows the five rules unless the old rules are asked for", async ({ proPage }) => {
    await proPage.goto("/app/signals?scope=all#all");
    const rows = proPage.locator("main").locator("tbody tr:visible, [data-testid=signal-cards] > li:visible");
    await expect(rows.first()).toBeVisible();
    for (let i = 0; i < Math.min(await rows.count(), 15); i++) await expect(rows.nth(i)).not.toContainText("(old rule)");
    await proPage.getByRole("group", { name: "Rules" }).getByRole("link", { name: "Old rules" }).click();
    await expect(proPage).toHaveURL(/rules=old/);
    await expect(proPage.getByRole("tab", { name: "All signals" })).toHaveAttribute("aria-selected", "true");
  });
});
