"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/server/session";
import { claimThisDevice } from "@/server/device";
import { switchTenant } from "@/server/privileged/tenants";

export async function switchTenantAction(tenantId: string) {
  const s = await requireSession();
  if (tenantId === s.activeTenantId) return;
  await switchTenant(s.userId, tenantId);
  // New JWT from the access-token hook carries the new app_tenant_id (§6).
  await s.supabase.auth.refreshSession();
  revalidatePath("/app", "layout");
  redirect("/app");
}

export async function claimDeviceAction() {
  const s = await requireSession();
  await claimThisDevice(s.userId);
  revalidatePath("/app", "layout");
}

export async function markNotificationsRead(ids?: string[]) {
  const s = await requireSession();
  let q = s.supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (ids?.length) q = q.in("id", ids);
  await q;
  revalidatePath("/app", "layout");
}

export async function refreshClaimsAction() {
  const s = await requireSession();
  await s.supabase.auth.refreshSession();
  revalidatePath("/app", "layout");
}
