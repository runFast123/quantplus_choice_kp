import { env } from "./env";

/**
 * Service-role helpers for test fixtures ONLY (create/delete disposable users,
 * set plans). Never imported by the app.
 */
const E = env();
const URL_ = E.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = E.SUPABASE_SERVICE_ROLE_KEY;
const ANON = E.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const svc = { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" };

export type TestUser = { id: string; email: string; password: string; plan: "basic" | "pro" };

export async function createUser(
  label: string,
  plan: "basic" | "pro",
  consents: string[] = ["terms", "privacy_policy"],
  opts: { confirmed?: boolean } = {},
): Promise<TestUser> {
  const email = `e2e.${label}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@quantspulse.test`;
  const password = `E2e-${crypto.randomUUID()}`;
  const r = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: "POST",
    headers: svc,
    body: JSON.stringify({ email, password, email_confirm: opts.confirmed ?? true, user_metadata: { full_name: `E2E ${label}` } }),
  });
  const u = await r.json();
  if (!r.ok) throw new Error(`createUser: ${r.status} ${u.msg ?? u.message}`);
  if (plan === "pro") await setPlan(u.id, "pro");
  if (consents.length) {
    const c = await fetch(`${URL_}/rest/v1/user_consents`, {
      method: "POST",
      headers: svc,
      body: JSON.stringify(consents.map((purpose) => ({ user_id: u.id, purpose, version: "2026-10-01" }))),
    });
    if (!c.ok) throw new Error(`consents: ${c.status}`);
  }
  await fetch(`${URL_}/rest/v1/profiles?user_id=eq.${u.id}`, { method: "PATCH", headers: svc, body: JSON.stringify({ full_name: `E2E ${label}` }) });
  return { id: u.id, email, password, plan };
}

export async function setPlan(userId: string, plan: "basic" | "pro" | "pro_plus") {
  const r = await fetch(`${URL_}/rest/v1/subscriptions?user_id=eq.${userId}`, {
    method: "PATCH",
    headers: svc,
    body: JSON.stringify({ plan_code: plan, status: plan === "basic" ? "trialing" : "active" }),
  });
  if (!r.ok) throw new Error(`setPlan: ${r.status}`);
}

export async function deleteUser(id: string) {
  await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: svc });
}

export async function deleteE2eTenants() {
  await fetch(`${URL_}/rest/v1/tenants?slug=like.e2e-*`, { method: "DELETE", headers: svc });
}

/** Signs in over the Auth API and returns the access token's claims. */
export async function signInClaims(email: string, password: string) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const t = await r.json();
  if (!r.ok) throw new Error(`signIn: ${r.status}`);
  return { token: t.access_token as string, claims: JSON.parse(Buffer.from(t.access_token.split(".")[1], "base64url").toString()) };
}

export const supabaseUrl = URL_;
export const anonKey = ANON;
