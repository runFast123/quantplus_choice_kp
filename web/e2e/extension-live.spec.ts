import { chromium, expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AUTH_DIR } from "./helpers/env";

/**
 * The real Chrome extension, loaded unpacked into Chrome and driven over the DevTools protocol:
 * background worker, sign-in sync from the website, side panel, options page and the chart detector.
 * Every console error, page error and worker error fails the test.
 *
 * Needs the app on http://localhost:3000 (one of the extension's two allowed backends) and a
 * headed Chrome, so it is skipped unless EXTENSION_E2E=1:
 *   EXTENSION_E2E=1 E2E_PORT=3000 npx playwright test e2e/extension-live.spec.ts
 */
test.skip(!process.env.EXTENSION_E2E, "Set EXTENSION_E2E=1 and E2E_PORT=3000 to run the live extension check.");
test.describe.configure({ mode: "serial" });

// The extension worker's `chrome` API, as far as these tests call it (inside sw.evaluate).
declare const chrome: {
  storage: { local: { get(keys: string[]): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> } };
  runtime: { getManifest(): { version: string; manifest_version: number } };
};

const EXT_DIR =resolve(__dirname, "..", "..", "extension");
const BACKEND = "http://localhost:3000";
// Third-party pages log their own errors; only ours count there.
const OURS = /chrome-extension:\/\/|QuantsPulse|qp-/i;

let ctx: BrowserContext;
let sw: Worker;
let extId: string;
const errors: string[] = [];

function watch(page: Page, label: string, all: boolean) {
  page.on("pageerror", (e) => (all || OURS.test(`${e.message} ${e.stack}`)) && errors.push(`[${label}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const where = m.location().url ?? "";
    if (all || where.startsWith("chrome-extension://") || OURS.test(m.text())) errors.push(`[${label}] console.${m.type()}: ${m.text()} (${where}:${m.location().lineNumber})`);
  });
}

const storage = (keys: string[]) => sw.evaluate((k) => chrome.storage.local.get(k), keys) as Promise<Record<string, unknown>>;

test.beforeAll(async () => {
  ctx = await chromium.launchPersistentContext("", {
    // Branded Chrome no longer side-loads extensions from the command line; Playwright's Chromium does.
    // EXTENSION_CHROME points at a Chromium build when Playwright's own revision isn't installed.
    ...(process.env.EXTENSION_CHROME ? { executablePath: process.env.EXTENSION_CHROME } : { channel: "chromium" }),
    headless: false,
    viewport: { width: 1280, height: 860 },
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
    ],
  });
  sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  extId = new URL(sw.url()).host;
  ctx.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && (m.location().url ?? "").startsWith(`chrome-extension://${extId}/background`))
      errors.push(`[worker] console.${m.type()}: ${m.text()}`);
  });
  // Catch anything the worker throws from here on.
  await sw.evaluate(() => {
    const g = self as unknown as { __qpErrors: string[] };
    g.__qpErrors = [];
    self.addEventListener("error", (e) => g.__qpErrors.push(`error: ${(e as ErrorEvent).message}`));
    self.addEventListener("unhandledrejection", (e) => g.__qpErrors.push(`unhandledrejection: ${String((e as PromiseRejectionEvent).reason)}`));
  });
  await sw.evaluate((b) => chrome.storage.local.set({ backendUrl: b }), BACKEND);
});

test.afterAll(async () => {
  await ctx?.close();
});

test("the background worker starts on the current manifest", async () => {
  const m = (await sw.evaluate(() => chrome.runtime.getManifest())) as { version: string; manifest_version: number };
  expect(m.manifest_version).toBe(3);
  expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
});

test("signed out: the side panel asks to sign in", async ({}, info) => {
  const panel = await ctx.newPage();
  watch(panel, "sidepanel", true);
  await panel.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
  await sw.evaluate(() => chrome.storage.local.set({ activeSymbol: "TCS" }));
  await expect(panel.locator("#state-locked")).toBeVisible();
  await expect(panel.locator("#btn-auth-login")).toBeVisible();
  await panel.screenshot({ path: info.outputPath("sidepanel-signed-out.png") });
  await panel.close();
});

