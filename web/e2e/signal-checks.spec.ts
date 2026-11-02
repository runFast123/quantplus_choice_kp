import { expect, test } from "./helpers/fixtures";

/**
 * Signal checks (ADR-038): the Signals page explains both checks with their tested record, names the years each tag
 * was wrong, and every tag carries its meaning. Tags add information; they never hide a signal.
 */
test.describe("signal checks @mobile", () => {
  test("the panel shows both checks, their record and the wrong years", async ({ proPage }, info) => {
    await proPage.goto("/app/signals?scope=all#record");
    await expect(proPage.getByRole("heading", { name: "Signal checks" })).toBeVisible();
    const rsi = proPage.getByRole("region", { name: "RSI dip check" });
    const trend = proPage.getByRole("region", { name: "Strong trend check" });
    await expect(rsi).toContainText("Stronger dip");
    await expect(rsi).toContainText(/Since 2023, RSI dips tagged stronger made money \d+ times in 100/);
    await expect(rsi).toContainText(/In 2025 the \d+ tagged dips made money only/);
    await expect(rsi).toContainText(/On this site/);
    await expect(trend).toContainText("Weak lately");
    await expect(trend).toContainText(/9 of 18 months/);
    await rsi.getByText("Tested record by year").click();
    await expect(rsi.getByRole("table").locator("tbody tr")).toHaveCount(4);
    await expect(proPage.getByText("every signal is still listed and graded", { exact: false })).toBeVisible();
    await rsi.scrollIntoViewIfNeeded();
    await proPage.screenshot({ path: info.outputPath("signal-checks.png"), fullPage: true });
  });

  test("every tag says what it means and that it is not advice", async ({ proPage }) => {
    await proPage.goto("/app/signals?scope=all#record");
    const tags = proPage.locator("[data-check]");
    await expect(tags.first()).toBeVisible();          // the panel shows one of each
    const n = await tags.count();
    for (let i = 0; i < Math.min(n, 12); i++) {
      await expect(tags.nth(i)).toHaveAttribute("title", /not advice/);
      await expect(tags.nth(i)).toHaveText(/Stronger dip|Weak lately/);
    }
  });
});
