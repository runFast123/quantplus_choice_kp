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
  await proPage.goto("/app/markets");
  const addButton = proPage.getByRole("button", { name: "Add TCS to radar" });
  await expect(addButton).toBeVisible();
  // The toggle flips optimistically; wait for the server action to land before navigating away.
  await Promise.all([
    proPage.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/app/markets")),
    addButton.click(),
  ]);
  await expect(proPage.getByRole("button", { name: "Remove TCS from radar" })).toBeVisible();
  await proPage.goto("/app/watchlist");
  const row = proPage.locator("tbody tr", { hasText: "TCS" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Remove TCS" }).click();
  await row.getByRole("button", { name: /Remove: Remove TCS/ }).click();
  await expect(proPage.locator("tbody tr", { hasText: "TCS" })).toHaveCount(0);
});

test("radar: Basic plan stops at 10 distinct symbols", async ({ browser }) => {
  test.slow();
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
    await page.getByLabel("Symbol", { exact: true }).fill(sym);
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/app/watchlist")),
      page.getByRole("button", { name: "Add", exact: true }).click(),
    ]);
    await expect(page.locator("main").getByRole("status")).toContainText(`${sym} added`);
  }
  await page.getByLabel("Symbol", { exact: true }).fill("MARUTI");
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/app/watchlist")),
    page.getByRole("button", { name: "Add", exact: true }).click(),
  ]);
  await expect(page.locator("main").getByRole("alert")).toContainText("limit of 10 symbols");
  await ctx.close();
});

test("portfolio: Basic is gated; Pro records buys and a sale, sees the gain, corrects a trade, removes", async ({ basicPage, proPage }) => {
  await basicPage.goto("/app/portfolio");
  await expect(basicPage.getByTestId("plan-gate")).toBeVisible();

  await proPage.goto("/app/portfolio");
  const form = proPage.locator("#record");
  const trade = async (side: "Buy" | "Sell", day: string, qty: string, px: string) => {
    await form.locator("label", { hasText: new RegExp(`^${side}$`) }).click();
    await form.getByLabel("Symbol", { exact: true }).fill("INFY");
    await form.getByLabel("Date", { exact: true }).fill(day);
    await form.getByLabel("Quantity", { exact: true }).fill(qty);
    await form.getByLabel("Price per share (₹)").fill(px);
    await form.getByRole("button", { name: side === "Buy" ? "Record buy" : "Record sell" }).click();
  };
  const positions = proPage.getByTestId("positions");
  await trade("Buy", "2026-01-05", "10", "1000");
  await expect(form.getByRole("status")).toContainText("Recorded: bought 10 INFY at ₹1,000.00.");
  await trade("Buy", "2026-02-05", "10", "2000");
  await expect(positions.locator("tr", { hasText: "INFY" })).toContainText("1,500.00");

  // Oldest shares first: the 5 sold came from the ₹1,000 buy.
  await trade("Sell", "2026-03-05", "5", "1800");
  await expect(form.getByRole("status")).toContainText("Sold 5 INFY: you made ₹4,000.00 after charges.");
  await expect(positions.locator("tr", { hasText: "INFY" })).toContainText("15");
  await expect(positions.locator("tr", { hasText: "INFY" })).toContainText("1,666.67");
  await expect(proPage.getByTestId("sales")).toContainText("₹4,000.00");
  await expect(proPage.getByTestId("portfolio-stats")).toContainText("Realized gain");

  // The stock's history: correct the first buy, then delete the sale.
  await positions.getByRole("link", { name: "History of INFY" }).click();
  await expect(proPage).toHaveURL(/\/app\/portfolio\/INFY/);
  const trades = proPage.getByTestId("trades");
  await expect(trades.locator("tbody tr")).toHaveCount(3);
  await trades.getByRole("button", { name: /^Edit buy of/ }).first().click();
  await trades.getByLabel("Price per share").fill("1200");
  await trades.getByRole("button", { name: "Save" }).click();
  await expect(proPage.getByTestId("history-stats")).toContainText("₹3,000.00");
  await trades.getByRole("button", { name: /^Delete sell of/ }).click();
  await trades.getByRole("button", { name: /^Delete: Delete sell of/ }).click();
  await expect(trades.locator("tbody tr")).toHaveCount(2);
  await expect(proPage.getByTestId("history-stats")).toContainText("nothing sold yet");

  await proPage.goto("/app/portfolio");
  const row = positions.locator("tr", { hasText: "INFY" });
  await row.getByRole("button", { name: "Remove INFY" }).click();
  await row.getByRole("button", { name: /Remove all its trades: Remove INFY/ }).click();
  await expect(positions.locator("tr", { hasText: "INFY" })).toHaveCount(0);
});

test("alerts: rejects a level already crossed, accepts a valid one, deletes it", async ({ proPage }) => {
  await proPage.goto("/app/alerts");
  await proPage.getByLabel("Symbol", { exact: true }).fill("TCS");
  await proPage.getByLabel("When price is").selectOption("above");
  await proPage.getByLabel("Price (₹)").fill("1");
  await proPage.getByRole("button", { name: "Set alert" }).click();
  await expect(proPage.locator("main").getByRole("alert")).toContainText("already above");
  // What the user typed survives the error (React resets forms after every action).
  await expect(proPage.getByLabel("Symbol", { exact: true })).toHaveValue("TCS");
  await proPage.getByLabel("Price (₹)").fill("999999");
  await proPage.getByRole("button", { name: "Set alert" }).click();
  await expect(proPage.locator("main").getByRole("status")).toContainText("Alert set");
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
  await proPage.getByLabel("Email", { exact: true }).fill("colleague@quantspulse.test");
  await proPage.getByRole("button", { name: "Create invite" }).click();
  await expect(proPage.getByLabel("Invitation link")).toHaveValue(/\/invite\//);
  // Back to personal so later tests aren't scoped to the org.
  await proPage.getByRole("button", { name: /E2E Advisory/ }).click();
  await proPage.getByRole("menuitemradio", { name: /Personal/ }).click();
  await expect(proPage).toHaveURL(/\/app$/);
});
