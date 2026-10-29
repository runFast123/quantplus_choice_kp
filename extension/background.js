// QuantsPulse Background Service Worker (Manifest V3)

const SUPPORTED_HOST_PATTERNS = [
  "tradingview.com",
  "choiceindia.com",
  "zerodha.com",
  "groww.in",
  "dhan.co",
  "angelone.in",
  "upstox.com",
  "fyers.in",
  "kotaksecurities.com",
  "kotakneo.com",
  "icicidirect.com",
  "motilaloswal.com",
  "paytmmoney.com",
  "5paisa.com",
  "sharekhan.com",
  "hdfcsec.com",
  "hdfcsky.com",
  "axisdirect.in",
  "shoonya.com",
  "finvasia.com",
  "aliceblueonline.com",
  "google.com/finance",
  "finance.yahoo.com"
];

function isSupportedUrl(url) {
  if (!url) return false;
  return SUPPORTED_HOST_PATTERNS.some((pattern) => url.includes(pattern));
}

// 1. Enable Side Panel to open automatically when user clicks the extension toolbar icon
function initializeSidePanelBehavior() {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(() => {
  initializeSidePanelBehavior();
  injectIntoExistingTabs();
  refreshAuth();
});

chrome.runtime.onStartup.addListener(() => {
  initializeSidePanelBehavior();
  refreshAuth();
});

function injectIntoExistingTabs() {
  if (!chrome.scripting || !chrome.tabs) return;
  chrome.tabs.query({}, (tabs) => {
    if (chrome.runtime.lastError || !tabs) return;
    for (const tab of tabs) {
      if (tab.id && tab.url && isSupportedUrl(tab.url)) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content-scripts/detector.js"],
        }).catch(() => {
          // Ignore tabs where script was already injected or permissions restricted
        });
      }
    }
  });
}

// In-Memory Intelligent Quote Cache (30s TTL for zero-latency chart switching)
const quoteCache = new Map();
const CACHE_TTL_MS = 30000;

// The access token is only ever sent to these servers, whatever the settings field says.
const DEFAULT_BACKEND = "https://quantplus-ten.vercel.app";
const ALLOWED_BACKENDS = [DEFAULT_BACKEND, "http://localhost:3000"];

function backendFrom(stored) {
  const url = String(stored || "").trim().replace(/\/$/, "");
  return ALLOWED_BACKENDS.includes(url) ? url : DEFAULT_BACKEND;
}

// Auth: the website keeps the Supabase session in cookies (@supabase/ssr). The background worker
// asks /api/extension/session with those cookies and stores the current access token; it asks
// again shortly before the token expires, after a 401, and when a QuantsPulse tab opens.
let refreshing = null;

