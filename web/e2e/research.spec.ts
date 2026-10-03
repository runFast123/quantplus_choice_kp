import { expect, HOOK_REASON, state, test } from "./helpers/fixtures";

test.describe("research desk", () => {
  test("shows a note for every covered stock with stance counts that add up", async ({ proPage }) => {
    await proPage.goto("/app/research");
    const rows = proPage.locator("tbody tr");
    const total = await rows.count();
    expect(total).toBeGreaterThan(10);
    const counts = await proPage.locator('section[aria-label="Stance counts"] a .num').allTextContents();
    expect(counts.map(Number).reduce((a, b) => a + b, 0)).toBe(total);
  });

  test("stance card filters the table", async ({ proPage }) => {
    await proPage.goto("/app/research");
    await proPage.locator('section[aria-label="Stance counts"] a', { hasText: "cautious" }).click();
    await expect(proPage).toHaveURL(/stance=cautious/);
    // The stance cards keep showing totals for every stance while filtered.
    const counts = (await proPage.locator('section[aria-label="Stance counts"] a .num').allTextContents()).map(Number);
    expect(counts.filter((c) => c > 0).length).toBeGreaterThan(1);
    const stances = await proPage.locator("tbody tr td:nth-child(2) span").first().allTextContents();
    for (const s of stances) expect(s.toLowerCase()).toContain("cautious");
  });

  test("sort select is reflected in the URL", async ({ proPage }) => {
    await proPage.goto("/app/research");
    await proPage.getByLabel("Sort").selectOption("change");
    await expect(proPage).toHaveURL(/sort=change/);
  });
});

test.describe("stock page", () => {
  test("chart, research note with six explained factors, and outbound headlines", async ({ proPage }) => {
    await proPage.goto("/app/markets/INFY");
    await expect(proPage.locator('[role="img"][aria-label*="INFY daily price chart"] canvas').first()).toBeVisible();
    await proPage.getByRole("tab", { name: "3M" }).click();
    await expect(proPage.getByRole("tab", { name: "3M" })).toHaveAttribute("aria-selected", "true");

    const note = proPage.locator("#research");
    await expect(note.getByTestId("factor")).toHaveCount(6);
    for (const label of ["Trend", "Momentum", "52-week range", "Signals", "News tone", "Exchange filings"]) {
      await expect(note.getByTestId("factor").filter({ hasText: label })).toHaveCount(1);
    }
    // Factor values are rounded, never raw floats.
    const values = await note.locator('[aria-label$="of ±2"]').allTextContents();
    for (const v of values) expect(v.replace(/[^0-9.]/g, "").length).toBeLessThanOrEqual(4);

    const links = proPage.locator('a[target="_blank"][href^="http"]');
    if (await links.count()) {
      await expect(links.first()).toHaveAttribute("rel", /noopener/);
    }
  });

  test("Pro without an AI key is told how to add one", async ({ proPage }) => {
    test.skip(!state().hook, HOOK_REASON); // plan features come from the JWT's tenant claim
    await proPage.goto("/app/markets/INFY");
    await expect(proPage.getByText(/Add an Anthropic, OpenAI or Gemini key in/)).toBeVisible();
  });

  test("Basic sees plan gates for alerts and AI reads", async ({ basicPage }) => {
    await basicPage.goto("/app/markets/TCS");
    await expect(basicPage.getByTestId("plan-gate").filter({ hasText: "Price alerts" })).toBeVisible();
    await expect(basicPage.getByText("AI reads with your own key are part of Pro.")).toBeVisible();
  });
});

test.describe("news", () => {
  test("whole-market feed with tone filter", async ({ proPage }) => {
    await proPage.goto("/app/news?scope=all");
    await expect(proPage.locator("main ol > li").first()).toBeVisible();
    await proPage.getByLabel("Tone").selectOption("negative");
    await expect(proPage).toHaveURL(/tone=negative/);
    // Exact badge texts only: headlines themselves can contain words like "positive".
    const badges = await proPage.locator("main ol > li").getByText(/^(\+ positive|− negative|neutral)$/).allTextContents();
    expect(badges.length).toBeGreaterThan(0);
    for (const b of badges) expect(b).toBe("− negative");
  });

  test("only active sources are listed", async ({ proPage }) => {
    await proPage.goto("/app/news?scope=all");
    const sources = proPage.locator("section", { hasText: "How tone is scored" });
    await expect(sources.getByText("Economic Times · Markets")).toBeVisible();
    await expect(sources.getByText("Moneycontrol · Market reports")).toHaveCount(0);
  });

  test("'My stocks' with an empty radar explains itself", async ({ basicPage }) => {
    await basicPage.goto("/app/news");
    await expect(basicPage.getByText(/Nothing on your stocks yet|named/)).toBeVisible();
  });
});
