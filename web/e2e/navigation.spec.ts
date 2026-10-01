import { expect, expectNoHorizontalOverflow, test } from "./helpers/fixtures";

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

  test("ticker tape is labelled as sample prices", async ({ proPage }) => {
    await proPage.goto("/app");
    await expect(proPage.getByText("Sample prices")).toBeVisible();
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
