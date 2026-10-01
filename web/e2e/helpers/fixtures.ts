import { test as base, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTH_DIR } from "./env";
import type { TestUser } from "./admin";

type State = { hook: boolean; users: Record<"basic" | "pro", TestUser> };
export const state = (): State => JSON.parse(readFileSync(join(AUTH_DIR, "state.json"), "utf8"));

export const HOOK_REASON =
  "Supabase custom_access_token_hook is not enabled (Auth → Hooks). Tenant-scoped writes are blocked by RLS until it is.";

/** Pages signed in as the pre-made Basic / Pro users, with console errors collected. */
export const test = base.extend<{ basicPage: Page; proPage: Page; consoleErrors: string[] }>({
  consoleErrors: async ({}, provide) => provide([]),
  basicPage: async ({ browser, consoleErrors }, provide) => {
    const ctx = await browser.newContext({ storageState: join(AUTH_DIR, "basic.json") });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => consoleErrors.push(e.message));
    await provide(page);
    await ctx.close();
  },
  proPage: async ({ browser, consoleErrors }, provide) => {
    const ctx = await browser.newContext({ storageState: join(AUTH_DIR, "pro.json") });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => consoleErrors.push(e.message));
    page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && consoleErrors.push(m.text()));
    await provide(page);
    await ctx.close();
  },
});
export { expect };

/** Fails with the offending elements if the page scrolls sideways. */
export async function expectNoHorizontalOverflow(page: Page) {
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad = [...document.querySelectorAll("body *")].filter((el) => {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.right <= vw + 1) return false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "hidden" || o === "scroll" || o === "clip") return false;
      }
      return getComputedStyle(el).position !== "fixed";
    });
    const outer = bad.filter((el) => !bad.includes(el.parentElement as Element));
    return {
      sw: document.documentElement.scrollWidth,
      vw,
      offenders: outer.slice(0, 5).map((el) => `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 70)}"> right=${Math.round(el.getBoundingClientRect().right)}`),
    };
  });
  expect(r.sw, `horizontal overflow: ${r.offenders.join(" | ")}`).toBeLessThanOrEqual(r.vw);
}
