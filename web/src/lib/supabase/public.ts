import "server-only";

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * A client with no cookies and no session: the publishable key only, so every query runs as `anon` under RLS.
 * For public reference data (the plan list) on pages that are prerendered or revalidated on a timer (ADR-058);
 * reading cookies there would make the page render per request. Never for user data: use `supabaseServer()`.
 */
export function supabasePublic() {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
