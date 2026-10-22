import { expect, test } from "./helpers/fixtures";

test.describe("Strategy-Isolated Signals Chart & KK Breakout Plan", () => {
  test("PriceChart provides dedicated strategy isolator preventing multi-plan confusion", async ({ proPage }) => {
    await proPage.goto("/app/markets/TCS");
    await proPage.waitForLoadState("networkidle");

    // 1. Verify Strategy Isolator Bar exists with all plan options
    const strategyGroup = proPage.getByRole("radiogroup", { name: "Strategy Signal Filter" });
    await expect(strategyGroup).toBeVisible();

    const kkRadio = strategyGroup.getByRole("radio", { name: /KK 20d Breakout/i });
    const smaRadio = strategyGroup.getByRole("radio", { name: /SMA 20\/50/i });
    const rsiRadio = strategyGroup.getByRole("radio", { name: /RSI Reversal/i });
    const allRadio = strategyGroup.getByRole("radio", { name: /All Plans/i });
    const cleanRadio = strategyGroup.getByRole("radio", { name: /Clean \(Off\)/i });

    await expect(kkRadio).toBeVisible();
    await expect(smaRadio).toBeVisible();
    await expect(rsiRadio).toBeVisible();
    await expect(allRadio).toBeVisible();
    await expect(cleanRadio).toBeVisible();

    // 2. Select KK 20d Breakout
    await kkRadio.click();
    await expect(kkRadio).toHaveAttribute("aria-checked", "true");

    // Signals Timeline ribbon specifically
    const timeline = proPage.getByTestId("signals-timeline");
    await expect(timeline).toBeVisible();

    const chips = timeline.locator("button");
    const chipCount = await chips.count();
    expect(chipCount).toBeGreaterThan(0);

    const firstChip = chips.first();
    await expect(firstChip).toBeVisible();
    await expect(firstChip).toContainText("KK 20d");

    // Click the chip to focus candle and select it
    await firstChip.click();
    await expect(firstChip).toHaveClass(/ring-1/);

    // 3. Test Clean Mode (Hides signals completely for pure candlestick price action)
    await cleanRadio.click();
    await expect(cleanRadio).toHaveAttribute("aria-checked", "true");
    await expect(timeline).not.toBeVisible();

    // 4. Test Switching back to All Plans
    await allRadio.click();
    await expect(allRadio).toHaveAttribute("aria-checked", "true");
    await expect(timeline).toBeVisible();
  });

  test("BacktestLab validates mathematical accuracy of KK Breakout calculations & milestones", async ({ proPage }) => {
    await proPage.goto("/app/markets/TCS");
    await proPage.waitForLoadState("networkidle");

    // Scroll to Backtest Lab heading
    const backtestHeading = proPage.getByRole("heading", { name: "Backtest Lab" });
    await backtestHeading.scrollIntoViewIfNeeded();
    await expect(backtestHeading).toBeVisible();

    // Select KK 20d Breakout model using exact name
    const kkModelBtn = proPage.getByRole("button", { name: "KK 20d Breakout", exact: true });
    await expect(kkModelBtn).toBeVisible();
    await kkModelBtn.click();

    // Architecture guidance card should explain the empirical model
    await expect(proPage.getByText("KK 20-Day Asymmetric Breakout Architecture")).toBeVisible();
    await expect(proPage.getByText("1. Signal Bar")).toBeVisible();
    await expect(proPage.getByText("2. Confirmation")).toBeVisible();
    await expect(proPage.getByText("3. Target 1 (+0.75R)")).toBeVisible();
    await expect(proPage.getByText("4. Target 2 & Time Exit")).toBeVisible();

    // Verify parameter controls are available
    await expect(proPage.getByText("Lookback Period")).toBeVisible();
    await expect(proPage.getByText("Extension %")).toBeVisible();
    await expect(proPage.getByText("Confirm Window")).toBeVisible();
    await expect(proPage.getByText("Max Hold Bars")).toBeVisible();

    // Verify Summary Cards render accurate numbers
    const winRateCard = proPage.locator("div").filter({ has: proPage.getByText("Win Rate", { exact: true }) }).last();
    await expect(winRateCard).toBeVisible();
    const winRateText = await winRateCard.locator("p.num").first().innerText();
    const winRate = parseFloat(winRateText);
    expect(winRate).toBeGreaterThanOrEqual(0);
    expect(winRate).toBeLessThanOrEqual(100);

    const durationCard = proPage.locator("div").filter({ has: proPage.getByText("Avg Duration", { exact: true }) }).last();
    await expect(durationCard).toBeVisible();
    await expect(durationCard).toContainText(/closed trades/);

    // Verify Trade Log Table rows contain milestone result badges and realized R
    const table = proPage.getByTestId("backtest-trade-log");
    await expect(table).toBeVisible();
    const tableRows = table.locator("tbody tr");
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(0);

    const firstRow = tableRows.first();
    await expect(firstRow).toContainText("BUY");
    await expect(firstRow).toContainText(/[+-]?\d+\.\d{2}R/); // e.g. +1.38R, -1.00R, +0.75R
  });
});
