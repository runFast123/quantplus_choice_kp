import { price, rupees } from "../src/lib/format";
import { anonKey, removeTrades, seedTrades, signInClaims, supabaseUrl } from "./helpers/admin";
import { expect, expectNoHorizontalOverflow, HOOK_REASON, state, test } from "./helpers/fixtures";

/**
 * Step D (ADR-050): your trades next to the rules' trades. A buy and a sale are placed inside a real, closed
 * SMA 20/50 trend trade in BAJAJ-AUTO (read from public.rule_trades when the test runs), and the page's numbers are
 * checked against it. BAJAJ-AUTO keeps this file apart from the other portfolio tests.
 */
test.skip(() => !state().hook, HOOK_REASON);
test.describe.configure({ mode: "serial" });

const SYMBOL = "BAJAJ-AUTO";
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
type RuleTrade = { entry_day: string; entry_price: string; exit_day: string; exit_price: string; exit_entry_fill: string | null };
let t: RuleTrade;

test.beforeAll(async () => {
  const { users } = state();
  const { token } = await signInClaims(users.pro.email, users.pro.password);
  const rows: RuleTrade[] = await (
    await fetch(
      `${supabaseUrl}/rest/v1/rule_trades?select=entry_day,entry_price,exit_day,exit_price,exit_entry_fill&symbol=eq.${SYMBOL}&strategy=eq.sma_trend&exit_day=not.is.null&order=entry_day.desc`,
      { headers: { apikey: anonKey, authorization: `Bearer ${token}` } },
    )
  ).json();
  const found = rows.find((r) => Date.parse(r.exit_day) - Date.parse(r.entry_day) > 40 * 86_400_000);
  if (!found) throw new Error(`no closed SMA 20/50 trend trade of 40+ days in ${SYMBOL}`);
  t = found;
  await removeTrades(users.pro.id, SYMBOL);
  // You bought a week after the rule, ₹100 a share higher, and sold two weeks later, ₹200 under the rule's sale.
  await seedTrades(users.pro.id, SYMBOL, [
    { kind: "buy", trade_date: addDays(t.entry_day, 7), quantity: 10, price: Number(t.entry_price) + 100 },
    { kind: "sell", trade_date: addDays(t.entry_day, 21), quantity: 10, price: Number(t.exit_price) - 200 },
  ]);
});

test.afterAll(async () => {
  await removeTrades(state().users.pro.id, SYMBOL);
});

test("each buy and sale next to the rule's whole trade, worked out on your money", async ({ proPage }) => {
  await proPage.goto("/app/portfolio");
  await proPage.getByTestId("compare-link").click();
  await expect(proPage).toHaveURL(/\/app\/portfolio\/compare$/);
  await expect(proPage.getByTestId("compare-summary")).toContainText("a rule was in the stock for");
  await expect(proPage.getByTestId("compare-rules")).toContainText("SMA 20/50 trend");

  await proPage.goto(`/app/portfolio/compare?stock=${SYMBOL}&rule=sma_trend`);
  const entry = Number(t.entry_price);
  const exit = Number(t.exit_price);
  const card = proPage.getByTestId("compare-buy").filter({ hasText: `Your buy of` }).first();
  await expect(card.getByTestId("paid-less")).toHaveText("You would have paid ₹100.00 a share less (₹1,000.00 on your 10 shares).");
  // The rule's whole trade with your ₹ (entry + 100) × 10, against your 10 shares sold ₹200 under its sale.
  const money = 10 * (entry + 100);
  const ruleGain = Math.round(money * (exit / Number(t.exit_entry_fill ?? entry) - 1) * 100) / 100;
  const yourGain = 10 * (exit - 200 - (entry + 100));
  const more = Math.round((ruleGain - yourGain) * 100) / 100;
  await expect(card.getByTestId("made-more")).toContainText(`You would have made ${rupees(Math.abs(more))} ${more > 0 ? "more" : "less"}`);
  await expect(card).toContainText(`at ${price(entry)}`);
  await expect(card).toContainText("Sold");
  await expect(card).toContainText("Past research, not advice.");

  const sale = proPage.getByTestId("compare-sale").first();
  await expect(sale.getByTestId("sale-more")).toContainText("Selling with the rule, you would have made ₹2,000.00 more");
  await expect(sale).toContainText(`at ${price(exit)}`);

  // Filters: the rule did worse → this sale isn't listed (the rule did better).
  await proPage.goto(`/app/portfolio/compare?stock=${SYMBOL}&rule=sma_trend&show=sales&outcome=worse`);
  await expect(proPage.getByText("Nothing matches these filters.")).toBeVisible();
});

test("the stock's history shows the same comparison; phones don't scroll sideways", async ({ proPage }) => {
  await proPage.goto(`/app/portfolio/${SYMBOL}`);
  const section = proPage.getByTestId("stock-compare");
  await expect(section.getByTestId("compare-buy").filter({ hasText: "SMA 20/50 trend" }).first()).toBeVisible();
  await expect(section.getByTestId("compare-sale").filter({ hasText: "SMA 20/50 trend" }).first()).toContainText("₹2,000.00 more");

  await proPage.setViewportSize({ width: 375, height: 812 });
  await proPage.goto(`/app/portfolio/compare?stock=${SYMBOL}`);
  await expect(proPage.getByTestId("compare-list")).toBeVisible();
  await expectNoHorizontalOverflow(proPage);
});

test("Basic users see the plan gate", async ({ basicPage }) => {
  await basicPage.goto("/app/portfolio/compare");
  await expect(basicPage.getByTestId("plan-gate")).toBeVisible();
});
