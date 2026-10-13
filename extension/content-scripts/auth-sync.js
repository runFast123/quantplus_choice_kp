// QuantsPulse Chrome Extension — Web Auth Synchronization Bridge
// Runs on quantplus-ten.vercel.app and localhost:3000 to automatically pair
// and authorize the extension with the user's active QuantsPulse account.

(function () {
  "use strict";

  // Mark extension presence in the DOM so the web app knows the extension is installed
  try {
    window.__QUANTSPULSE_EXTENSION_INSTALLED__ = true;
    window.postMessage({ type: "QP_EXTENSION_DISCOVERED", version: "1.0.0" }, "*");
  } catch {}

  function extractSupabaseSession() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes("auth-token")) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            const token = parsed?.access_token || parsed?.currentSession?.access_token;
            const user = parsed?.user || parsed?.currentSession?.user;
            if (token && user) {
              return { token, user };
            }
          }
        }
      }
    } catch {}
    return null;
  }

  function syncAuth() {
    const session = extractSupabaseSession();

    if (session && session.token) {
      const authData = {
        qpAuthToken: session.token,
        qpUser: {
          id: session.user.id,
          email: session.user.email,
        },
        qpAuthenticated: true,
        lastSyncedAt: Date.now(),
      };

      if (chrome.storage?.local) {
        chrome.storage.local.set(authData, () => {
          try {
            chrome.runtime.sendMessage({
              type: "QP_AUTH_STATUS_CHANGED",
              authenticated: true,
              user: authData.qpUser,
              token: authData.qpAuthToken,
            });
          } catch {}
        });
      }
    } else {
      // User is not logged in on the web platform
      if (chrome.storage?.local) {
        chrome.storage.local.get(["qpAuthenticated"], (res) => {
          if (res?.qpAuthenticated) {
            chrome.storage.local.remove(["qpAuthToken", "qpUser"]);
            chrome.storage.local.set({ qpAuthenticated: false }, () => {
              try {
                chrome.runtime.sendMessage({
                  type: "QP_AUTH_STATUS_CHANGED",
                  authenticated: false,
                });
              } catch {}
            });
          }
        });
      }
    }
  }

  // 1. Initial sync on page load
  syncAuth();

  // 2. Watch for localStorage changes (e.g. login or logout in another tab)
  window.addEventListener("storage", (e) => {
    if (e.key && e.key.includes("auth-token")) {
      syncAuth();
    }
  });

  // 3. Listen for direct messages from the QuantsPulse web desk
  window.addEventListener("message", (e) => {
    if (e.data?.type === "QP_REQUEST_AUTH_SYNC") {
      syncAuth();
      window.postMessage({ type: "QP_EXTENSION_SYNC_ACK", success: true }, "*");
    }
  });

  // Periodic heartbeat sync every 15 seconds while browsing the app
  setInterval(syncAuth, 15000);
})();
