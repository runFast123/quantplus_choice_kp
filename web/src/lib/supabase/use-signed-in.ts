"use client";

import { useSyncExternalStore } from "react";
import { SUPABASE_URL } from "@/lib/env";

/**
 * "Is there a session in this browser?" for the public pages, which are prerendered and so cannot ask the server
 * (ADR-058). It only looks for the Supabase session cookie by name (the same name supabase-js derives from the
 * project URL; long sessions are split into `.0`, `.1`, …) and never reads what is inside. The proxy refreshes or
 * clears that cookie on every request, so its presence matches what the server would have said. It is a hint for
 * which button to show, never an access check: `/app` is guarded by the proxy and `requireSession()`.
 */
const SESSION_COOKIE = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

function hasSessionCookie() {
  return document.cookie.split("; ").some((c) => c.startsWith(`${SESSION_COOKIE}=`) || c.startsWith(`${SESSION_COOKIE}.`));
}

// Signing in or out happens on other pages or in another tab: look again when this one is shown or focused.
function subscribe(cb: () => void) {
  window.addEventListener("focus", cb);
  window.addEventListener("pageshow", cb);
  document.addEventListener("visibilitychange", cb);
  return () => {
    window.removeEventListener("focus", cb);
    window.removeEventListener("pageshow", cb);
    document.removeEventListener("visibilitychange", cb);
  };
}

/** False on the server and during hydration (the signed-out page crawlers get), then the browser's answer. */
export function useSignedIn(): boolean {
  return useSyncExternalStore(subscribe, hasSessionCookie, () => false);
}
