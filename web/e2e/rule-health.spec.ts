import { expect, expectNoHorizontalOverflow, test } from "./helpers/fixtures";
import { seriousViolations } from "./helpers/axe";

/**
 * Rule health and mistake review (ADR-039), and the calmer stock page: each rule's recent record against its tested
 * range on the Signals page, five plain answers at the top of a stock, and its details one tab at a time.
 */
test.describe("rule health @mobile", () => {
  test("the Signals page shows each rule's recent record, its normal range and what its losses had in common", async ({ proPage }) => {
    await proPage.goto("/app/signals?scope=all#health");
    const cards = proPage.getByTestId("rule-health");
    await expect(cards.getByRole("region")).toHaveCount(4);
    for (const name of ["Strong trend", "RSI dip", "KK dip", "SMA 20/50 trend"]) {
      const card = cards.getByRole("region", { name: `${name} health` });
      await expect(card.locator("[data-health]")).toHaveCount(1);
      await expect(card).toContainText(/of its last \d+ finished trades made money/);
      await expect(card.locator("[data-health]")).toHaveAttribute("title", /./);
    }
    await expect(proPage.getByText("never changed or switched off on its own", { exact: false })).toBeVisible();
    await expectNoHorizontalOverflow(proPage);
  });
});

test.describe("stock page layout @mobile", () => {
  test("five answers at a glance, then one section at a time", async ({ proPage }, info) => {
    await proPage.goto("/app/markets/TCS");
    const glance = proPage.getByTestId("at-a-glance");
    for (const label of ["Long-term direction", "How hot it is", "Within its year", "Our rules now", "Research note"]) {
      await expect(glance.getByText(label, { exact: true })).toBeVisible();
    }
    const tabs = proPage.getByRole("tablist", { name: "Stock details" });
    await expect(tabs.getByRole("tab", { name: "Plan & alerts" })).toHaveAttribute("aria-selected", "true");
    await expect(proPage.getByRole("heading", { name: "Key levels" })).toBeVisible();
    await expect(proPage.getByRole("heading", { name: "Backtest Lab" })).toHaveCount(0);

    await tabs.getByRole("tab", { name: "Signal history" }).click();
    await expect(proPage).toHaveURL(/#history$/);
    await expect(proPage.getByRole("heading", { name: "Signal history" })).toBeVisible();
    await expect(proPage.getByRole("heading", { name: "Key levels" })).toBeHidden();
    await expectNoHorizontalOverflow(proPage);
    expect(await seriousViolations(proPage)).toEqual([]);
    await proPage.screenshot({ path: info.outputPath("stock.png"), fullPage: true });

    // A link to a section opens its tab.
    await proPage.goto("/app/markets/TCS#research");
    await expect(tabs.getByRole("tab", { name: "Research & news" })).toHaveAttribute("aria-selected", "true");
    await expect(proPage.getByRole("heading", { name: "Research note" })).toBeVisible();
  });
});
