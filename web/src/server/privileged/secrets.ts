import "server-only";

import type { AiProvider, BrokerCode } from "@/lib/types";
import { audit } from "./audit";
import { seal } from "./crypto";
import { assertMember, hasActiveConsent, planHasFeature, PrivilegedError } from "./guards";
import { serviceRole } from "./service-role";

/**
 * BYOK AI keys and broker tokens (§4, §6). The plaintext is encrypted here,
 * in Node, and only ciphertext crosses into the private schema. Responses to
 * the client never include more than `key_last4` / a masked account id.
 */
export async function saveAiKey(
  userId: string,
  tenantId: string,
  input: { provider: AiProvider; label: string; apiKey: string; defaultModel?: string },
) {
  await assertMember(userId, tenantId);
  if (!(await planHasFeature(userId, tenantId, "ai_byok"))) {
    throw new PrivilegedError("Bring-your-own AI keys are part of Pro and Pro Plus.");
  }
  if (!(await hasActiveConsent(userId, "ai_processing"))) {
    throw new PrivilegedError("Allow AI processing in Privacy settings before adding a key.");
  }
  const key = input.apiKey.trim();
  if (key.length < 12) throw new PrivilegedError("That key looks too short.");

  const db = serviceRole();
  const { data: row, error } = await db
    .from("ai_provider_keys")
    .upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        provider: input.provider,
        label: input.label || "default",
        key_last4: key.slice(-4),
        default_model: input.defaultModel || null,
        status: "active",
      },
      { onConflict: "user_id,tenant_id,provider,label" },
    )
    .select("id")
    .single();
  if (error) throw new PrivilegedError(error.message);

  const sealed = seal(key, `ai_key:${row.id}`);
  const { error: sErr } = await db.rpc("svc_put_ai_key_secret", {
    p_key: row.id,
    p_ciphertext: sealed.ciphertext,
    p_iv: sealed.iv,
    p_auth_tag: sealed.auth_tag,
    p_key_version: sealed.key_version,
  });
  if (sErr) throw new PrivilegedError(sErr.message);

  await audit({ tenantId, actorUserId: userId, action: "ai_key.saved", targetType: "ai_key", targetId: row.id, metadata: { provider: input.provider } });
}

/** Most Indian broker sessions expire daily, early morning IST. */
function nextBrokerExpiry(): string {
  const now = new Date();
  const expiry = new Date(now);
  // 06:00 IST == 00:30 UTC
  expiry.setUTCHours(0, 30, 0, 0);
  if (expiry <= now) expiry.setUTCDate(expiry.getUTCDate() + 1);
  return expiry.toISOString();
}

export async function connectBroker(
  userId: string,
  tenantId: string,
  input: { broker: BrokerCode; clientId: string; accessToken: string },
) {
  await assertMember(userId, tenantId);
  if (!(await planHasFeature(userId, tenantId, "broker_connect"))) {
    throw new PrivilegedError("Broker connections are part of Pro and Pro Plus.");
  }
  if (!(await hasActiveConsent(userId, "broker_data_access"))) {
    throw new PrivilegedError("Allow broker data access in Privacy settings before connecting.");
  }
  const clientId = input.clientId.trim();
  const masked = clientId.length > 4 ? `${"X".repeat(Math.min(clientId.length - 4, 6))}${clientId.slice(-4)}` : "XXXX";

  const db = serviceRole();
  const { data: conn, error } = await db
    .from("broker_connections")
    .upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        broker: input.broker,
        broker_account_masked: masked,
        scopes: ["read"],
        status: "connected",
        token_expires_at: nextBrokerExpiry(),
        last_error: null,
      },
      { onConflict: "user_id,tenant_id,broker" },
    )
    .select("id")
    .single();
  if (error) throw new PrivilegedError(error.message);

  const sealed = seal(input.accessToken.trim(), `broker:${conn.id}`);
  const { error: sErr } = await db.rpc("svc_put_broker_credentials", {
    p_connection: conn.id,
    p_ciphertext: sealed.ciphertext,
    p_iv: sealed.iv,
    p_auth_tag: sealed.auth_tag,
    p_key_version: sealed.key_version,
  });
  if (sErr) throw new PrivilegedError(sErr.message);

  await audit({ tenantId, actorUserId: userId, action: "broker.connected", targetType: "broker_connection", targetId: conn.id, metadata: { broker: input.broker } });
}
