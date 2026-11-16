import { expect, test } from "@playwright/test";
import { seriousViolations } from "./helpers/axe";
import { expectNoHorizontalOverflow, test as signedInTest } from "./helpers/fixtures";

/** The <html> tag the server sent, straight from the response (before any script has run), and its class list. */
function serverHtmlTag(html: string) {
  const tag = html.match(/<html[^>]*>/)?.[0] ?? "";
  return { tag, classes: (tag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/) };
}

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

  test("signed out: the header and the hero offer an account", async ({ page }) => {
    await page.goto("/");
    const account = page.getByTestId("account-buttons");
    await expect(account.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    await expect(account.getByRole("link", { name: "Open an account" })).toHaveAttribute("href", "/signup");
    await expect(page.locator("main").getByRole("link", { name: "Start free for 3 months" })).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("link", { name: "Open the desk" })).toHaveCount(0);
  });

  test("the note after deleting an account shows on /?deleted=1 only", async ({ page }) => {
    const note = page.getByText("Your account and personal workspace have been deleted.");
    await page.goto("/?deleted=1");
    await expect(note).toBeVisible();
    await expect(note).toHaveAttribute("role", "status");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(note).toHaveCount(0);
  });

  test("theme: the server sends one neutral page, and the cookie sets the class before the page scripts run", async ({ page, context, request, baseURL }) => {
    // prerendered: the same HTML whatever the cookie says, with no theme on <html>
    for (const cookie of ["qp_theme=dark", "qp_theme=light"]) {
      const { tag, classes } = serverHtmlTag(await (await request.get("/", { headers: { cookie } })).text());
      expect(tag).toContain('lang="en-IN"');
      expect(classes).not.toContain("dark");
      expect(classes).not.toContain("light");
      expect(tag).not.toContain("color-scheme");
    }
    const html = page.locator("html");
    const scheme = () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);

    // With every script file blocked, only the inline script in <head> can set the class: this is the first paint.
    await context.addCookies([{ name: "qp_theme", value: "dark", url: baseURL! }]);
    await page.route("**/_next/static/**/*.js", (r) => r.abort());
    await page.goto("/");
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
    await expect(html).not.toHaveClass(/(^|\s)light(\s|$)/);
    expect(await scheme()).toBe("dark");
    await page.unroute("**/_next/static/**/*.js");

    // ...and it is still there after a reload, once React has taken over (the chart only answers keys when it has)
    await page.reload();
    const chart = page.getByRole("slider", { name: /Illustrative price chart/ });
    await chart.focus();
    const before = await chart.getAttribute("aria-valuenow");
    await chart.press("ArrowLeft");
    await expect(chart).not.toHaveAttribute("aria-valuenow", before ?? "");
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
    expect(await scheme()).toBe("dark");

    // the cookie is the source of truth: light (or no cookie) is the light theme
    await context.addCookies([{ name: "qp_theme", value: "light", url: baseURL! }]);
    await page.reload();
    await expect(html).toHaveClass(/(^|\s)light(\s|$)/);
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
    expect(await scheme()).toBe("light");
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
    const choose = pricing.getByRole("link", { name: /^(Start free|Choose )/ });
    await expect(choose).toHaveCount(3);
    for (const a of await choose.all()) await expect(a).toHaveAttribute("href", "/signup");
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

signedInTest.describe("public site, signed in @mobile", () => {
  signedInTest("the header, the hero and the plan buttons lead into the app; the HTML itself stays signed-out", async ({ proPage }) => {
    // prerendered: even with a session cookie the server sends the signed-out page (what a crawler gets)
    const raw = await (await proPage.request.get("/")).text();
    expect(raw).toMatch(/<a[^>]*href="\/signup"[^>]*>Open an account<\/a>/);
    expect(raw).toMatch(/<a[^>]*href="\/login"[^>]*>Sign in<\/a>/);
    expect(raw).not.toContain(">Open the desk<");

    await proPage.emulateMedia({ reducedMotion: "reduce" }); // still boxes to measure
    await proPage.goto("/");
    const account = proPage.getByTestId("account-buttons");
    await expect(account.getByRole("link", { name: "Open the desk" })).toHaveAttribute("href", "/app");
    await expect(account.getByRole("link")).toHaveCount(1);
    const hero = proPage.locator("main section").first();
    const desk = hero.getByRole("link", { name: "Open the desk" });
    await expect(desk).toHaveAttribute("href", "/app");
    const method = hero.getByRole("link", { name: "See the method" });
    const deskBox = (await desk.boundingBox())!;
    const methodBox = (await method.boundingBox())!;

    await proPage.goto("/pricing");
    const choose = proPage.locator("#pricing").getByRole("link", { name: /^(Start free|Choose )/ });
    await expect(choose).toHaveCount(3);
    for (const a of await choose.all()) await expect(a).toHaveAttribute("href", "/app/billing");

    await proPage.goto("/legal/terms");
    await expect(proPage.getByTestId("account-buttons").getByRole("link", { name: "Open the desk" })).toBeVisible();

    // the swap moves nothing: signed out, the hero button is the same size and its neighbour is in the same place
    await proPage.context().clearCookies();
    await proPage.goto("/");
    const start = hero.getByRole("link", { name: "Start free for 3 months" });
    await expect(start).toHaveAttribute("href", "/signup");
    await expect(proPage.getByTestId("account-buttons").getByRole("link")).toHaveCount(2);
    const startBox = (await start.boundingBox())!;
    const methodOut = (await method.boundingBox())!;
    expect(Math.abs(startBox.width - deskBox.width)).toBeLessThan(0.5);
    expect(Math.abs(startBox.height - deskBox.height)).toBeLessThan(0.5);
    expect(Math.abs(methodOut.x - methodBox.x)).toBeLessThan(0.5);
    expect(Math.abs(methodOut.y - methodBox.y)).toBeLessThan(0.5);
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
