import "server-only";

import type { PlanCode, SubscriptionStatus, TenantType } from "@/lib/types";
import { PrivilegedError } from "./guards";
import { serviceRole } from "./service-role";

/** Platform admins are granted only by direct SQL (§2 rule 6); this only reads. */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const { data } = await serviceRole().rpc("svc_is_platform_admin", { p_user: userId });
  return data === true;
}

export interface AdminUserRow {
  user_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  tenant_id: string;
  tenant_name: string;
  tenant_type: TenantType;
  plan: PlanCode | null;
  plan_status: SubscriptionStatus | null;
  plan_expires_at: string | null;
  created_at: string;
  last_sign_in_at: string | null;
}

export async function searchUsers(actorId: string, query: string): Promise<AdminUserRow[]> {
  if (!(await isPlatformAdmin(actorId))) throw new PrivilegedError("NOT_AUTHORIZED");
  const { data, error } = await serviceRole().rpc("svc_admin_user_search", { p_query: query, p_limit: 50 });
  if (error) throw new PrivilegedError(error.message);
  return (data ?? []) as AdminUserRow[];
}

/**
 * Wraps public.admin_activate_plan — one transaction for subscription +
 * payment + audit (§5.11). p_actor comes from the verified JWT and the
 * function re-checks platform-admin status itself.
 */
export async function activatePlan(
  actorId: string,
  input: {
    userId: string;
    tenantId: string;
    plan: PlanCode;
    months: number;
    amountPaise: number;
    method: "upi" | "bank_transfer" | "cash" | "other";
    reference?: string;
  },
) {
  const { data, error } = await serviceRole().rpc("admin_activate_plan", {
    p_actor: actorId,
    p_user: input.userId,
    p_tenant: input.tenantId,
    p_plan: input.plan,
    p_months: input.months,
    p_amount_paise: input.amountPaise,
    p_method: input.method,
    p_reference: input.reference || null,
  });
  if (error) throw new PrivilegedError(error.message);
  return data as { current_period_end: string; plan_code: PlanCode };
}

export async function platformStats(actorId: string) {
  if (!(await isPlatformAdmin(actorId))) throw new PrivilegedError("NOT_AUTHORIZED");
  const db = serviceRole();
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [users, live, paid, revenue] = await Promise.all([
    db.from("profiles").select("user_id", { count: "exact", head: true }),
    db.from("subscriptions").select("id", { count: "exact", head: true }).in("status", ["trialing", "active"]),
    db.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active").neq("plan_code", "basic"),
    db.from("payments").select("amount_paise").eq("status", "captured").gte("created_at", since),
  ]);
  return {
    users: users.count ?? 0,
    liveSubscriptions: live.count ?? 0,
    paidSubscriptions: paid.count ?? 0,
    revenue30dPaise: (revenue.data ?? []).reduce((s, r) => s + Number(r.amount_paise), 0),
  };
}
