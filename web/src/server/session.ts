import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import type { Entitlements, Feature, Membership, Profile, TenantRole } from "@/lib/types";

export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/**
 * Everything the app shell needs about the caller, read once per request
 * through the user's own RLS-scoped client.
 */
export const getSession = cache(async () => {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;

  const userId = claims.sub;
  // Set by public.custom_access_token_hook (spec §5.10). Routing/UI hint only:
  // RLS re-checks live membership on every query.
  const activeTenantId = (claims.app_tenant_id as string | undefined) ?? null;

  const [profileRes, membershipsRes, entRes] = await Promise.all([
    supabase.from("profiles").select("user_id, full_name, phone, avatar_url, default_tenant_id").maybeSingle(),
    supabase
      .from("tenant_members")
      .select("tenant_id, role, tenants!inner(id, name, slug, type, status)")
      .eq("user_id", userId)
      .order("created_at"),
    activeTenantId ? supabase.rpc("my_entitlements").maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const memberships = (membershipsRes.data ?? []) as unknown as Membership[];
  const active = memberships.find((m) => m.tenant_id === activeTenantId) ?? null;

  return {
    supabase,
    userId,
    email: (claims.email as string | undefined) ?? "",
    activeTenantId,
    activeTenant: active?.tenants ?? null,
    activeRole: (active?.role ?? null) as TenantRole | null,
    profile: (profileRes.data ?? null) as Profile | null,
    memberships,
    entitlements: (entRes.data ?? null) as Entitlements | null,
    /** True when the JWT has no tenant claim: the access-token hook isn't enabled. */
    hookMissing: !activeTenantId,
  };
});

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export function can(session: Session, feature: Feature): boolean {
  return Boolean(session.entitlements?.features?.[feature]);
}

export function isTenantAdmin(session: Session): boolean {
  return session.activeRole === "owner" || session.activeRole === "admin";
}

export function displayName(session: Session): string {
  return session.profile?.full_name?.trim() || session.email.split("@")[0] || "there";
}
