// QuantsPulse Ticker Detector Content Script
// Automatically detects active stock tickers on TradingView, Zerodha Kite, Groww, Dhan, Angel One, etc.

(function () {
  let lastDetectedSymbol = "";

  function cleanTicker(raw) {
    if (!raw) return "";
    let s = String(raw).trim().toUpperCase();
    if (s.includes(":")) {
      s = s.split(":")[1];
    }
    s = s.replace(/\.(NS|BO)$/i, "").replace(/-EQ$/i, "").replace(/[^A-Z0-9&-]/g, "");
    return s.length >= 2 && s.length <= 15 ? s : "";
  }

  function detectSymbol() {
    const host = window.location.hostname.toLowerCase();
    const href = window.location.href;
    const title = document.title || "";

    let symbol = "";
    let platform = "Web";

    // 1. TradingView
    if (host.includes("tradingview.com")) {
      platform = "TradingView";
      // Try URL parameter ?symbol=NSE:TCS
      try {
        const params = new URLSearchParams(window.location.search);
        const symParam = params.get("symbol");
        if (symParam) symbol = cleanTicker(symParam);
      } catch {}

      // Try TradingView Legend or Header Symbol Search
      if (!symbol) {
        const tvHeader = document.querySelector("#header-toolbar-symbol-search, [data-name='legend-source-title']");
        if (tvHeader && tvHeader.textContent) {
          symbol = cleanTicker(tvHeader.textContent);
        }
      }

      // Try TradingView Document Title (e.g. "TCS 2084.00 INR ...")
      if (!symbol && title) {
        const match = title.match(/^([A-Z0-9&-]+)\s+[\d,.]+\s*(INR|USD)?/i);
        if (match) symbol = cleanTicker(match[1]);
      }
    }

    // 2. Zerodha Kite
    else if (host.includes("zerodha.com")) {
      platform = "Zerodha Kite";
      // URL match for Chart popup: /chart/ext/tvc/NSE/TCS/
      const kiteUrlMatch = href.match(/\/chart\/(?:ext\/tvc\/)?(?:NSE|BSE)\/([A-Z0-9&-]+)/i);
      if (kiteUrlMatch) {
        symbol = cleanTicker(kiteUrlMatch[1]);
      } else {
        // Active item in marketwatch or order window
        const activeItem = document.querySelector(".instrument.selected .nice-name, .order-window .instrument-name");
        if (activeItem) symbol = cleanTicker(activeItem.textContent);
      }
    }

    // 3. Groww
    else if (host.includes("groww.in")) {
      platform = "Groww";
      // Document title often has ticker in parentheses: "... (TCS) Share Price"
      const growwMatch = title.match(/\(([A-Z0-9&-]+)\)\s+(?:Share|Stock)/i);
      if (growwMatch) {
        symbol = cleanTicker(growwMatch[1]);
      } else {
        const breadcrumb = document.querySelector("h1, .cur-p.fs16");
        if (breadcrumb && breadcrumb.textContent) {
          const m = breadcrumb.textContent.match(/\(([A-Z0-9&-]+)\)/);
          if (m) symbol = cleanTicker(m[1]);
        }
      }
    }

    // 4. Dhan
    else if (host.includes("dhan.co")) {
      platform = "Dhan";
      const dhanMatch = title.match(/^([A-Z0-9&-]+)\s+[\d,.]+/i);
      if (dhanMatch) symbol = cleanTicker(dhanMatch[1]);
    }

    // 5. Google Finance
    else if (host.includes("google.com") && href.includes("/finance")) {
      platform = "Google Finance";
      const gfMatch = href.match(/\/quote\/([A-Z0-9&-]+):(NSE|BSE)/i);
      if (gfMatch) symbol = cleanTicker(gfMatch[1]);
    }

    // 6. Yahoo Finance
    else if (host.includes("finance.yahoo.com")) {
      platform = "Yahoo Finance";
      const yfMatch = href.match(/\/quote\/([A-Z0-9&-]+)\.(?:NS|BO)/i);
      if (yfMatch) symbol = cleanTicker(yfMatch[1]);
    }

    if (symbol && symbol !== lastDetectedSymbol) {
      lastDetectedSymbol = symbol;
      chrome.runtime.sendMessage({
        type: "SYMBOL_DETECTED",
        symbol,
        exchange: "NSE",
        platform,
      });
    }
  }

  // Initial detection
  detectSymbol();

  // Watch for SPA URL / Title changes
  const observer = new MutationObserver(() => {
    detectSymbol();
  });
  observer.observe(document.querySelector("title") || document.documentElement, {
    subtree: true,
    characterData: true,
    childList: true,
  });

  // Check on interval for navigation events
  setInterval(detectSymbol, 2000);
})();
