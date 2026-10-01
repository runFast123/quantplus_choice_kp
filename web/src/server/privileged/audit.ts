import "server-only";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { serviceRole } from "./service-role";

/**
 * Append-only audit entry (§5.6). Metadata must NEVER contain tokens, keys,
 * holdings or prompts — only identifiers and coarse facts.
 */
export async function audit(entry: {
  tenantId: string | null;
  actorUserId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "";
  // Hash with a server-side pepper so the log can correlate sessions without storing IPs.
  const pepper = process.env.QP_SECRETS_KEY_V1 ?? "";
  const ipHash = ip ? createHash("sha256").update(pepper + ip).digest("hex").slice(0, 32) : null;

  await serviceRole()
    .from("audit_log")
    .insert({
      tenant_id: entry.tenantId,
      actor_user_id: entry.actorUserId,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      metadata: entry.metadata ?? {},
      ip_hash: ipHash,
    });
}
