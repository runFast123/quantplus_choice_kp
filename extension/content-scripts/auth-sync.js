// QuantsPulse Chrome Extension — Web Auth Synchronization Bridge
// Runs on quantplus-ten.vercel.app and localhost:3000. The website keeps the Supabase session in
// cookies (@supabase/ssr), which this script can't and shouldn't read: it only asks the background
// worker to re-check sign-in, and the worker gets a token from /api/extension/session.

(function () {
  "use strict";

  // Mark extension presence so the web app knows the extension is installed
  try {
    window.postMessage({ type: "QP_EXTENSION_DISCOVERED", version: chrome.runtime.getManifest().version }, window.location.origin);
  } catch {}

  function syncAuth() {
    try {
      chrome.runtime.sendMessage({ type: "QP_REFRESH_AUTH" }, () => void chrome.runtime.lastError);
    } catch {
      // Extension reloaded or removed: this page's script is orphaned until the next load.
    }
  }

  // 1. On page load (covers arriving here right after signing in or out)
  syncAuth();

  // 2. When the tab comes back into view
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) syncAuth();
  });

  // 3. When the QuantsPulse web desk asks for it
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== window.location.origin) return;
    if (e.data?.type === "QP_REQUEST_AUTH_SYNC") {
      syncAuth();
      window.postMessage({ type: "QP_EXTENSION_SYNC_ACK", success: true }, window.location.origin);
    }
  });

  // 4. Every 5 minutes while the app is open, to notice a sign-out in another tab
  setInterval(() => {
    if (!document.hidden) syncAuth();
  }, 5 * 60 * 1000);
})();
