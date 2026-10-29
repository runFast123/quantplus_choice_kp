// QuantsPulse options: overlay preferences and the server the extension talks to.
// The HUD (detector.js) and side panel follow these through chrome.storage.onChanged.

(function () {
  const DEFAULT_BACKEND = "https://quantplus-ten.vercel.app";
  // The sign-in token goes to this server, so only QuantsPulse itself or local development.
  const ALLOWED_BACKENDS = [DEFAULT_BACKEND, "http://localhost:3000"];

  const overlay = document.getElementById("opt-overlay");
  const mode = document.getElementById("opt-hud-mode");
  const servers = document.querySelectorAll('input[name="opt-server"]');
  const status = document.getElementById("opts-status");

  let statusTimer;
  function saved(text = "Saved") {
    status.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (status.textContent = ""), 1600);
  }

  chrome.storage.local.get(["showChartOverlay", "qpHudPrefs", "backendUrl"], (res) => {
    overlay.checked = res.showChartOverlay !== false;
    mode.value = res.qpHudPrefs?.displayMode || "full";
    mode.disabled = !overlay.checked;
    const backend = ALLOWED_BACKENDS.includes(res.backendUrl) ? res.backendUrl : DEFAULT_BACKEND;
    servers.forEach((r) => (r.checked = r.value === backend));
  });

  overlay.addEventListener("change", () => {
    mode.disabled = !overlay.checked;
    chrome.storage.local.get(["qpHudPrefs"], (res) => {
      const prefs = Object.assign({}, res.qpHudPrefs || {}, { isHidden: !overlay.checked });
      chrome.storage.local.set({ showChartOverlay: overlay.checked, qpHudPrefs: prefs }, () => saved());
    });
  });

  mode.addEventListener("change", () => {
    chrome.storage.local.get(["qpHudPrefs"], (res) => {
      const prefs = Object.assign({}, res.qpHudPrefs || {}, { displayMode: mode.value, isHidden: false });
      chrome.storage.local.set({ qpHudPrefs: prefs, showChartOverlay: true }, () => saved());
    });
  });

  servers.forEach((r) =>
    r.addEventListener("change", () => {
      if (!r.checked || !ALLOWED_BACKENDS.includes(r.value)) return;
      // A different server means a different account: sign in again there.
      chrome.storage.local.remove(["qpAuthToken", "qpTokenExpiresAt", "qpUser"], () => {
        chrome.storage.local.set({ backendUrl: r.value, qpAuthenticated: false }, () => {
          chrome.runtime.sendMessage({ type: "QP_REFRESH_AUTH" }, () => void chrome.runtime.lastError);
          saved("Saved. Checking sign-in on that server…");
        });
      });
    }),
  );
})();
