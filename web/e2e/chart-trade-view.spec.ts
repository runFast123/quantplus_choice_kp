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
    await proPage.getByRole("radiogroup", { name: "Strategy Signal Filter" }).getByRole("radio", { name: /^KK \(/ }).click();

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

  test("the trade view shows the odds in plain words: a verdict, 100 dots and the signal's past", async ({ proPage }, info) => {
    await proPage.goto("/app/markets/TCS");
    await proPage.waitForLoadState("networkidle");
    await proPage.getByRole("radiogroup", { name: "Strategy Signal Filter" }).getByRole("radio", { name: /^KK \(/ }).click();
    await proPage.getByTestId("signals-timeline").getByRole("button", { name: /▲ BUY|▼ SELL/ }).first().click();

    const odds = proPage.getByTestId("trade-odds");
    await expect(odds).toBeVisible();
    await expect(odds.getByTestId("odds-verdict")).toHaveText(/About even|toward the (target|stop)|Too early to tell/);
    const dots = odds.getByRole("img", { name: /^Out of 100 replays: \d+ reached the target/ });
    await expect(dots).toBeVisible();
    await expect(odds.getByText(/still open after 5 days/)).toBeVisible();
    await expect(odds.getByTestId("odds-history")).toContainText(/Past signals on TCS|no track record yet/);
    await expect(odds).toContainText("A simulation, not a prediction");

    // The method is there for whoever wants it, folded away by default.
    await expect(odds.getByText(/replayed 10,000 times/)).toBeHidden();
    await odds.getByText("How is this worked out?").click();
    await expect(odds.getByText(/replayed 10,000 times/)).toBeVisible();
    await odds.screenshot({ path: info.outputPath("odds.png") });

    // Looking further ahead re-runs the replays.
    const before = await dots.getAttribute("aria-label");
    await odds.getByRole("radio", { name: "20 days" }).click();
    await expect(odds.getByRole("radio", { name: "20 days" })).toHaveAttribute("aria-checked", "true");
    await expect(odds.getByText(/still open after 20 days/)).toBeVisible();
    expect(await odds.getByRole("img", { name: /^Out of 100 replays/ }).getAttribute("aria-label")).not.toBe(before);
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
