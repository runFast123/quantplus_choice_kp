// QuantsPulse Background Service Worker (Manifest V3)

// 1. Enable Side Panel to open automatically when user clicks the extension toolbar icon
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

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
  }
  return true;
});

// 3. Clear badge when navigating away from finance sites
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab?.url || !/(tradingview|zerodha|groww|dhan|angelone|finance)/i.test(tab.url)) {
      if (chrome.action?.setBadgeText) {
        chrome.action.setBadgeText({ text: "" });
      }
    }
  } catch {}
});
