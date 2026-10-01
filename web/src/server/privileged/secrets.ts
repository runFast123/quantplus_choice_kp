import "server-only";

import type { AiProvider } from "@/lib/types";
import { audit } from "./audit";
import { seal } from "./crypto";
import { assertMember, hasActiveConsent, planHasFeature, PrivilegedError } from "./guards";
import { serviceRole } from "./service-role";

/**
 * BYOK AI keys (§4, §6). The plaintext is encrypted here, in Node, and only
 * ciphertext crosses into the private schema. Responses to the client never
 * include more than `key_last4`.
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
