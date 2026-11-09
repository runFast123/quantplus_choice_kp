import { date, rupees } from "../src/lib/format";
import { anonKey, signInClaims, supabaseUrl } from "./helpers/admin";
import { expect, expectNoHorizontalOverflow, state, test } from "./helpers/fixtures";

/**
 * The price guard (ADR-053): a stock with a day whose price was set aside says so under its chart, in plain words, with
 * the prices from public.candle_checks_review (read when the test runs: the newest flagged day of a top-500 company).
 */
type Check = { symbol: string; day: string; prev_close: string; close: string; status: string };
let flagged: Check | undefined;
let clean: string | undefined;

test.beforeAll(async () => {
  const { users } = state();
  const { token } = await signInClaims(users.basic.email, users.basic.password);
  const get = async (path: string) =>
    (await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: { apikey: anonKey, authorization: `Bearer ${token}` } })).json();
  const top: { symbol: string }[] = await get("market_symbols?select=symbol&mcap_rank=lte.500&order=mcap_rank&limit=500");
  const names = new Set(top.map((t) => t.symbol));
  const checks: Check[] = await get("candle_checks_review?select=symbol,day,prev_close,close,status&status=in.(suspect,bad)&exchange=eq.NSE&order=day.desc&limit=200");
  flagged = checks.find((c) => names.has(c.symbol));
  const withFlag = new Set(checks.map((c) => c.symbol));
  clean = top.map((t) => t.symbol).find((s) => !withFlag.has(s));
});

test("a stock with a price set aside says so under the chart", async ({ basicPage }) => {
  test.skip(!flagged, "no flagged day among the 500 largest right now");
  const k = flagged!;
  await basicPage.goto(`/app/markets/${encodeURIComponent(k.symbol)}`);
  const note = basicPage.getByTestId("price-set-aside");
  await expect(note).toContainText("A price we set aside");
  await expect(note).toContainText(`On ${date(k.day)} Yahoo's`);
  await expect(note).toContainText(`(${rupees(Number(k.prev_close))} the day before, ${rupees(Number(k.close))} that day)`);
  await expect(note).toContainText(k.status === "bad" ? "We checked it and set it aside" : "Until it is checked, our rules use the close for that day.");
  await expectNoHorizontalOverflow(basicPage);
});

test("a stock without one shows no note", async ({ basicPage }) => {
  test.skip(!clean, "every large company has a flagged day");
  await basicPage.goto(`/app/markets/${encodeURIComponent(clean!)}`);
  await expect(basicPage.getByTestId("at-a-glance")).toBeVisible();
  await expect(basicPage.getByTestId("price-set-aside")).toHaveCount(0);
});
