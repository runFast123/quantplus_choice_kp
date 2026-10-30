import { expect, expectNoHorizontalOverflow, test } from "./helpers/fixtures";
import { seriousViolations } from "./helpers/axe";

/**
 * Dry Run (ADR-033): the disclosure comes first and must be accepted; the user picks stocks and
 * the page sizes, replays, stress-tests and scores the plan. No step recommends anything.
 */
test.describe("Dry Run @mobile", () => {
  test("the disclosure gates the page, then a picked plan is sized, replayed, stress-tested and scored", async ({ proPage }, info) => {
    test.slow();
    await proPage.goto("/app/dry-run");
    const gate = proPage.getByTestId("dry-run-gate");
    await expect(gate).toBeVisible();
    await expect(gate.getByTestId("dry-run-disclosure")).toContainText("not a SEBI-registered investment adviser");
    const start = gate.getByRole("button", { name: "Start my Dry Run" });
    await expect(start).toBeDisabled();
    await gate.getByRole("checkbox").check();
    await start.click();

    const page = proPage.getByTestId("dry-run");
    await expect(page).toBeVisible();
    await expect(page.getByTestId("dry-run-disclosure").first()).toContainText("not recommendations");
    await expectNoHorizontalOverflow(proPage);

    // Pick from the rule matches (live data), and add one stock by search.
    const adds = page.getByTestId("dry-run-candidates").getByRole("button", { name: /^Add / });
    const n = Math.min(await adds.count(), 4);
    for (let i = 0; i < n; i++) await adds.first().click();
    await page.getByRole("textbox", { name: "Add any stock" }).fill("TCS");
    await page.getByRole("button", { name: /^TCS / }).first().click();

    const plan = page.getByTestId("dry-run-plan");
    await expect(plan.getByRole("textbox", { name: /^Stop-loss for / })).toHaveCount(n + 1, { timeout: 20_000 });
    await expect(page.getByText(`${n + 1} of 10 picked`)).toBeVisible();

    await expect(page.getByTestId("dry-run-replay-headline")).toContainText(/would be ₹[\d,]+ today/);
    await expect(page.getByTestId("replay-chart")).toBeVisible();
    await expect(page.getByTestId("dry-run-bad-days")).toContainText("Worst single day");
    await expect(page.getByTestId("dry-run-score")).toHaveText(/^\d\/7$/);
    await proPage.waitForTimeout(2500); // let the replay finish drawing
    await proPage.screenshot({ path: info.outputPath("dry-run.png"), fullPage: true });

    // Removing a stop-loss fails the stop guardrail; the plan updates as you type.
    const firstStop = plan.getByRole("textbox", { name: /^Stop-loss for / }).first();
    await firstStop.fill("");
    await firstStop.fill("0");
    await expect(page.getByTestId("dry-run-guardrails")).toContainText("Missing on");

    expect(await seriousViolations(proPage)).toEqual([]);
    await expectNoHorizontalOverflow(proPage);

    // The acknowledgement is remembered in this browser.
    await proPage.reload();
    await expect(proPage.getByTestId("dry-run")).toBeVisible();
    await expect(proPage.getByTestId("dry-run-gate")).toHaveCount(0);
  });
});
