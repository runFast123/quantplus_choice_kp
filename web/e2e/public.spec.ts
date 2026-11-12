import { expect, test } from "@playwright/test";
import { seriousViolations } from "./helpers/axe";
import { expectNoHorizontalOverflow } from "./helpers/fixtures";

test.describe("public site @mobile", () => {
  test("landing: hero, privacy matrix and a card for each page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("NSE stock signals");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https?:\/\/[^/]+\/?$/);
    // the hero chart reads any day from the keyboard
    const chart = page.getByRole("slider", { name: /Illustrative price chart/ });
    await chart.focus();
    const before = await chart.getAttribute("aria-valuenow");
    await chart.press("ArrowLeft");
    await expect(chart).not.toHaveAttribute("aria-valuenow", before ?? "");
    await expect(page.locator("#privacy table")).toContainText("Holdings & portfolios");
    const cards = page.getByTestId("site-pages").getByRole("link");
    await expect(cards).toHaveCount(5);
    await expectNoHorizontalOverflow(page);
  });

  test("the old How it works address forwards to Method", async ({ page }) => {
    const res = await page.goto("/how-it-works");
    expect(res?.url()).toMatch(/\/method$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Six published rules");
  });

  test("each topic has its own page: one H1, its own title and canonical, and the navbar marks it", async ({ page }) => {
    const pages = [
      ["/method", "Six published rules"],
      ["/chrome-extension", "overlaid on your broker"],
      ["/pricing", "Priced by the year"],
      ["/faq", "Questions people ask"],
    ] as const;
    const titles = new Set<string>();
    for (const [path, h1] of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(h1);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${path}$`));
      titles.add(await page.title());
      if ((page.viewportSize()?.width ?? 0) >= 768) {
        await expect(page.getByRole("navigation", { name: "Site" }).locator('[aria-current="page"]')).toHaveAttribute("href", path);
      }
      await expectNoHorizontalOverflow(page);
    }
    expect(titles.size).toBe(pages.length);
  });

  test("the navbar stays put between pages: client-side moves, the drop follows, the page glides in", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, "the navbar is hidden on phones");
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Site" });
    // marks on the document and on the navbar element: a full reload or a remounted navbar would lose them
    await nav.evaluate((el) => {
      (window as unknown as { __qp: string }).__qp = "same";
      el.setAttribute("data-e2e", "same");
    });
    for (const [label, path, h1] of [
      ["Pricing", "/pricing", "Priced by the year"],
      ["Research", "/blog", "The usual way to use an indicator"],
      ["Method", "/method", "Six published rules"],
    ] as const) {
      await nav.getByRole("link", { name: label }).click();
      await expect(nav.locator('[aria-current="page"]')).toHaveAttribute("href", path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1 })).toContainText(h1);
    }
    expect(await page.evaluate(() => (window as unknown as { __qp?: string }).__qp)).toBe("same");
    await expect(nav).toHaveAttribute("data-e2e", "same");
    await expect(page.locator(".page-in")).toHaveCount(1);
  });

  test("pricing: plan prices from the database", async ({ page }) => {
    await page.goto("/pricing");
    const pricing = page.locator("#pricing");
    await expect(pricing).toContainText("₹10,000");
    await expect(pricing).toContainText("₹15,000");
    await expect(pricing).toContainText("10-stock radar");
  });

  test("faq: answers expand, and the page carries FAQ structured data", async ({ page }) => {
    await page.goto("/faq");
    await page.getByText("Is this investment advice?").click();
    await expect(page.getByText("mechanical output of a rule")).toBeVisible();
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.flatMap((t) => (JSON.parse(t) as { "@type": string }[]).map((x) => x["@type"]))).toEqual(expect.arrayContaining(["FAQPage", "BreadcrumbList"]));
  });

  test("old /#section links forward to the new pages", async ({ page }) => {
    await page.goto("/#pricing");
    await expect(page).toHaveURL(/\/pricing$/);
    await page.goto("/#faq");
    await expect(page).toHaveURL(/\/faq$/);
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
    for (const path of ["/method", "/chrome-extension", "/pricing", "/faq"]) expect(map).toContain(path);
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
    for (const path of ["/", "/method", "/chrome-extension", "/pricing", "/faq"]) {
      await page.goto(path);
      expect(await seriousViolations(page)).toEqual([]);
    }
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
