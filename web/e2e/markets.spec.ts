import { expect, test } from "./helpers/fixtures";

test.describe("markets screener", () => {
  test("sector filter narrows every row to that sector", async ({ proPage }) => {
    await proPage.goto("/app/markets");
    await proPage.getByLabel("Sector").selectOption("IT");
    await expect(proPage).toHaveURL(/sector=IT/);
    const sectors = await proPage.locator("tbody tr td:nth-child(2)").allTextContents();
    expect(sectors.length).toBeGreaterThan(0);
    for (const s of sectors) expect(s).toBe("IT");
  });

  test("oversold filter only shows RSI at or below 30", async ({ proPage }) => {
    await proPage.goto("/app/markets?rsi=oversold");
    const rsis = (await proPage.locator("tbody tr td:nth-child(7)").allTextContents()).map(Number);
    for (const r of rsis) expect(r).toBeLessThanOrEqual(30);
  });

  test("top losers sort puts the weakest first", async ({ proPage }) => {
    await proPage.goto("/app/markets?sort=laggards");
    const first = await proPage.locator("tbody tr").first().locator("td:nth-child(4)").innerText();
    expect(first).toMatch(/−|0\.00/);
  });

  test("clear removes filters", async ({ proPage }) => {
    await proPage.goto("/app/markets?sector=IT&rsi=overbought");
    await proPage.getByRole("button", { name: "Clear" }).click();
    await expect(proPage).toHaveURL(/\/app\/markets$/);
  });
});
