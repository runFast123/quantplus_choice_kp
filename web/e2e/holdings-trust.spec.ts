import { seedSplitAdjustment } from "./helpers/admin";
import { expect, HOOK_REASON, state, test } from "./helpers/fixtures";

/** Portfolio plan, step 1 (migration 50): split adjustments can be undone, and you choose which rules message you. */
test.skip(() => !state().hook, HOOK_REASON);
test.describe.configure({ mode: "serial" });

test("portfolio: a split adjustment is shown in plain numbers and can be undone once", async ({ proPage }) => {
  await seedSplitAdjustment(state().users.pro.id, "HDFCBANK");
  await proPage.goto("/app/portfolio");
  const panel = proPage.locator("#adjustments");
  await expect(panel).toContainText("Split and bonus changes");
  await expect(panel).toContainText("each share became 2");
  await expect(panel).toContainText("10 at ₹3,000.00 → 20 at ₹1,500.00");
  await panel.getByRole("button", { name: "Undo the change to HDFCBANK" }).click();
  await expect(proPage.locator("#adjustments")).toHaveCount(0);
  const row = proPage.locator("tbody tr", { hasText: "HDFCBANK" });
  await expect(row).toContainText("3,000.00");
  await row.getByRole("button", { name: "Remove HDFCBANK" }).click();
  await row.getByRole("button", { name: /Remove: Remove HDFCBANK/ }).click();
  await expect(proPage.locator("tbody tr", { hasText: "HDFCBANK" })).toHaveCount(0);
});

test("settings: trend rules message you by default, and your choice is kept", async ({ proPage }) => {
  await proPage.goto("/app/settings?tab=notifications");
  const form = proPage.getByTestId("exit-rules");
  for (const name of ["Strong trend", "SMA 20/50 trend", "200-day trend"]) await expect(form.getByRole("checkbox", { name })).toBeChecked();
  for (const name of ["RSI dip", "KK dip"]) await expect(form.getByRole("checkbox", { name })).not.toBeChecked();

  await form.getByRole("checkbox", { name: "KK dip" }).check();
  await form.getByRole("checkbox", { name: "Strong trend" }).uncheck();
  await form.getByRole("button", { name: "Save choices" }).click();
  await expect(form.getByRole("status")).toContainText("Only the ticked rules will message you");

  await proPage.reload();
  const again = proPage.getByTestId("exit-rules");
  await expect(again.getByRole("checkbox", { name: "KK dip" })).toBeChecked();
  await expect(again.getByRole("checkbox", { name: "Strong trend" })).not.toBeChecked();
  await expect(again.getByRole("checkbox", { name: "SMA 20/50 trend" })).toBeChecked();
});
