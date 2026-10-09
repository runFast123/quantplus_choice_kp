// QuantsPulse Ticker Detector Content Script
// Automatically detects active stock tickers on TradingView, Zerodha Kite, Groww, Dhan, Angel One, etc.

(function () {
  const EXCLUDED = new Set([
    "TRADINGVIEW", "CHART", "CHARTS", "WATCHLIST", "UNTITLED", "INDEX", "MARKETS",
    "SEARCH", "QUOTE", "QUOTES", "LIVE", "SHARE", "PRICE", "TODAY", "STOCK", "STOCKS",
    "OVERVIEW", "TECHNICALS", "FINANCIALS", "COMMUNITY", "IDEAS", "SCRIP", "NSE", "BSE",
    "ZERODHA", "KITE", "GROWW", "DHAN", "ANGEL", "ONE", "GOOGLE", "YAHOO", "FINANCE", "INR", "USD"
  ]);

  let lastDetectedSymbol = "";

  function cleanTicker(raw) {
    if (!raw) return "";
    let s = String(raw).trim().toUpperCase();
    if (s.includes(":")) {
      const parts = s.split(":");
      s = parts[parts.length - 1];
    }
    s = s.replace(/\.(NS|BO)$/i, "").replace(/-EQ$/i, "").replace(/[^A-Z0-9&-]/g, "");
    if (s.length < 2 || s.length > 15 || EXCLUDED.has(s)) {
      return "";
    }
    return s;
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

      // A. Check Top Header Symbol Search Button (shows current loaded chart symbol, e.g. "HINDUNILVR")
      const tvHeader = document.querySelector(
        "#header-toolbar-symbol-search, [data-name='header-toolbar-symbol-search'], button[id*='symbol-search'], [class*='symbolSearchText'], [data-role='button'][id*='symbol']"
      );
      if (tvHeader && tvHeader.textContent) {
        const cleaned = cleanTicker(tvHeader.textContent);
        if (cleaned) symbol = cleaned;
      }

      // B. Check Document Title (first token is almost always the active ticker, e.g. "HINDUNILVR 1,856.70 INR...")
      if (!symbol && title) {
        const firstToken = title.trim().split(/[\s,·\-_]+/)[0];
        const cleaned = cleanTicker(firstToken);
        if (cleaned) symbol = cleaned;
      }

      // C. Check Chart Legend series title
      if (!symbol) {
        const legend = document.querySelector("[data-name='legend-source-title'], [data-name='legend-series-item'], .chart-widget .pane-legend-line");
        if (legend && legend.textContent) {
          const cleaned = cleanTicker(legend.textContent);
          if (cleaned) symbol = cleaned;
        }
      }

      // D. Check Active Item in Watchlist sidebar
      if (!symbol) {
        const activeItem = document.querySelector(
          "[data-name='watch-list-item'][class*='active'], [data-name='watch-list-item'][aria-selected='true'], div[class*='selected-'][data-symbol-full], [data-name='watch-list-item'].active"
        );
        if (activeItem) {
          const attr = activeItem.getAttribute("data-symbol-full") || activeItem.getAttribute("data-symbol") || activeItem.textContent;
          const cleaned = cleanTicker(attr);
          if (cleaned) symbol = cleaned;
        }
      }

      // E. Fallback ONLY if all DOM & Title checks were empty: URL param ?symbol=NSE:TCS
      if (!symbol) {
        try {
          const params = new URLSearchParams(window.location.search);
          const symParam = params.get("symbol");
          if (symParam) {
            const cleaned = cleanTicker(symParam);
            if (cleaned) symbol = cleaned;
          }
        } catch {}
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
        const activeItem = document.querySelector(".instrument.selected .nice-name, .order-window .instrument-name, .tv-chart-container .instrument");
        if (activeItem) symbol = cleanTicker(activeItem.textContent);
      }
      if (!symbol && title) {
        const kiteTitleMatch = title.match(/^([A-Z0-9&-]+)\s+[\d,.]+/i);
        if (kiteTitleMatch) symbol = cleanTicker(kiteTitleMatch[1]);
      }
    }

    // 3. Groww
    else if (host.includes("groww.in")) {
      platform = "Groww";
      // Document title often has ticker in parentheses: "... (TCS) Share Price" or starts with it
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
      if (!symbol && href.includes("/stocks/")) {
        const slug = href.split("/stocks/")[1]?.split(/[?#/]/)[0];
        if (slug) {
          const cleanSlug = cleanTicker(slug);
          if (cleanSlug) symbol = cleanSlug;
        }
      }
    }

    // 4. Dhan
    else if (host.includes("dhan.co")) {
      platform = "Dhan";
      const dhanMatch = title.match(/^([A-Z0-9&-]+)\s+[\d,.]+/i);
      if (dhanMatch) symbol = cleanTicker(dhanMatch[1]);
    }

    // 5. Angel One
    else if (host.includes("angelone.in")) {
      platform = "Angel One";
      const angelMatch = title.match(/^([A-Z0-9&-]+)\s+[\d,.]+/i);
      if (angelMatch) symbol = cleanTicker(angelMatch[1]);
    }

    // 6. Google Finance
    else if (host.includes("google.com") && href.includes("/finance")) {
      platform = "Google Finance";
      const gfMatch = href.match(/\/quote\/([A-Z0-9&-]+):(NSE|BSE)/i);
      if (gfMatch) symbol = cleanTicker(gfMatch[1]);
    }

    // 7. Yahoo Finance
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
      }).catch(() => {});
    }
  }

  // Initial detection immediately
  detectSymbol();

  // Watch for SPA URL / Title / DOM changes
  const observer = new MutationObserver(() => {
    detectSymbol();
  });
  observer.observe(document.querySelector("title") || document.documentElement, {
    subtree: true,
    characterData: true,
    childList: true,
  });

  // Listen to user clicks (e.g. clicking a new row in TradingView watchlist)
  document.addEventListener("click", () => {
    setTimeout(detectSymbol, 150);
    setTimeout(detectSymbol, 500);
  }, { passive: true });

  // Listen to keyboard navigation (e.g. arrow keys moving down watchlist)
  document.addEventListener("keyup", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter") {
      setTimeout(detectSymbol, 150);
      setTimeout(detectSymbol, 500);
    }
  }, { passive: true });

  // Fallback periodic sync for any background DOM updates
  setInterval(detectSymbol, 1500);
})();
