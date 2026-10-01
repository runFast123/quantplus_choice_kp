import { expect, test } from "@playwright/test";
import { seriousViolations } from "./helpers/axe";
import { expectNoHorizontalOverflow } from "./helpers/fixtures";

test.describe("public site @mobile", () => {
  test("landing: hero, privacy matrix and plan prices from the database", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Research on rules");
    const pricing = page.locator("#pricing");
    await expect(pricing).toContainText("₹10,000");
    await expect(pricing).toContainText("₹15,000");
    await expect(pricing).toContainText("10-stock radar");
    await expect(page.locator("#privacy table")).toContainText("Holdings & portfolios");
    await expectNoHorizontalOverflow(page);
  });

  test("landing: FAQ answers expand", async ({ page }) => {
    await page.goto("/#faq");
    await page.getByText("Is this investment advice?").click();
    await expect(page.getByText("mechanical output of a rule")).toBeVisible();
  });

  test("legal drafts and 404", async ({ page }) => {
    await page.goto("/legal/privacy");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy Policy");
    await expect(page.getByText("Draft for legal review")).toBeVisible();
    await page.goto("/legal/nope");
    await expect(page.getByText("No such page")).toBeVisible();
  });

  test("protected routes send you to sign-in and remember where you were going", async ({ page }) => {
    await page.goto("/app/portfolio");
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fportfolio/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
  });

  test("login and landing have no serious accessibility violations", async ({ page }) => {
    await page.goto("/login");
    expect(await seriousViolations(page)).toEqual([]);
    await page.goto("/");
    expect(await seriousViolations(page)).toEqual([]);
  });
});

test.describe("public endpoints", () => {
  test("cron endpoint rejects missing and wrong secrets", async ({ request }) => {
    expect((await request.get("/api/cron/news")).status()).toBe(401);
    expect((await request.get("/api/cron/news", { headers: { authorization: "Bearer nope" } })).status()).toBe(401);
  });

  test("data export needs a session", async ({ request }) => {
    const r = await request.get("/app/settings/export", { maxRedirects: 0 });
    expect(r.status()).toBe(307);
    expect(r.headers()["location"]).toContain("/login");
  });
});
