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

  test("blog: five research notes, each with one H1, the short answer, charts and structured data", async ({ page }) => {
    await page.goto("/blog");
    await expect(page.getByTestId("blog-list").getByRole("link")).toHaveCount(5);
    const hrefs = await page.getByTestId("blog-list").getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
    for (const href of hrefs) {
      await page.goto(href);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByTestId("blog-answer")).toBeVisible();
      await expect(page.getByTestId("blog-stats")).toBeVisible();
      await expect(page.locator("figure svg").first()).toBeVisible();
      const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
      const types = ld.flatMap((t) => (JSON.parse(t) as { "@type": string }[]).map((x) => x["@type"]));
      expect(types).toEqual(expect.arrayContaining(["BlogPosting", "FAQPage", "BreadcrumbList"]));
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${href}$`));
      await expectNoHorizontalOverflow(page);
    }
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("blog: the measure buttons switch the chart, the numbers open as a table", async ({ page }) => {
    await page.goto("/blog/rsi-oversold-vs-rsi-dip-rule");
    await page.getByRole("button", { name: "Average trade" }).click();
    await expect(page.getByText("The average trade, after costs")).toBeVisible();
    await page.getByText("Show the numbers").first().click();
    await expect(page.getByRole("cell", { name: "2024 to 2026" }).first()).toBeVisible();
  });

  test("sitemap and robots list the public pages only", async ({ request }) => {
    const map = await (await request.get("/sitemap.xml")).text();
    expect(map).toContain("/blog/sma-20-50-crossover-vs-sma-trend-rule");
    expect(map).not.toContain("/app");
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toMatch(/Disallow: \/app/);
    expect(robots).toContain("sitemap.xml");
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