test("signing in on the website signs the extension in", async () => {
  const st = JSON.parse(readFileSync(join(AUTH_DIR, "pro.json"), "utf8")) as { cookies: Parameters<BrowserContext["addCookies"]>[0] };
  await ctx.addCookies(st.cookies);
  const site = await ctx.newPage();
  watch(site, "website", false); // the site's own logs are covered by the main suite
  await site.goto(`${BACKEND}/app`);
  await expect.poll(async () => (await storage(["qpAuthenticated"])).qpAuthenticated, { timeout: 15_000 }).toBe(true);
  const s = await storage(["qpAuthToken", "qpUser"]);
  expect(typeof s.qpAuthToken).toBe("string");
  expect(s.qpUser).toBeTruthy();
  await site.close();
});

test("signed in: the side panel shows a stock, its signal, plan and levels", async ({}, info) => {
  const panel = await ctx.newPage();
  watch(panel, "sidepanel", true);
  await panel.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
  await panel.locator("#symbol-input").fill("INFY");
  await panel.locator("#symbol-input").press("Enter");
  await expect(panel.locator("#content")).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator("#stock-symbol")).toHaveText(/INFY/);
  await expect(panel.locator("#stock-price")).toHaveText(/\d/);
  await expect(panel.locator("#user-auth-email")).not.toBeEmpty();
  await panel.screenshot({ path: info.outputPath("sidepanel-signal.png") });
  for (const tab of ["#tab-plan", "#tab-levels", "#tab-signal"]) {
    await panel.locator(tab).click();
    await expect(panel.locator(`#panel-${tab.slice(5)}`)).toBeVisible();
  }
  await panel.locator("#tab-levels").click();
  await panel.screenshot({ path: info.outputPath("sidepanel-levels.png") });
  // A symbol that doesn't exist shows an error state, not a crash.
  await panel.locator("#symbol-input").fill("NOTAREALSYMBOLX");
  await panel.locator("#symbol-input").press("Enter");
  await expect(panel.locator("#state-error:visible, #state-empty:visible")).toHaveCount(1, { timeout: 15_000 });
  await panel.screenshot({ path: info.outputPath("sidepanel-unknown.png") });
  await panel.close();
});

test("the options page loads and saves", async ({}, info) => {
  const opts = await ctx.newPage();
  watch(opts, "options", true);
  await opts.goto(`chrome-extension://${extId}/options/options.html`);
  await expect(opts.locator("#opt-overlay")).toBeVisible();
  await opts.locator("#opt-overlay").click();
  await opts.locator("#opt-overlay").click();
  await opts.screenshot({ path: info.outputPath("options.png") });
  await opts.close();
});

test("on a TradingView chart the detector finds the symbol", async ({}, info) => {
  test.slow();
  await sw.evaluate(() => chrome.storage.local.set({ activeSymbol: null }));
  const chart = await ctx.newPage();
  watch(chart, "tradingview", false);
  await chart.goto("https://in.tradingview.com/chart/?symbol=NSE%3ARELIANCE", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await expect.poll(async () => (await storage(["activeSymbol"])).activeSymbol, { timeout: 30_000 }).toBe("RELIANCE");
  await chart.waitForTimeout(4000); // let the on-chart overlay fetch and draw
  await chart.screenshot({ path: info.outputPath("tradingview.png") });
  await chart.close();
});

test("signing out on the website signs the extension out", async () => {
  await ctx.clearCookies();
  const site = await ctx.newPage();
  await site.goto(`${BACKEND}/login`);
  await expect.poll(async () => (await storage(["qpAuthenticated"])).qpAuthenticated, { timeout: 15_000 }).toBe(false);
  expect((await storage(["qpAuthToken"])).qpAuthToken).toBeUndefined();
  await site.close();
});

test("no errors anywhere", async () => {
  const workerErrors = (await sw.evaluate(() => (self as unknown as { __qpErrors: string[] }).__qpErrors)) ?? [];
  expect([...errors, ...workerErrors.map((e) => `[worker] ${e}`)]).toEqual([]);
});
