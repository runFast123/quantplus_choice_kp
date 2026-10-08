import { pct, price } from "../src/lib/format";
import { anonKey, signInClaims, supabaseUrl } from "./helpers/admin";
import { expect, state, test } from "./helpers/fixtures";

test.describe("markets screener", () => {
  test("sector filter narrows every row to that sector", async ({ proPage }) => {
    await proPage.goto("/app/markets");
    await proPage.getByLabel("Sector").selectOption("Technology");
    await expect(proPage).toHaveURL(/sector=Technology/);
    const sectors = await proPage.locator("tbody tr td:nth-child(2)").allTextContents();
    expect(sectors.length).toBeGreaterThan(0);
    for (const s of sectors) expect(s).toBe("Technology");
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
    await proPage.goto("/app/markets?sector=Technology&rsi=overbought");
    await proPage.getByRole("button", { name: "Clear" }).click();
    await expect(proPage).toHaveURL(/\/app\/markets$/);
  });
});

test.describe("whole market", () => {
  test("every listed stock, paged, largest first", async ({ proPage }) => {
    await proPage.goto("/app/markets");
    const title = await proPage.locator("main h2", { hasText: /symbols$/ }).first().innerText();
    expect(Number(title.replace(/[^0-9]/g, ""))).toBeGreaterThan(2000);
    await expect(proPage.locator("tbody tr")).toHaveCount(100);
    await expect(proPage.getByRole("navigation", { name: "Pages" })).toContainText("Page 1 of");
    await proPage.getByRole("link", { name: "Next" }).click();
    await expect(proPage).toHaveURL(/page=2/);
    await expect(proPage.locator("tbody tr")).toHaveCount(100);
  });

  test("segments: indices, ETFs and SME are separate", async ({ proPage }) => {
    await proPage.goto("/app/markets?segment=index");
      await expect(proPage.locator("table tbody").first()).toContainText("BANKNIFTY");
    await proPage.goto("/app/markets?segment=etf");
      // ETFs are sorted by mcap_rank; just verify the table shows ETF data
      await expect(proPage.locator("table tbody").first()).toContainText("ETF");
      await proPage.goto("/app/markets?segment=sme");
      expect(await proPage.locator("table tbody").first().locator("tr").count()).toBeGreaterThan(10);
    });

  test("search finds any listed company and Tata Motors' successors", async ({ proPage }) => {
    await proPage.goto("/app/markets");
    const box = proPage.getByRole("combobox", { name: "Search stocks" });
    await box.fill("tata motors");
    const options = proPage.getByRole("option");
    await expect(options.filter({ hasText: "TMPV" })).toHaveCount(1);
    await expect(options.filter({ hasText: "TMCV" })).toHaveCount(1);
    await box.fill("nifty bank");
    await expect(options.first()).toContainText("BANKNIFTY");
  });

  test("a retired symbol explains itself instead of a 404", async ({ proPage }) => {
    await proPage.goto("/app/markets/TATAMOTORS");
    await expect(proPage.getByText("NSE · no longer trades")).toBeVisible();
    await expect(proPage.getByText(/demerged on 14 Oct 2025/)).toBeVisible();
    await proPage.getByRole("link", { name: "TMPV" }).first().click();
    await expect(proPage).toHaveURL(/\/app\/markets\/TMPV$/);
  });
});

test.describe("numbers on screen match the database", () => {
  test("symbol page: close, previous close, RSI, SMAs and 52-week range", async ({ proPage, request }) => {
    const { users } = state();
    const { token } = await signInClaims(users.pro.email, users.pro.password);
    const h = { apikey: anonKey, authorization: `Bearer ${token}` };
    const [snap] = await (await request.get(`${supabaseUrl}/rest/v1/market_snapshot?select=*&symbol=eq.TCS`, { headers: h })).json();
    const candles: { close: string }[] = await (
      await request.get(`${supabaseUrl}/rest/v1/market_candles?select=close&symbol=eq.TCS&interval=eq.1d&order=ts.desc&limit=200`, { headers: h })
    ).json();
    const closes = candles.map((c) => Number(c.close));
    const sma = (n: number) => closes.slice(0, n).reduce((a, b) => a + b, 0) / n;

    await proPage.goto("/app/markets/TCS");
    const header = proPage.locator("main header").first();
    await expect(header).toContainText(`₹${price(Number(snap.last_price))}`);
    await expect(header).toContainText(pct(Number(snap.change_pct)).replace(/^[+−]/, ""));
    const level = (label: string) => proPage.locator("dl > div").filter({ has: proPage.getByText(label, { exact: true }) }).locator("dd .num");
    await expect(level("Prev close")).toHaveText(price(Number(snap.prev_close)));
    await expect(level("RSI 14")).toHaveText(Number(snap.rsi).toFixed(1));
    await expect(level("SMA 20")).toHaveText(price(sma(20)));
    await expect(level("SMA 50")).toHaveText(price(sma(50)));
    await expect(level("SMA 200")).toHaveText(price(sma(200)));
    const range = proPage.locator("dt", { hasText: "52-week range" }).locator("..");
    await expect(range).toContainText(price(Number(snap.low_52w)));
    await expect(range).toContainText(price(Number(snap.high_52w)));
  });
});
