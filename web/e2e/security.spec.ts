import { expect, test } from "@playwright/test";
import { anonKey, signInClaims, supabaseUrl } from "./helpers/admin";
import { state } from "./helpers/fixtures";

/** Data-isolation checks from the outside, through the same API the app uses. */
test.describe("security boundaries", () => {
  test("anonymous callers can read plans and nothing else", async ({ request }) => {
    const h = { apikey: anonKey };
    expect((await request.get(`${supabaseUrl}/rest/v1/plans?select=code`, { headers: h })).status()).toBe(200);
    for (const t of ["profiles", "holdings", "watchlist_items", "price_alerts", "payments", "audit_log", "market_snapshot", "research_notes", "news_articles"]) {
      expect((await request.get(`${supabaseUrl}/rest/v1/${t}?select=*&limit=1`, { headers: h })).status(), t).toBe(401);
    }
  });

  test("the private schema is not exposed, even to the service role path", async ({ request }) => {
    const r = await request.get(`${supabaseUrl}/rest/v1/ai_key_secrets?select=*`, { headers: { apikey: anonKey, "Accept-Profile": "private" } });
    expect(r.status()).toBe(406);
  });

  test("one user cannot read another user's data", async ({ request }) => {
    const { users } = state();
    const { token } = await signInClaims(users.basic.email, users.basic.password);
    const h = { apikey: anonKey, authorization: `Bearer ${token}` };
    for (const t of ["holdings", "watchlist_items", "price_alerts", "user_consents", "ai_provider_keys", "notifications"]) {
      const r = await request.get(`${supabaseUrl}/rest/v1/${t}?select=*&user_id=eq.${users.pro.id}`, { headers: h });
      expect(r.status(), t).toBe(200);
      expect(await r.json(), t).toEqual([]);
    }
    const p = await request.get(`${supabaseUrl}/rest/v1/profiles?select=*&user_id=eq.${users.pro.id}`, { headers: h });
    expect(await p.json()).toEqual([]);
  });

  test("users cannot call service-only functions", async ({ request }) => {
    const { users } = state();
    const { token } = await signInClaims(users.basic.email, users.basic.password);
    const h = { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" };
    for (const fn of ["svc_admin_user_search", "svc_is_platform_admin", "svc_refresh_research", "admin_activate_plan"]) {
      const r = await request.post(`${supabaseUrl}/rest/v1/rpc/${fn}`, { headers: h, data: {} });
      expect([401, 403, 404], fn).toContain(r.status());
    }
  });

  test("the platform console is invisible to non-admins", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.auth/pro.json" });
    const page = await ctx.newPage();
    await page.goto("/admin");
    await expect(page.getByText("No such page")).toBeVisible();
    await ctx.close();
  });
});
