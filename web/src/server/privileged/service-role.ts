import "server-only";

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/env";

/**
 * Service-role client — BYPASSES RLS. Spec §6: confined to privileged modules.
 * ESLint (`no-restricted-imports`) blocks importing this file from anywhere
 * outside src/server/privileged/. Every query here must filter by BOTH
 * user_id and tenant_id explicitly.
 */
export function serviceRole() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
