// QuantsPulse Background Service Worker (Manifest V3)

const SUPPORTED_HOST_PATTERNS = [
  "tradingview.com",
  "kite.zerodha.com",
  "groww.in",
  "dhan.co",
  "angelone.in",
  "google.com/finance",
  "finance.yahoo.com"
];

function isSupportedUrl(url) {
  if (!url) return false;
  return SUPPORTED_HOST_PATTERNS.some((pattern) => url.includes(pattern));
}

// 1. Enable Side Panel to open automatically when user clicks the extension toolbar icon
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
  injectIntoExistingTabs();
});

// Also trigger on service worker startup
injectIntoExistingTabs();

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

// 2. Manage Detected Symbols across Active Tabs
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SYMBOL_DETECTED" && message.symbol) {
    const symbol = message.symbol.toUpperCase().trim();
    const exchange = (message.exchange || "NSE").toUpperCase().trim();
    const platform = message.platform || "Web";

    // Persist in local storage for sidepanel consumption
    chrome.storage.local.set({
      activeSymbol: symbol,
      exchange: exchange,
      platform: platform,
      detectedAt: Date.now(),
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
    const symbol = encodeURIComponent(message.symbol.trim());
    const exchange = message.exchange || "NSE";
    chrome.storage.local.get(["backendUrl"], (res) => {
      const baseUrl = (res.backendUrl || "https://quantplus-ten.vercel.app").replace(/\/$/, "");
      const url = `${baseUrl}/api/extension/quote?symbol=${symbol}&exchange=${exchange}`;
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((data) => {
          chrome.storage.local.set({ activeQuoteData: data });
          sendResponse({ ok: true, data });
        })
        .catch((err) => sendResponse({ ok: false, error: err.message }));
    });
    return true; // Keep channel open for async response
  }
  return true;
});

// 3. Tab switch & URL update detection
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab?.url) return;

    if (isSupportedUrl(tab.url)) {
      // Ensure detector is running on this tab
      if (chrome.scripting && tab.id) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content-scripts/detector.js"],
        }).catch(() => {});
      }
    } else {
      // Clear badge when on regular web pages
      if (chrome.action?.setBadgeText) {
        chrome.action.setBadgeText({ text: "" });
      }
    }
  } catch {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && isSupportedUrl(tab.url)) {
    if (chrome.scripting) {
      chrome.scripting.executeScript({
        target: { tabId },
        files: ["content-scripts/detector.js"],
      }).catch(() => {});
    }
  }
});
