import { expect, test } from "./helpers/fixtures";
import { seriousViolations } from "./helpers/axe";

const PAGES = ["/app", "/app/markets", "/app/markets/INFY", "/app/research", "/app/news?scope=all", "/app/settings?tab=privacy", "/app/billing"];

test.describe("accessibility (axe, WCAG 2.1 AA, serious + critical)", () => {
  for (const path of PAGES) {
    test(`${path}`, async ({ proPage }) => {
      await proPage.goto(path);
      await proPage.waitForLoadState("networkidle");
      expect(await seriousViolations(proPage)).toEqual([]);
    });
  }

  test("dark theme passes too", async ({ proPage }) => {
    await proPage.goto("/app/research");
    await proPage.getByRole("button", { name: "Switch to dark theme" }).click();
    expect(await seriousViolations(proPage)).toEqual([]);
    await proPage.getByRole("button", { name: "Switch to light theme" }).click();
  });
});
