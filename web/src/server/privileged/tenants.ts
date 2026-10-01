import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { TenantRole } from "@/lib/types";
import { audit } from "./audit";
import { assertMember, PrivilegedError } from "./guards";
import { serviceRole } from "./service-role";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const TRIAL_MONTHS = 3;

/**
 * POST /api/tenants/switch equivalent (§6): verify membership, then set the
 * default tenant. The caller must refresh their session afterwards so the
 * access-token hook issues a JWT with the new app_tenant_id.
 */
export async function switchTenant(userId: string, tenantId: string) {
  await assertMember(userId, tenantId);
  const { error } = await serviceRole()
    .from("profiles")
    .update({ default_tenant_id: tenantId })
    .eq("user_id", userId);
  if (error) throw new PrivilegedError(error.message);
}

/** Starts the same Basic trial a new signup gets, scoped to the new tenant. */
async function startTrial(userId: string, tenantId: string) {
  const end = new Date();
  end.setMonth(end.getMonth() + TRIAL_MONTHS);
  await serviceRole().from("subscriptions").insert({
    tenant_id: tenantId,
    user_id: userId,
    plan_code: "basic",
    status: "trialing",
    source: "trial",
    current_period_end: end.toISOString(),
  });
}

export async function createOrganization(userId: string, name: string, slug: string) {
  const db = serviceRole();
  const { data: tenant, error } = await db
    .from("tenants")
    .insert({ name, slug, type: "organization" })
    .select("id")
    .single();
  if (error) {
    if (error.message.includes("duplicate key")) throw new PrivilegedError("That workspace address is taken.");
    throw new PrivilegedError(error.message);
  }
  const { error: mErr } = await db.from("tenant_members").insert({ tenant_id: tenant.id, user_id: userId, role: "owner" });
  if (mErr) {
    await db.from("tenants").delete().eq("id", tenant.id);
    throw new PrivilegedError(mErr.message);
  }
  await startTrial(userId, tenant.id);
  await audit({ tenantId: tenant.id, actorUserId: userId, action: "tenant.created", targetType: "tenant", targetId: tenant.id });
  return tenant.id as string;
}

/**
 * Invitations store only the SHA-256 of the token; the raw token exists once,
 * in the link we hand back. Owners may invite admins; admins invite members.
 */
export async function createInvitation(actorId: string, tenantId: string, email: string, role: Exclude<TenantRole, "owner">) {
  const actorRole = await assertMember(actorId, tenantId, ["owner", "admin"]);
  if (role === "admin" && actorRole !== "owner") throw new PrivilegedError("Only the owner can invite admins.");

  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + 7 * 86400000);
  const { error } = await serviceRole().from("tenant_invitations").insert({
    tenant_id: tenantId,
    email: email.toLowerCase(),
    role,
    token_hash: sha256(token),
    invited_by: actorId,
    expires_at: expires.toISOString(),
  });
  if (error) throw new PrivilegedError(error.message);
  await audit({ tenantId, actorUserId: actorId, action: "member.invited", targetType: "invitation", metadata: { role } });
  return { token, expiresAt: expires.toISOString() };
}

export async function previewInvitation(token: string) {
  const { data } = await serviceRole()
    .from("tenant_invitations")
    .select("email, role, expires_at, accepted_at, tenants!inner(name, status)")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  if (!data) return null;
  const tenant = data.tenants as unknown as { name: string; status: string };
  return {
    email: data.email as string,
    role: data.role as TenantRole,
    tenantName: tenant.name,
    expired: new Date(data.expires_at) < new Date() || tenant.status !== "active",
    accepted: Boolean(data.accepted_at),
  };
}

export async function acceptInvitation(userId: string, userEmail: string, token: string) {
  const db = serviceRole();
  const { data: inv } = await db
    .from("tenant_invitations")
    .select("id, tenant_id, email, role, expires_at, accepted_at")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  if (!inv || inv.accepted_at || new Date(inv.expires_at) < new Date()) {
    throw new PrivilegedError("This invitation is no longer valid.");
  }
  if (inv.email !== userEmail.toLowerCase()) {
    throw new PrivilegedError(`This invitation was sent to ${inv.email}. Sign in with that address to accept it.`);
  }

  // Mark accepted first (single-use) — the filter makes it a compare-and-set.
  const { data: claimed } = await db
    .from("tenant_invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", inv.id)
    .is("accepted_at", null)
    .select("id");
  if (!claimed?.length) throw new PrivilegedError("This invitation has already been used.");

  const { error } = await db
    .from("tenant_members")
    .upsert({ tenant_id: inv.tenant_id, user_id: userId, role: inv.role }, { onConflict: "tenant_id,user_id", ignoreDuplicates: true });
  if (error) throw new PrivilegedError(error.message);
  await startTrial(userId, inv.tenant_id);
  await audit({ tenantId: inv.tenant_id, actorUserId: userId, action: "member.joined", targetType: "user", targetId: userId, metadata: { role: inv.role } });
  return inv.tenant_id as string;
}

/** Role changes live here so escalation rules sit in one place (§5.9). */
export async function changeMemberRole(actorId: string, tenantId: string, targetUserId: string, role: Exclude<TenantRole, "owner">) {
  const actorRole = await assertMember(actorId, tenantId, ["owner", "admin"]);
  const targetRole = await assertMember(targetUserId, tenantId);
  if (targetRole === "owner") throw new PrivilegedError("The owner's role can't be changed.");
  if (actorRole !== "owner" && (role === "admin" || targetRole === "admin")) {
    throw new PrivilegedError("Only the owner can grant or remove admin.");
  }
  const { error } = await serviceRole()
    .from("tenant_members")
    .update({ role })
    .eq("tenant_id", tenantId)
    .eq("user_id", targetUserId);
  if (error) throw new PrivilegedError(error.message);
  await audit({ tenantId, actorUserId: actorId, action: "member.role_changed", targetType: "user", targetId: targetUserId, metadata: { from: targetRole, to: role } });
}
