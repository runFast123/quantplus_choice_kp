import { readFileSync } from "node:fs";
import { oneOffUser } from "./helpers/extra-users";
import { expect, HOOK_REASON, state, test } from "./helpers/fixtures";

/**
 * Flows that write tenant-scoped data. They need the access-token hook (the
 * JWT's app_tenant_id claim) — without it RLS correctly blocks every write,
 * so the whole file is skipped with a clear reason instead of failing.
 */
test.skip(() => !state().hook, HOOK_REASON);
test.describe.configure({ mode: "serial" });

test("radar: add from Markets, see it on Market Radar, remove it", async ({ proPage }) => {
  await proPage.goto("/app/markets?sector=IT");
  await proPage.getByRole("button", { name: "Add WIPRO to radar" }).click();
  await expect(proPage.getByRole("button", { name: "Remove WIPRO from radar" })).toBeVisible();
  await proPage.goto("/app/watchlist");
  const row = proPage.locator("tbody tr", { hasText: "WIPRO" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Remove WIPRO" }).click();
  await row.getByRole("button", { name: /Remove: Remove WIPRO/ }).click();
  await expect(proPage.locator("tbody tr", { hasText: "WIPRO" })).toHaveCount(0);
});

test("radar: Basic plan stops at 10 distinct symbols", async ({ browser }) => {
  const u = await oneOffUser("limit", "basic");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app");
  await page.goto("/app/watchlist");
  for (const sym of ["TCS", "INFY", "ITC", "SBIN", "LT", "TITAN", "WIPRO", "NTPC", "ONGC", "CIPLA"]) {
    await page.getByLabel("Symbol").fill(sym);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(`${sym} added`);
  }
  await page.getByLabel("Symbol").fill("MARUTI");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("limit of 10 symbols");
  await ctx.close();
});

test("portfolio: Basic is gated; Pro adds, merges at weighted average, removes", async ({ basicPage, proPage }) => {
  await basicPage.goto("/app/portfolio");
  await expect(basicPage.getByTestId("plan-gate")).toBeVisible();

  await proPage.goto("/app/portfolio");
  const add = async (qty: string, px: string) => {
    await proPage.getByLabel("Symbol").fill("INFY");
    await proPage.getByLabel("Quantity").fill(qty);
    await proPage.getByLabel("Avg price (₹)").fill(px);
    await proPage.getByRole("button", { name: "Add holding" }).click();
  };
  await add("10", "1000");
  await expect(proPage.getByRole("status")).toContainText("INFY added");
  await add("10", "2000");
  await expect(proPage.getByRole("status")).toContainText("Added to your INFY position");
  const row = proPage.locator("tbody tr", { hasText: "INFY" });
  await expect(row).toContainText("20");
  await expect(row).toContainText("1,500.00");
  await row.getByRole("button", { name: "Remove INFY" }).click();
  await row.getByRole("button", { name: /Remove: Remove INFY/ }).click();
  await expect(proPage.locator("tbody tr", { hasText: "INFY" })).toHaveCount(0);
});

test("alerts: rejects a level already crossed, accepts a valid one, deletes it", async ({ proPage }) => {
  await proPage.goto("/app/alerts");
  await proPage.getByLabel("Symbol").fill("TCS");
  await proPage.getByLabel("When price is").selectOption("above");
  await proPage.getByLabel("Price (₹)").fill("1");
  await proPage.getByRole("button", { name: "Set alert" }).click();
  await expect(proPage.getByRole("alert")).toContainText("already above");
  await proPage.getByLabel("Price (₹)").fill("999999");
  await proPage.getByRole("button", { name: "Set alert" }).click();
  await expect(proPage.getByRole("status")).toContainText("Alert set");
  const row = proPage.locator("tbody tr", { hasText: "TCS" });
  await expect(row).toContainText("Armed");
  await row.getByRole("button", { name: "Delete TCS alert" }).click();
  await row.getByRole("button", { name: /Delete: Delete TCS alert/ }).click();
  await expect(proPage.locator("tbody tr", { hasText: "TCS" })).toHaveCount(0);
});

test("settings: export downloads only my own data", async ({ proPage }) => {
  await proPage.goto("/app/settings?tab=data");
  const [download] = await Promise.all([proPage.waitForEvent("download"), proPage.getByRole("link", { name: /Download my data/ }).click()]);
  const json = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(json.profile.user_id).toBe(state().users.pro.id);
  expect(Array.isArray(json.holdings)).toBe(true);
  expect(JSON.stringify(json)).not.toContain(state().users.basic.id);
});

test("workspace: create an organisation and generate an invite link", async ({ proPage }) => {
  const slug = `e2e-${Date.now()}`;
  await proPage.goto("/app/workspace");
  await proPage.getByLabel("Organisation name").fill("E2E Advisory");
  await proPage.getByLabel("Address").fill(slug);
  await proPage.getByRole("button", { name: "Create organisation" }).click();
  await expect(proPage.getByRole("heading", { level: 1 })).toHaveText("E2E Advisory");
  await proPage.getByLabel("Email").fill("colleague@quantspulse.test");
  await proPage.getByRole("button", { name: "Create invite" }).click();
  await expect(proPage.getByLabel("Invitation link")).toHaveValue(/\/invite\//);
  // Back to personal so later tests aren't scoped to the org.
  await proPage.getByRole("button", { name: /E2E Advisory/ }).click();
  await proPage.getByRole("menuitemradio", { name: /Personal/ }).click();
  await expect(proPage).toHaveURL(/\/app$/);
});
