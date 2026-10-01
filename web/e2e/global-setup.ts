import { chromium, type FullConfig } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createUser, signInClaims } from "./helpers/admin";
import { AUTH_DIR } from "./helpers/env";

/**
 * Creates two disposable users (Basic trial, Pro) with consents already
 * recorded, signs each in through the real login form, and saves the browser
 * state. Detects whether the access-token hook is on.
 */
export default async function globalSetup(config: FullConfig) {
  mkdirSync(AUTH_DIR, { recursive: true });
  const basic = await createUser("basic", "basic");
  const pro = await createUser("pro", "pro", ["terms", "privacy_policy", "ai_processing"]);
  const { claims } = await signInClaims(pro.email, pro.password);
  const hook = Boolean(claims.app_tenant_id);
  writeFileSync(join(AUTH_DIR, "state.json"), JSON.stringify({ hook, users: { basic, pro } }, null, 2));

  const baseURL = config.projects[0].use.baseURL!;
  const browser = await chromium.launch({ channel: "chrome" });
  for (const [name, u] of [["basic", basic], ["pro", pro]] as const) {
    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(u.email);
    await page.getByLabel("Password").fill(u.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/app");
    await ctx.storageState({ path: join(AUTH_DIR, `${name}.json`) });
    await ctx.close();
  }
  await browser.close();
  console.log(`[e2e] users ready · access-token hook ${hook ? "ENABLED" : "NOT enabled — write tests will be skipped"}`);
}
