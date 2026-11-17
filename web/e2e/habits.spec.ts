import { anonKey, removeTrades, seedTrades, signInClaims, supabaseUrl } from "./helpers/admin";
import { expect, expectNoHorizontalOverflow, HOOK_REASON, state, test } from "./helpers/fixtures";

/**
 * The two paid features of 17 Nov 2026: "Your trading habits" (the Behaviour mirror, lib/behaviour-mirror.ts) and
 * "Am I too late?" on the stock page (lib/head-start.ts). Six round trips in HCLTECH, which keeps this file apart from
 * the other portfolio tests: three winners kept 10 days, three losers kept 40, so the mirror reads "about 4.0 times as
 * long". Prices are made up; the mirror only compares your own buys and sales here.
 */
test.skip(() => !state().hook, HOOK_REASON);
test.describe.configure({ mode: "serial" });

const SYMBOL = "HCLTECH";
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

test.beforeAll(async () => {
  const { users } = state();
  await removeTrades(users.pro.id, SYMBOL);
  const trades: { kind: "buy" | "sell"; trade_date: string; quantity: number; price: number }[] = [];
  let day = "2025-06-02";
  for (let i = 0; i < 6; i++) {
    const win = i % 2 === 0;
    trades.push({ kind: "buy", trade_date: day, quantity: 10, price: 1000 });
    trades.push({ kind: "sell", trade_date: addDays(day, win ? 10 : 40), quantity: 10, price: win ? 1100 : 900 });
    day = addDays(day, 50);
  }
  await seedTrades(users.pro.id, SYMBOL, trades);
});

test.afterAll(async () => {
  await removeTrades(state().users.pro.id, SYMBOL);
});

test("your trading habits read from your own buys and sales", async ({ proPage }) => {
  await proPage.goto("/app/portfolio");
  await proPage.getByTestId("mirror-link").click();
  await expect(proPage).toHaveURL(/\/app\/portfolio\/mirror$/);
  await expect(proPage.getByRole("heading", { level: 1, name: "Your trading habits" })).toBeVisible();
  await expect(proPage.getByText(/You kept losing trades about 4\.0 times as long as winning ones \(40 days against 10/)).toBeVisible();
  await expect(proPage.getByText("Your average win was +10% and your average loss −10%.", { exact: false })).toBeVisible();
  await expect(proPage.getByText("These describe what happened, not what to do next.", { exact: false })).toBeVisible();
});

test("Am I too late? shows the stage and the rules' tested trades", async ({ proPage }) => {
  await proPage.goto(`/app/markets/${SYMBOL}`);
  await expect(proPage.getByRole("heading", { level: 2, name: "Am I too late?" })).toBeVisible();
  await expect(proPage.getByText(/above its 1-year low of/)).toBeVisible();
  const table = proPage.getByRole("table").filter({ hasText: "Made money" });
  await expect(table).toContainText("Strong trend");
  await expect(table).toContainText("RSI dip");
  await expect(proPage.getByText("Past results, not a forecast or advice.", { exact: false })).toBeVisible();
});

test("Stay-in Plan: the card on a stock a trend rule bought, and the off-by-default message choice", async ({ proPage }) => {
  const { users } = state();
  const { token } = await signInClaims(users.pro.email, users.pro.password);
  const [latest]: { symbol: string }[] = await (
    await fetch(
      `${supabaseUrl}/rest/v1/trading_signals?select=symbol&signal_type=eq.buy&strategy=in.(strong_trend,sma_trend,ma200_trend,secular_trend)&order=generated_at.desc&limit=1`,
      { headers: { apikey: anonKey, authorization: `Bearer ${token}` } },
    )
  ).json();
  test.skip(!latest, "no trend-rule buy stored yet");
  await proPage.goto(`/app/markets/${latest.symbol}`);
  await expect(proPage.getByRole("heading", { level: 2, name: "Stay-in Plan" })).toBeVisible();
  await expect(proPage.getByText(/still holding|ended/).first()).toBeVisible();
  await expect(proPage.getByRole("table").filter({ hasText: "60-session plan" })).toContainText("Jan 2024 – Oct 2026");

  await proPage.goto("/app/settings?tab=notifications");
  const choice = proPage.getByTestId("stay-in-choice");
  await expect(choice).toBeEnabled();
  await expect(choice).not.toBeChecked();
  await choice.check();
  await proPage.getByRole("button", { name: "Save choices" }).click();
  await expect(proPage.getByText("Saved.", { exact: false })).toBeVisible();
  await proPage.reload();
  await expect(proPage.getByTestId("stay-in-choice")).toBeChecked();
  await proPage.getByTestId("stay-in-choice").uncheck();
  await proPage.getByRole("button", { name: "Save choices" }).click();
  await expect(proPage.getByText("Saved.", { exact: false })).toBeVisible();
});

test("Basic sees the plan card instead; phones don't scroll sideways", async ({ basicPage, proPage }) => {
  await basicPage.goto("/app/portfolio/mirror");
  await expect(basicPage.getByTestId("plan-gate")).toBeVisible();
  await basicPage.goto("/app/settings?tab=notifications");
  await expect(basicPage.getByTestId("stay-in-choice")).toBeDisabled();

  await proPage.setViewportSize({ width: 375, height: 812 });
  await proPage.goto("/app/portfolio/mirror");
  await expectNoHorizontalOverflow(proPage);
  await proPage.goto(`/app/markets/${SYMBOL}`);
  await expectNoHorizontalOverflow(proPage);
});
