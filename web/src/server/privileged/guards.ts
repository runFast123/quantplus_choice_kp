import "server-only";

import type { Feature, TenantRole } from "@/lib/types";
import { serviceRole } from "./service-role";

/**
 * Checks used by every privileged operation. The service role bypasses RLS,
 * so these re-establish, from the database, what RLS would have enforced.
 */
export async function membershipRole(userId: string, tenantId: string): Promise<TenantRole | null> {
  const { data } = await serviceRole()
    .from("tenant_members")
    .select("role, tenants!inner(status)")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("tenants.status", "active")
    .maybeSingle();
  return (data?.role as TenantRole | undefined) ?? null;
}

export async function assertMember(userId: string, tenantId: string, roles?: TenantRole[]): Promise<TenantRole> {
  const role = await membershipRole(userId, tenantId);
  if (!role || (roles && !roles.includes(role))) throw new PrivilegedError("NOT_AUTHORIZED");
  return role;
}

/** Mirrors private.plan_has_feature for a specific user + tenant. */
export async function planHasFeature(userId: string, tenantId: string, feature: Feature): Promise<boolean> {
  const { data } = await serviceRole()
    .from("subscriptions")
    .select("plan_code, status, current_period_end, plans!inner(features)")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .in("status", ["trialing", "active"])
    .gt("current_period_end", new Date().toISOString())
    .order("current_period_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  const features = (data?.plans as unknown as { features?: Record<string, boolean> } | undefined)?.features;
  return Boolean(features?.[feature]);
}

export async function hasActiveConsent(userId: string, purpose: string): Promise<boolean> {
  const { data } = await serviceRole()
    .from("user_consents")
    .select("id")
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .is("withdrawn_at", null)
    .limit(1);
  return Boolean(data?.length);
}

export class PrivilegedError extends Error {}
