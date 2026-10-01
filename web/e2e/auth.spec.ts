import { expect, test, type Browser } from "@playwright/test";
import type { TestUser } from "./helpers/admin";
import { oneOffUser } from "./helpers/extra-users";

async function signInFresh(browser: Browser, u: TestUser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app");
  return { ctx, page };
}

test.describe("authentication", () => {
  test("wrong password shows a clear error and keeps the email", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@quantspulse.test");
    await page.getByLabel("Password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("main form").getByRole("alert")).toHaveText("That email and password don't match.");
    await expect(page.getByLabel("Email")).toHaveValue("nobody@quantspulse.test");
  });

  test("signup can't be submitted without accepting the terms", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Full name").fill("Test Person");
    await page.getByLabel("Email").fill("e2e.nosubmit@quantspulse.test");
    await page.getByLabel("Password").fill("a-long-password");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/signup$/);
    expect(await page.locator('input[name="terms"]').evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);
  });

  test("password reset answers the same whether or not the account exists", async ({ page }) => {
    await page.goto("/forgot");
    await page.getByLabel("Email").fill(`e2e.ghost.${Date.now()}@quantspulse.test`);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText("If that address has an account");
  });

  test("first sign-in records consents, then opens the desk", async ({ page }) => {
    const u = await oneOffUser("onboard", "basic", []);
    await page.goto("/login");
    await page.getByLabel("Email").fill(u.email);
    await page.getByLabel("Password").fill(u.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: /Before we open/ })).toBeVisible();
    await page.getByLabel("What should we call you?").fill("Asha Rao");
    await page.getByLabel(/Product notes by email/).check();
    await page.getByRole("button", { name: "Open my desk" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Asha");
    await page.goto("/app/settings?tab=privacy");
    await expect(page.getByRole("switch", { name: "Terms of Service" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("switch", { name: "Product notes by email" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("switch", { name: "Broker data access" })).toHaveAttribute("aria-checked", "false");
  });

  test("one active device: a second sign-in takes over, the first can reclaim", async ({ browser }) => {
    const u = await oneOffUser("device", "basic");
    const first = await signInFresh(browser, u);
    const second = await signInFresh(browser, u);
    await first.page.goto("/app/markets");
    await expect(first.page).toHaveURL(/\/device$/);
    await expect(first.page.getByRole("heading", { name: /signed in somewhere else/ })).toBeVisible();
    // Server actions are blocked too, not just page renders.
    const exportRes = await first.page.request.get("/app/settings/export");
    expect(exportRes.status()).toBe(403);
    await first.page.getByRole("button", { name: "Use QuantsPulse on this device" }).click();
    await expect(first.page).toHaveURL(/\/app$/);
    await second.page.goto("/app/markets");
    await expect(second.page.getByRole("heading", { name: /signed in somewhere else/ })).toBeVisible();
    await first.ctx.close();
    await second.ctx.close();
  });

  test("sign-in never redirects off-site, whatever `next` says", async ({ browser }) => {
    const u = await oneOffUser("redirect", "basic");
    for (const evil of ["//evil.example", String.raw`/\evil.example`, "/\t/evil.example", "https://evil.example"]) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`/login?next=${encodeURIComponent(evil)}`);
      await page.getByLabel("Email").fill(u.email);
      await page.getByLabel("Password").fill(u.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForLoadState("networkidle");
      const landed = new URL(page.url());
      expect(landed.hostname, evil).toBe(new URL(process.env.E2E_BASE_URL ?? "http://localhost").hostname);
      expect(landed.pathname, evil).toBe("/app"); // every hostile `next` falls back to the app
      await ctx.close();
    }
  });

  test("sign out ends the session", async ({ browser }) => {
    const u = await oneOffUser("signout", "basic");
    const { ctx, page } = await signInFresh(browser, u);
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
    await ctx.close();
  });
});
