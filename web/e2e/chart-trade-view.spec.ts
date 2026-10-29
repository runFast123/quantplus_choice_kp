import { expect, test } from "./helpers/fixtures";

/**
 * Chart phase 2: selecting a signal shows its round trip (risk and reward zones, entry/stop/target
 * lines), every signal explains itself in plain words, and signals newer than the last visit are
 * marked once. Screenshots land in test-results/ for a visual check.
 */
test.describe("price chart trade view @chart", () => {
  test("a selected entry draws its risk and reward, and explains the rule", async ({ proPage }, info) => {
    await proPage.goto("/app/markets/TCS");
    await proPage.waitForLoadState("networkidle");
    await proPage.getByRole("radiogroup", { name: "Strategy Signal Filter" }).getByRole("radio", { name: /KK 20d Breakout/i }).click();

    const timeline = proPage.getByTestId("signals-timeline");
    const entry = timeline.getByRole("button", { name: /▲ BUY|▼ SELL/ }).first();
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute("title", /20-day (low|high)/);
    await entry.click();
    await expect(entry).toHaveAttribute("aria-pressed", "true");

    await expect(proPage.getByTestId("trade-zone-risk")).toBeVisible();
    await expect(proPage.getByTestId("trade-zone-reward")).toBeVisible();
    await expect(proPage.getByText(/1R = ₹/)).toBeVisible();
    await expect(proPage.getByTestId("signal-explainer")).toContainText(/20-day (low|high)/);

    // Reward sits on the profit side of risk: above it for a long, below for a short.
    const risk = await proPage.getByTestId("trade-zone-risk").boundingBox();
    const reward = await proPage.getByTestId("trade-zone-reward").boundingBox();
    const isLong = /▲ BUY/.test((await entry.textContent()) ?? "");
    if (isLong) expect(reward!.y).toBeLessThan(risk!.y);
    else expect(reward!.y).toBeGreaterThan(risk!.y);

    await proPage.waitForTimeout(400); // let the pan settle before the screenshot
    await proPage.locator("main").screenshot({ path: info.outputPath("trade-view.png") });

    // Clearing the selection removes the trade view.
    await entry.click();
    await expect(proPage.getByTestId("trade-zone-risk")).toHaveCount(0);
  });

  test("signals since the last visit are marked new", async ({ proPage }) => {
    await proPage.goto("/app/markets/TCS");
    await proPage.waitForLoadState("networkidle");
    // Pretend the last visit was long ago, then come back.
    await proPage.evaluate(() => localStorage.setItem("qp:chart-seen:TCS", "2000-01-01T00:00:00Z"));
    await proPage.reload();
    await proPage.waitForLoadState("networkidle");
    await expect(proPage.getByTestId("signals-timeline").getByText("New").first()).toBeVisible();

    // The visit is remembered: next time nothing is new.
    await proPage.reload();
    await proPage.waitForLoadState("networkidle");
    await expect(proPage.getByTestId("signals-timeline")).toBeVisible();
    await expect(proPage.getByTestId("signals-timeline").getByText("New")).toHaveCount(0);
  });
});