function refreshAuth() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const { backendUrl } = await chrome.storage.local.get(["backendUrl"]);
      const r = await fetch(`${backendFrom(backendUrl)}/api/extension/session`, { credentials: "include", cache: "no-store" });
      const s = await r.json();
      if (s?.authenticated && s.token) {
        await chrome.storage.local.set({
          qpAuthToken: s.token,
          qpTokenExpiresAt: s.expiresAt ?? null,
          qpUser: s.user ?? null,
          qpAuthenticated: true,
        });
        return true;
      }
      if (s && s.authenticated === false) {
        await chrome.storage.local.remove(["qpAuthToken", "qpTokenExpiresAt", "qpUser"]);
        await chrome.storage.local.set({ qpAuthenticated: false });
      }
      return false;
    } catch {
      return null; // offline or server down: keep the current state
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function currentToken() {
  let { qpAuthToken, qpTokenExpiresAt } = await chrome.storage.local.get(["qpAuthToken", "qpTokenExpiresAt"]);
  if (!qpAuthToken || (qpTokenExpiresAt && qpTokenExpiresAt * 1000 - Date.now() < 120000)) {
    await refreshAuth();
    ({ qpAuthToken } = await chrome.storage.local.get(["qpAuthToken"]));
  }
  return qpAuthToken || null;
}

// 2. Manage Detected Symbols across Active Tabs
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SYMBOL_DETECTED" && message.symbol) {
    const symbol = message.symbol.toUpperCase().trim();
    const exchange = (message.exchange || "NSE").toUpperCase().trim();
    const platform = message.platform || "Web";

    // Persist in local storage for sidepanel consumption only if symbol actually changed
    chrome.storage.local.get(["activeSymbol"], (stored) => {
      if (stored?.activeSymbol !== symbol) {
        chrome.storage.local.set({
          activeSymbol: symbol,
          exchange: exchange,
          platform: platform,
        });
      }
    });

    // Display symbol on toolbar badge for immediate visual feedback
    if (chrome.action?.setBadgeText) {
      chrome.action.setBadgeText({ text: symbol.slice(0, 4) });
      chrome.action.setBadgeBackgroundColor({ color: "#F26A4B" }); // QuantsPulse Coral
    }

    sendResponse({ ok: true, symbol });
    return true;
  }

  // 3. Handle On-Chart Quote & Signal fetch requests from Content Scripts
  if (message?.type === "FETCH_QUOTE_DATA" && message.symbol) {
    const cleanSym = message.symbol.toUpperCase().trim();
    const symbol = encodeURIComponent(cleanSym);
    const exchange = message.exchange || "NSE";

    // Check in-memory cache first for instant zero-latency render
    const cached = quoteCache.get(cleanSym);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      sendResponse({ ok: true, data: cached.data, fromCache: true });
      return true;
    }

    chrome.storage.local.get(["backendUrl"], async (res) => {
      const baseUrl = backendFrom(res.backendUrl);
      const url = `${baseUrl}/api/extension/quote?symbol=${symbol}&exchange=${encodeURIComponent(exchange)}`;
      const authHeaders = (token) => (token ? { Authorization: `Bearer ${token}` } : {});
      let headers = authHeaders(await currentToken());

      const fetchWithRetry = (retriesLeft = 1, reauthed = false) => {
        return fetch(url, { headers })
          .then(async (r) => {
            if (r.status === 401) {
              // The token may have just expired: get a fresh one from the cookie session once.
              if (!reauthed && (await refreshAuth())) {
                const { qpAuthToken } = await chrome.storage.local.get(["qpAuthToken"]);
                headers = authHeaders(qpAuthToken);
                return fetchWithRetry(retriesLeft, true);
              }
              chrome.storage.local.set({ qpAuthenticated: false });
              const errData = await r.json().catch(() => ({}));
              throw { isAuthError: true, ...errData };
            }
            if (!r.ok) {
              if (retriesLeft > 0 && r.status >= 500) {
                await new Promise((resolve) => setTimeout(resolve, 350));
                return fetchWithRetry(retriesLeft - 1, reauthed);
              }
              throw new Error(`HTTP ${r.status}`);
            }
            return r.json();
          });
      };

      fetchWithRetry()
        .then((data) => {
          // Store in fast in-memory cache
          quoteCache.set(cleanSym, { data, timestamp: Date.now() });
          chrome.storage.local.set({ activeQuoteData: data, activeSymbol: data.symbol });
          sendResponse({ ok: true, data });
        })
        .catch((err) => {
          sendResponse({
            ok: false,
            isAuthError: Boolean(err?.isAuthError),
            error: err?.message || err?.error || "Failed to fetch quote",
            loginUrl: `${baseUrl}/login`,
            signupUrl: `${baseUrl}/signup`,
          });
        });
    });
    return true; // Keep channel open for async response
  }

  // 4. Re-check sign-in (QuantsPulse tab opened or focused, side panel "Check login status").
  // Content scripts and the side panel follow qpAuthenticated through chrome.storage.onChanged.
  if (message?.type === "QP_REFRESH_AUTH") {
    refreshAuth().then((ok) => sendResponse({ ok: Boolean(ok) }));
    return true;
  }
  return false;
});

// 3. Tab switch & URL update detection (manage badge cleanly)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab?.url) return;

    if (!isSupportedUrl(tab.url)) {
      if (chrome.action?.setBadgeText) {
        chrome.action.setBadgeText({ text: "" });
      }
    }
  } catch {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && !isSupportedUrl(tab.url)) {
    if (chrome.action?.setBadgeText) {
      chrome.action.setBadgeText({ text: "" });
    }
  }
});
