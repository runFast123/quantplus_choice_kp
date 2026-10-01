import "server-only";

import { deviceHash } from "@/server/device-hash";
import { audit } from "./audit";
import { PrivilegedError } from "./guards";
import { serviceRole } from "./service-role";

/**
 * Single-active-device enforcement (replaces Firestore activeDeviceId).
 * Only the hash of the device id is stored, never the raw value.
 */
export async function registerDevice(userId: string, deviceId: string, label: string) {
  // One transaction with an advisory lock (svc_register_device): concurrent
  // sign-ins can't both end up active or trip the one-active unique index.
  const { error } = await serviceRole().rpc("svc_register_device", {
    p_user: userId,
    p_hash: deviceHash(deviceId),
    p_label: label.slice(0, 80),
  });
  if (error) throw new PrivilegedError(error.message);
}

/**
 * Consequences of withdrawing a consent (§7), applied across EVERY workspace
 * the user belongs to — RLS would only reach the active one.
 */
export async function applyConsentWithdrawal(userId: string, purpose: string) {
  const db = serviceRole();
  if (purpose === "ai_processing") {
    await db.from("ai_provider_keys").delete().eq("user_id", userId);
  }
}

/**
 * Account deletion in the order §7 prescribes, so nothing is left behind.
 * Payments survive with user_id set null (tax records); audit rows become
 * pseudonymous once auth.users is gone.
 */
export async function deleteAccount(userId: string) {
  const db = serviceRole();

  // 0. Refuse BEFORE touching anything: organisations this user owns would be
  //    orphaned. (Checking later used to delete files first.)
  const { data: ownedOrgs, error: oErr } = await db
    .from("tenant_members")
    .select("tenant_id, tenants!inner(type, name)")
    .eq("user_id", userId)
    .eq("role", "owner")
    .eq("tenants.type", "organization");
  if (oErr) throw new PrivilegedError(oErr.message);
  if (ownedOrgs?.length) {
    const names = ownedOrgs.map((o) => (o.tenants as unknown as { name: string }).name).join(", ");
    throw new PrivilegedError(`Transfer or close the organisations you own first: ${names}.`);
  }

  // 1. Contract-note files in the private bucket.
  const { data: files } = await db.storage.from("contract-notes").list(userId, { limit: 1000 });
  if (files?.length) {
    await db.storage.from("contract-notes").remove(files.map((f) => `${userId}/${f.name}`));
  }

  // 2. Personal tenant(s) — cascades tenant-scoped rows. (The on_auth_user_deleted
  //    trigger would also do this; doing it explicitly keeps the §7 order.)
  const { data: personal } = await db
    .from("tenant_members")
    .select("tenant_id, tenants!inner(type)")
    .eq("user_id", userId)
    .eq("role", "owner")
    .eq("tenants.type", "personal");
  const personalIds = (personal ?? []).map((p) => p.tenant_id as string);
  if (personalIds.length) await db.from("tenants").delete().in("id", personalIds);

  // 3. The auth user — cascades profile, devices, consents, memberships.
  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) throw new PrivilegedError(error.message);

  // 4. Audit (no PII beyond the now-orphaned id).
  await audit({ tenantId: null, actorUserId: userId, action: "account.deleted", targetType: "user", targetId: userId });
}
