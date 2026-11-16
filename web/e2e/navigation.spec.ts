import { expect, expectNoHorizontalOverflow, test } from "./helpers/fixtures";
import { env } from "./helpers/env";

const PAGES: [string, RegExp][] = [
  ["/app", /Good (morning|afternoon|evening)/],
  ["/app/markets", /^Markets$/],
  ["/app/markets/INFY", /Infosys/],
  ["/app/watchlist", /Market Radar/],
  ["/app/portfolio", /Portfolio/],
  ["/app/alerts", /Alerts/],
  ["/app/signals", /Signals/],
  ["/app/research", /Research desk/],
  ["/app/news", /News/],
  ["/app/workspace", /workspace/i],
  ["/app/integrations", /Integrations/],
  ["/app/billing", /Plan & billing/],
  ["/app/settings", /Settings/],
];

test.describe("every page renders @mobile", () => {
  for (const [path, heading] of PAGES) {
    test(`${path} loads without errors or sideways scroll`, async ({ proPage, consoleErrors }) => {
      await proPage.goto(path);
      await expect(proPage.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expectNoHorizontalOverflow(proPage);
      expect(consoleErrors).toEqual([]);
    });
  }
});

test.describe("shell", () => {
  test("'/' focuses stock search; Enter opens the stock", async ({ proPage }) => {
    await proPage.goto("/app/markets");
    await proPage.locator("body").click({ position: { x: 5, y: 300 } });
    await proPage.keyboard.press("/");
    await expect(proPage.getByRole("combobox", { name: "Search stocks" })).toBeFocused();
    await proPage.keyboard.type("infos");
    await expect(proPage.getByRole("option").first()).toContainText("INFY");
    await proPage.keyboard.press("Enter");
    await expect(proPage).toHaveURL(/\/app\/markets\/INFY$/);
  });

  test("theme toggle switches to dark and survives a reload", async ({ proPage }) => {
    await proPage.goto("/app");
    await proPage.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(proPage.locator("html")).toHaveClass(/dark/);
    await proPage.reload();
    await expect(proPage.locator("html")).toHaveClass(/dark/);
    await proPage.getByRole("button", { name: "Switch to light theme" }).click();
    await expect(proPage.locator("html")).not.toHaveClass(/dark/);
  });

  test("signed in too, the theme class comes from the cookie in the browser, before the app scripts run", async ({ proPage }, info) => {
    await proPage.context().addCookies([{ name: "qp_theme", value: "dark", url: info.project.use.baseURL! }]);
    // the server reads the cookie for the toggle icon only; <html> leaves the theme to the inline script
    const tag = (await (await proPage.request.get("/app")).text()).match(/<html[^>]*>/)?.[0] ?? "";
    expect(tag).toContain('lang="en-IN"');
    expect(tag).not.toMatch(/[\s"](dark|light)[\s"]/);
    await proPage.route("**/_next/static/**/*.js", (r) => r.abort());
    await proPage.goto("/app");
    await expect(proPage.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
    expect(await proPage.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
    await proPage.unroute("**/_next/static/**/*.js");
    await proPage.reload();
    await expect(proPage.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
    await expect(proPage.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
  });

  test("prices name their source", async ({ proPage }) => {
    await proPage.goto("/app/markets");
    const synthetic = env().NEXT_PUBLIC_MARKET_DATA_MODE === "synthetic";
    await expect(proPage.locator("main header").getByText(synthetic ? /sample data/ : /Yahoo Finance/)).toBeVisible();
    await proPage.goto("/app");
    await expect(proPage.getByText("Sample prices")).toHaveCount(synthetic ? 1 : 0);
  });

  test("workspace menu lists the personal workspace", async ({ proPage }) => {
    await proPage.goto("/app");
    await proPage.getByRole("button", { name: /Personal|No workspace/ }).click();
    await expect(proPage.getByRole("menuitemradio", { name: /Personal/ })).toBeVisible();
    await expect(proPage.getByRole("link", { name: "New organisation" })).toBeVisible();
  });

  test("notifications panel opens", async ({ proPage }) => {
    await proPage.goto("/app");
    await proPage.getByRole("button", { name: /^Notifications/ }).click();
    await expect(proPage.getByRole("dialog", { name: "Notifications" })).toBeVisible();
  });
});

test.describe("phone navigation @mobile", () => {
  test("every page is reachable from the bottom bar, and search is available", async ({ proPage }) => {
    test.skip(proPage.viewportSize()!.width >= 768, "phone layout only");
    await proPage.goto("/app");
    await expect(proPage.getByRole("combobox", { name: "Search stocks" })).toBeVisible();
    for (const [label, path] of [["Alerts", "/app/alerts"], ["Signals", "/app/signals"], ["Research", "/app/research"], ["News", "/app/news"], ["Integrations", "/app/integrations"]] as const) {
      await proPage.getByRole("button", { name: "More" }).click();
      await proPage.getByRole("dialog", { name: "More pages" }).getByRole("link", { name: label }).click();
      await expect(proPage).toHaveURL(new RegExp(`${path}$`));
    }
  });
});
