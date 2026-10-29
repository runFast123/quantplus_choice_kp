import { expect, test } from "./helpers/fixtures";

/**
 * Daily setup scanner: the Markets screener filters by the setup each stock's last close matched,
 * states the rule (never as advice), and a stock page lists what it matched with links back.
 */
test.describe("daily setups", () => {
  test("Markets filters by setup and says what the rule is", async ({ proPage }) => {
    await proPage.goto("/app/markets?setup=reclaim_ma20");
    await expect(proPage.getByTestId("setup-rule")).toContainText("Reclaimed 20-day average");
    await expect(proPage.getByTestId("setup-rule")).toContainText("not a recommendation");
    const rows = proPage.locator("tbody tr");
    // Wait for the table or the empty state before counting (count() doesn't wait).
    await expect(rows.first().or(proPage.getByText("Nothing matches."))).toBeVisible();
    const count = await rows.count();
    test.skip(count === 0, "No stock matched this rule on the last close.");
    // Every row in the filtered list shows the badge for that rule.
    for (let i = 0; i < Math.min(count, 10); i++) {
      await expect(rows.nth(i).getByText("Reclaimed 20-day average")).toBeVisible();
    }
  });

  test("a stock page lists the setups it matched and links to the others", async ({ proPage }) => {
    await proPage.goto("/app/markets?setup=breakout_20d");
    const first = proPage.locator("tbody tr").first().getByRole("link").first();
    await expect(first.or(proPage.getByText("Nothing matches."))).toBeVisible();
    test.skip((await first.count()) === 0, "No 20-day closing highs on the last close.");
    await first.click();
    await proPage.waitForURL(/\/app\/markets\/[^?]+$/);
    const note = proPage.getByTestId("symbol-setups");
    await expect(note).toContainText("Matched on the last close");
    const link = note.getByRole("link", { name: "20-day closing high" });
    await expect(link).toHaveAttribute("href", "/app/markets?setup=breakout_20d");
    await expect(link).toHaveAttribute("title", /above every close of the 20 sessions/);
  });
});
