// QuantsPulse Ticker Detector & Customizable On-Chart Signal HUD Content Script
// Automatically detects active stock tickers and renders real-time Quantitative Signals,
// Asymmetric Trade Plans & Sentiment Audits directly on TradingView, Zerodha Kite, Groww, etc.

(function () {
  // Singleton Guard: Prevent duplicate injections into the same document/frame
  if (window.__qp_detector_loaded) {
    return;
  }
  window.__qp_detector_loaded = true;

  const EXCLUDED = new Set([
    "TRADINGVIEW", "CHART", "CHARTS", "WATCHLIST", "UNTITLED", "UNNAMED", "INDEX", "MARKETS",
    "SEARCH", "QUOTE", "QUOTES", "LIVE", "SHARE", "SHARES", "PRICE", "TODAY", "STOCK", "STOCKS",
    "OVERVIEW", "TECHNICALS", "FINANCIALS", "COMMUNITY", "IDEAS", "SCRIP", "NSE", "BSE", "NFO",
    "ZERODHA", "KITE", "GROWW", "DHAN", "ANGEL", "ONE", "GOOGLE", "YAHOO", "FINANCE", "INR", "USD",
    "1D", "1W", "1M", "1Y", "5D", "5M", "15M", "30M", "1H", "2H", "4H", "D", "W", "M", "Y",
    "BUY", "SELL", "LONG", "SHORT", "CANDLE", "CANDLES", "BAR", "BARS", "EQUITY", "EQ",
    "TRACK", "ALL", "MARKET", "SUPERCHARTS", "SCREENER", "HEATMAP", "ECONOMIC", "CALENDAR"
  ]);

  let isContextDead = false;
  let syncIntervalId = null;
  let mutationObserver = null;
  let titleObserver = null;
  let detectTimer = null;

  let lastDetectedSymbol = "";
  let currentQuoteData = null;
  let hudRoot = null;
  let hudShadow = null;
  let isGlobalDragAttached = false;
  let isDragging = false;
  let startX = 0, startY = 0, origLeft = 0, origTop = 0;

  // Preferences (persisted in localStorage and chrome.storage.local)
  let prefs = {
    displayMode: "full", // "full" | "compact" | "targets_only" | "signal_only"
    showSignal: true,
    showTargets: true,
    showLevels: true,
    showSentiment: true,
    isHidden: false,
    settingsOpen: false,
  };

  try {
    const saved = localStorage.getItem("qp_hud_user_prefs");
    if (saved) {
      prefs = Object.assign(prefs, JSON.parse(saved));
    }
  } catch {}

  // Context Invalidation Guard: Safely shut down when extension is reloaded/uninstalled
  function isExtensionValid() {
    if (isContextDead) return false;
    try {
      if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) {
        destroyContentScript();
        return false;
      }
      return true;
    } catch (e) {
      destroyContentScript();
      return false;
    }
  }

  function destroyContentScript() {
    if (isContextDead) return;
    isContextDead = true;
    try {
      window.__qp_detector_loaded = false;
      if (syncIntervalId) {
        clearInterval(syncIntervalId);
        syncIntervalId = null;
      }
      if (detectTimer) {
        clearTimeout(detectTimer);
        detectTimer = null;
      }
      if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
      }
      if (titleObserver) {
        titleObserver.disconnect();
        titleObserver = null;
      }
      document.removeEventListener("click", onUserInteraction);
      document.removeEventListener("keyup", onUserKeyup);
    } catch (e) {}
  }

  function safeSendMessage(message, callback) {
    if (!isExtensionValid()) return;
    try {
      const res = chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          // Benign error when background receiver doesn't send response
        }
        if (typeof callback === "function") {
          callback(response);
        }
      });
      if (res && typeof res.catch === "function") {
        res.catch(() => {});
      }
    } catch (err) {
      destroyContentScript();
    }
  }

  function safeStorageGet(keys, callback) {
    if (!isExtensionValid()) return;
    try {
      chrome.storage.local.get(keys, (res) => {
        if (chrome.runtime.lastError) return;
        if (typeof callback === "function") {
          callback(res || {});
        }
      });
    } catch (err) {
      destroyContentScript();
    }
  }

  function safeStorageSet(items, callback) {
    if (!isExtensionValid()) return;
    try {
      chrome.storage.local.set(items, () => {
        if (chrome.runtime.lastError) return;
        if (typeof callback === "function") {
          callback();
        }
      });
    } catch (err) {
      destroyContentScript();
    }
  }

  function scheduleDetect(delay = 250) {
    if (!isExtensionValid()) return;
    if (detectTimer) clearTimeout(detectTimer);
    detectTimer = setTimeout(() => {
      detectSymbol();
    }, delay);
  }

  function onUserInteraction() {
    scheduleDetect(150);
  }

  function onUserKeyup(e) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter") {
      scheduleDetect(150);
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem("qp_hud_user_prefs", JSON.stringify(prefs));
      safeStorageSet({ qpHudPrefs: prefs });
    } catch {}
  }

  function cleanTicker(raw) {
    if (!raw) return "";
    let s = String(raw).trim().toUpperCase();
    if (s.includes(":")) {
      const parts = s.split(":");
      s = parts[parts.length - 1];
    }
    s = s.replace(/\.(NS|BO)$/i, "").replace(/-EQ$/i, "").replace(/[^A-Z0-9&-]/g, "");
    if (s === "NIFTY50" || s === "CNXNIFTY" || s === "NIFTY-50") s = "NIFTY";
    if (s === "NIFTYBANK" || s === "CNXBANK") s = "BANKNIFTY";
    if (s.length < 2 || s.length > 15 || EXCLUDED.has(s)) {
      return "";
    }
    if (/^\d+$/.test(s)) return ""; // purely numeric
    return s;
  }

  function extractTickerFromText(text) {
    if (!text) return "";
    const sText = String(text).trim();
    if (sText.startsWith("TradingView") || sText.startsWith("Unnamed")) return "";

    const colonMatch = sText.match(/(?:NSE|BSE)\s*:\s*([A-Z0-9&-]{2,15})/i);
    if (colonMatch) {
      const c = cleanTicker(colonMatch[1]);
      if (c) return c;
    }
    const parenMatch = sText.match(/\(([A-Z0-9&-]{2,15})\)/i);
    if (parenMatch) {
      const c = cleanTicker(parenMatch[1]);
      if (c) return c;
    }
    const tokens = sText.split(/[\s,·|_\-\/\(\)]+/);
    for (const t of tokens) {
      const c = cleanTicker(t);
      if (c) return c;
    }
    return "";
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

      // A. Check Document Title (e.g. "HDFCBANK 707.25 INR...", "HDFCBANK Stock Price...")
      if (title && !title.startsWith("TradingView") && !title.startsWith("Unnamed")) {
        const sym = extractTickerFromText(title);
        if (sym) symbol = sym;
      }

      // B. Check URL parameter or pathname
      if (!symbol) {
        try {
          const params = new URLSearchParams(window.location.search);
          const symParam = params.get("symbol");
          if (symParam) {
            const sym = extractTickerFromText(symParam);
            if (sym) symbol = sym;
          }
          if (!symbol && href.includes("/symbols/")) {
            const pathParts = window.location.pathname.split("/symbols/")[1];
            if (pathParts) {
              const sym = extractTickerFromText(pathParts);
              if (sym) symbol = sym;
            }
          }
        } catch {}
      }

      // C. Check Top Header Symbol Search Button (shows current loaded chart symbol)
      if (!symbol) {
        const tvHeader = document.querySelector(
          "#header-toolbar-symbol-search, [data-name='header-toolbar-symbol-search'], button[id*='symbol-search'], div[id*='symbol-search'], [class*='symbolSearchText'], [data-role='button'][id*='symbol'], div[class*='symbolSearch']"
        );
        if (tvHeader && tvHeader.textContent) {
          const sym = extractTickerFromText(tvHeader.textContent);
          if (sym) symbol = sym;
        }
      }

      // D. Check Chart Legend series title (top left of chart canvas)
      if (!symbol) {
        const legendEls = document.querySelectorAll(
          "[data-name='legend-source-title'], [data-name='legend-series-item'], div[class*='legendSourceTitle'], div[class*='titleWrapper'], div[class*='seriesTitle'], .chart-widget .pane-legend-line, div[class*='pane-legend']"
        );
        for (const el of legendEls) {
          if (el && el.textContent) {
            const sym = extractTickerFromText(el.textContent);
            if (sym) {
              symbol = sym;
              break;
            }
          }
        }
      }

      // E. Check Watchlist sidebar / Quote Details pane (Right sidebar)
      if (!symbol) {
        const sidebarEls = document.querySelectorAll(
          "[data-name='symbol-title'], [data-name='quote-ticker'], div[class*='symbolTitle'], div[class*='symbol-title'], div[class*='symbolName'], [data-name='watch-list-item'][class*='active'], [data-name='watch-list-item'][aria-selected='true']"
        );
        for (const el of sidebarEls) {
          const raw = el.getAttribute("data-symbol-full") || el.getAttribute("data-symbol") || el.textContent;
          if (raw) {
            const sym = extractTickerFromText(raw);
            if (sym) {
              symbol = sym;
              break;
            }
          }
        }
      }
    }

    // 2. Zerodha Kite
    else if (host.includes("zerodha.com")) {
      platform = "Zerodha Kite";
      const kiteUrlMatch = href.match(/\/chart\/(?:ext\/tvc\/)?(?:NSE|BSE)\/([A-Z0-9&-]+)/i);
      if (kiteUrlMatch) {
        symbol = cleanTicker(kiteUrlMatch[1]);
      } else {
        const activeItem = document.querySelector(".instrument.selected .nice-name, .order-window .instrument-name, .tv-chart-container .instrument");
        if (activeItem) symbol = extractTickerFromText(activeItem.textContent);
      }
      if (!symbol && title) {
        symbol = extractTickerFromText(title);
      }
    }

    // 3. Groww
    else if (host.includes("groww.in")) {
      platform = "Groww";
      const growwMatch = title.match(/\(([A-Z0-9&-]+)\)\s+(?:Share|Stock)/i);
      if (growwMatch) {
        symbol = cleanTicker(growwMatch[1]);
      } else {
        const breadcrumb = document.querySelector("h1, .cur-p.fs16");
        if (breadcrumb && breadcrumb.textContent) {
          symbol = extractTickerFromText(breadcrumb.textContent);
        }
      }
      if (!symbol && href.includes("/stocks/")) {
        const slug = href.split("/stocks/")[1]?.split(/[?#/]/)[0];
        if (slug) {
          symbol = cleanTicker(slug);
        }
      }
    }

    // 4. Dhan
    else if (host.includes("dhan.co")) {
      platform = "Dhan";
      symbol = extractTickerFromText(title);
    }

    // 5. Angel One
    else if (host.includes("angelone.in")) {
      platform = "Angel One";
      symbol = extractTickerFromText(title);
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
      safeSendMessage({
        type: "SYMBOL_DETECTED",
        symbol,
        exchange: "NSE",
        platform,
      });

      // Fetch quote & render on-chart HUD
      fetchAndRenderHud(symbol);
    }
  }

  // ---------------------------------------------------------------------------
  // ON-CHART SIGNAL HUD (Isolated Shadow DOM Overlay with User Customizations)
  // ---------------------------------------------------------------------------

  function renderHudLoading(symbol) {
    if (!symbol || prefs.isHidden) return;
    const shadow = getOrCreateShadowRoot();
    if (!shadow) return;

    let savedPos = { top: "65px", left: "75px" };
    try {
      const stored = localStorage.getItem("qp_hud_coords");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.top && parsed.left) savedPos = parsed;
      }
    } catch {}

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .hud-loading {
          position: fixed;
          top: ${savedPos.top};
          left: ${savedPos.left};
          z-index: 2147483647;
          pointer-events: auto;
          background: rgba(20, 20, 20, 0.95);
          color: #ECEBE4;
          border: 1px solid #333333;
          border-radius: 8px;
          box-shadow: 0 10px 32px rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
          font-size: 11.5px;
          padding: 8px 12px;
          display: flex;
          align-items: center;
          gap: 8px;
          user-select: none;
        }
        .tag-sym {
          font-size: 11px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 3px;
          background: #333333;
          color: #F26A4B;
        }
        .pulse-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #F26A4B;
          animation: qpPulse 1.2s infinite ease-in-out;
        }
        @keyframes qpPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1.15); }
        }
      </style>
      <div class="hud-loading">
        <div class="pulse-dot"></div>
        <span class="tag-sym">${symbol}</span>
        <span style="color:#A1A1AA; font-size:11px;">Syncing QuantsPulse Signals...</span>
      </div>
    `;
  }

  function fetchAndRenderHud(symbol) {
    if (!symbol) return;
    safeStorageGet(["showChartOverlay", "activeQuoteData", "qpHudPrefs", "backendUrl"], (res) => {
      if (!res) return;
      if (res.qpHudPrefs) prefs = Object.assign(prefs, res.qpHudPrefs);
      if (res.showChartOverlay === false) {
        if (hudRoot) hudRoot.style.display = "none";
        return;
      }
      prefs.isHidden = false;

      // 1. Instant Cache Render: If storage already has this symbol's quote, render it immediately
      if (res.activeQuoteData && res.activeQuoteData.symbol === symbol) {
        currentQuoteData = res.activeQuoteData;
        renderHud(res.activeQuoteData);
      } else {
        // Immediate visual feedback so user sees the HUD right away
        renderHudLoading(symbol);
      }

      // 2. Fetch via background service worker
      safeSendMessage(
        { type: "FETCH_QUOTE_DATA", symbol, exchange: "NSE" },
        (resp) => {
          if (!resp || !resp.ok || !resp.data) {
            // Direct fetch fallback if background worker is asleep
            directFetchFallback(symbol, res.backendUrl);
            return;
          }
          currentQuoteData = resp.data;
          renderHud(resp.data);
        }
      );
    });
  }

  function directFetchFallback(symbol, backendUrl) {
    const base = (backendUrl || "https://quantplus-ten.vercel.app").replace(/\/$/, "");
    fetch(`${base}/api/extension/quote?symbol=${encodeURIComponent(symbol)}&exchange=NSE`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (data && data.symbol) {
          currentQuoteData = data;
          safeStorageSet({ activeQuoteData: data, activeSymbol: data.symbol });
          renderHud(data);
        }
      })
      .catch(() => {});
  }

  function getOrCreateShadowRoot() {
    if (!hudRoot || !document.contains(hudRoot)) {
      hudRoot = document.getElementById("quantspulse-chart-hud-root");
      if (!hudRoot) {
        hudRoot = document.createElement("div");
        hudRoot.id = "quantspulse-chart-hud-root";
        hudShadow = hudRoot.attachShadow({ mode: "open" });
      } else {
        hudShadow = hudRoot.shadowRoot || hudShadow;
      }
    }

    hudRoot.style.all = "initial";
    hudRoot.style.position = "fixed";
    hudRoot.style.top = "0";
    hudRoot.style.left = "0";
    hudRoot.style.width = "0";
    hudRoot.style.height = "0";
    hudRoot.style.overflow = "visible";
    hudRoot.style.pointerEvents = "none";
    hudRoot.style.zIndex = "2147483647";
    hudRoot.style.display = "block";

    const targetParent = document.body || document.documentElement;
    if (targetParent && !targetParent.contains(hudRoot)) {
      targetParent.appendChild(hudRoot);
    }
    return hudShadow;
  }

  function formatRupees(num) {
    if (num == null || isNaN(num)) return "—";
    return "₹" + Number(num).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function renderHud(data) {
    if (!data || !data.symbol) return;
    const shadow = getOrCreateShadowRoot();

    // Default: Top-Left at top: 65px; left: 75px (clear of right watchlist and side panel)
    let savedPos = { top: "65px", left: "75px", right: "auto", bottom: "auto" };
    try {
      const stored = localStorage.getItem("qp_hud_coords");
      if (stored) {
        const parsed = JSON.parse(stored);
        const topN = parseInt(parsed.top, 10);
        const leftN = parseInt(parsed.left, 10);
        if (!isNaN(topN) && topN >= 45 && topN < window.innerHeight - 80) {
          savedPos.top = `${topN}px`;
        }
        if (!isNaN(leftN) && leftN >= 50 && leftN < window.innerWidth - 380) {
          savedPos.left = `${leftN}px`;
          savedPos.right = "auto";
        }
      }
    } catch {}

    const isBuy = data.latestSignal?.kind === "buy";
    const hasSignal = !!data.latestSignal;
    const p = data.tradePlan;
    const chg = data.change_pct;
    const isGain = chg != null && chg >= 0;

    const deltaText = chg != null ? `${isGain ? "▲ +" : "▼ "}${chg.toFixed(2)}% (${formatRupees(data.change)})` : "";
    const deltaColor = isGain ? "#34D399" : "#F87171";

    const t1Gain = p && p.entry ? (((p.t1 - p.entry) / p.entry) * 100).toFixed(1) : "0.0";
    const t2Gain = p && p.entry ? (((p.t2 - p.entry) / p.entry) * 100).toFixed(1) : "0.0";
    const t3Gain = p && p.entry ? (((p.t3 - p.entry) / p.entry) * 100).toFixed(1) : "0.0";
    const stopLossGain = p && p.riskPercent ? p.riskPercent.toFixed(1) : "0.0";

    const pineScriptCode = generateCleanPineScript(data);

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        .num {
          font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
          font-feature-settings: "tnum" 1;
        }
        .hud-container {
          position: fixed;
          top: ${savedPos.top};
          left: ${savedPos.left};
          right: ${savedPos.right};
          bottom: ${savedPos.bottom};
          z-index: 2147483647;
          pointer-events: auto;
          background: rgba(20, 20, 20, 0.95);
          color: #ECEBE4;
          border: 1px solid #333333;
          border-radius: 8px;
          box-shadow: 0 10px 32px rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          font-size: 12px;
          line-height: 1.4;
          user-select: none;
          min-width: 330px;
          max-width: 360px;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .hud-container.is-compact {
          min-width: auto;
          max-width: none;
          border-radius: 20px;
          padding: 4px 10px;
        }
        .hud-container.is-targets-only {
          min-width: auto;
          max-width: none;
          border-radius: 8px;
          padding: 6px 10px;
        }
        .hud-container.is-signal-only {
          min-width: auto;
          max-width: none;
          border-radius: 20px;
          padding: 4px 12px;
        }
        .hud-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 10px;
          background: rgba(30, 30, 30, 0.9);
          border-bottom: 1px solid #2E2E2E;
          border-top-left-radius: 8px;
          border-top-right-radius: 8px;
          cursor: grab;
        }
        .hud-header:active { cursor: grabbing; }
        .hud-container.is-compact .hud-header,
        .hud-container.is-targets-only .hud-header,
        .hud-container.is-signal-only .hud-header {
          padding: 0;
          background: transparent;
          border-bottom: none;
          border-radius: 0;
        }
        .brand-section {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .logo-mark {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          background: #2E2E2E;
          border-radius: 4px;
        }
        .brand-title {
          font-weight: 700;
          font-size: 11.5px;
          color: #ECEBE4;
        }
        .tag-symbol {
          font-size: 10px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 3px;
          background: #333333;
          color: #F26A4B;
        }
        .header-tools {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .btn-tool {
          background: none;
          border: 1px solid #3A3A3A;
          color: #94938B;
          border-radius: 4px;
          padding: 2px 5px;
          font-size: 10px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 3px;
          transition: all 0.15s ease;
        }
        .btn-tool:hover {
          color: #FFFFFF;
          border-color: #666666;
          background: rgba(255, 255, 255, 0.08);
        }
        .btn-tool.active {
          color: #F26A4B;
          border-color: #F26A4B;
          background: rgba(242, 106, 75, 0.12);
        }
        /* Customizer Dropdown */
        .settings-drawer {
          background: #181818;
          border-bottom: 1px solid #2E2E2E;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 10.5px;
        }
        .settings-drawer.hidden { display: none; }
        .mode-buttons {
          display: flex;
          gap: 4px;
          margin-bottom: 4px;
        }
        .btn-mode {
          flex: 1;
          padding: 3px 4px;
          font-size: 9.5px;
          font-weight: 600;
          background: #242424;
          border: 1px solid #333;
          color: #999;
          border-radius: 3px;
          cursor: pointer;
          text-align: center;
        }
        .btn-mode.active {
          background: #2E2E2E;
          border-color: #F26A4B;
          color: #FFF;
        }
        .settings-checks {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4px;
          color: #AAA;
        }
        .settings-checks label {
          display: flex;
          align-items: center;
          gap: 4px;
          cursor: pointer;
        }
        .dock-row {
          display: flex;
          align-items: center;
          gap: 4px;
          padding-top: 4px;
          border-top: 1px dashed #2A2A2A;
          color: #777;
          font-size: 9.5px;
        }
        .btn-dock {
          background: #222;
          border: 1px solid #333;
          color: #888;
          padding: 1px 4px;
          border-radius: 3px;
          font-size: 9px;
          cursor: pointer;
        }
        .btn-dock:hover { color: #FFF; border-color: #555; }
        /* Expanded Content */
        .hud-body {
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .quote-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          padding-bottom: 6px;
          border-bottom: 1px dashed #2E2E2E;
        }
        .quote-price {
          font-size: 17px;
          font-weight: 700;
        }
        .quote-delta {
          font-size: 11px;
          font-weight: 600;
          color: ${deltaColor};
          margin-left: 6px;
        }
        /* Signal Card */
        .signal-box {
          border-radius: 6px;
          padding: 8px 10px;
          background: ${hasSignal ? (isBuy ? "rgba(11, 106, 78, 0.18)" : "rgba(168, 56, 11, 0.18)") : "#202020"};
          border: 1px solid ${hasSignal ? (isBuy ? "rgba(52, 211, 153, 0.35)" : "rgba(248, 113, 113, 0.35)") : "#333333"};
        }
        .signal-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
        }
        .signal-pill {
          font-size: 10.5px;
          font-weight: 800;
          padding: 2px 6px;
          border-radius: 3px;
          letter-spacing: 0.04em;
          background: ${hasSignal ? (isBuy ? "#0B6A4E" : "#A8380B") : "#3A3A3A"};
          color: #FFFFFF;
        }
        .signal-name {
          font-size: 12.5px;
          font-weight: 600;
          margin-bottom: 6px;
        }
        .signal-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
          padding-top: 4px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          font-size: 11px;
        }
        .signal-metric dt { color: #94938B; font-size: 9.5px; text-transform: uppercase; }
        .signal-metric dd { font-weight: 600; margin-top: 1px; }
        /* Trade Plan Targets */
        .plan-title {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #94938B;
          margin-bottom: 4px;
        }
        .targets-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 4px;
        }
        .target-col {
          background: #1F1F1F;
          border: 1px solid #2E2E2E;
          border-radius: 4px;
          padding: 4px;
          text-align: center;
        }
        .target-col.is-stop { border-color: rgba(248, 113, 113, 0.3); }
        .target-col.is-t3 { border-color: rgba(52, 211, 153, 0.3); }
        .target-label { font-size: 9px; font-weight: 700; color: #94938B; }
        .target-pct { font-size: 9.5px; font-weight: 600; }
        .target-pct.gain { color: #34D399; }
        .target-pct.loss { color: #F87171; }
        .target-val { font-size: 11px; font-weight: 700; margin-top: 1px; }
        /* Key Levels & Sentiment */
        .levels-row {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: #94938B;
          background: #1C1C1C;
          padding: 4px 8px;
          border-radius: 4px;
        }
        .levels-row span b { color: #ECEBE4; font-weight: 600; }
        /* Footer Link */
        .hud-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-top: 4px;
          border-top: 1px solid #2A2A2A;
        }
        .footer-link {
          color: #F26A4B;
          text-decoration: none;
          font-size: 11px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 3px;
        }
        .footer-link:hover { text-decoration: underline; }
        .pine-link { color: #94938B; cursor: pointer; font-size: 10.5px; }
        .pine-link:hover { color: #FFFFFF; }
        /* Floating Restore Bubble */
        .bubble-restore {
          position: fixed;
          bottom: 24px;
          left: 65px;
          right: auto;
          z-index: 2147483647;
          pointer-events: auto;
          background: #F26A4B;
          color: #FFFFFF;
          border: none;
          border-radius: 20px;
          padding: 6px 12px;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 4px 16px rgba(0,0,0,0.4);
          display: flex;
          align-items: center;
          gap: 5px;
        }
      </style>

      ${prefs.isHidden ? `
        <button id="btn-restore-hud" class="bubble-restore" title="Restore QuantsPulse Chart Overlay">
          <span>⚡ QuantsPulse (${data.symbol})</span>
        </button>
      ` : `
        <div id="qp-hud-box" class="hud-container ${prefs.displayMode === "compact" ? "is-compact" : prefs.displayMode === "targets_only" ? "is-targets-only" : prefs.displayMode === "signal_only" ? "is-signal-only" : ""}">
          
          <!-- MODE: COMPACT BAR -->
          ${prefs.displayMode === "compact" ? `
            <div class="hud-header" id="qp-drag-handle">
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="tag-symbol">${data.symbol}</span>
                <span class="num">${formatRupees(data.last_price)}</span>
                ${hasSignal ? `
                  <span class="num" style="font-size:10px; font-weight:700; padding:2px 6px; border-radius:3px; background:${isBuy ? "#0B6A4E" : "#A8380B"}; color:#FFF;">
                    ${isBuy ? "▲ BUY" : "▼ EXIT"} @ ${formatRupees(data.latestSignal.price)}
                  </span>
                ` : `<span style="font-size:10px; color:#888;">CONSOLIDATION</span>`}
                ${p ? `
                  <span class="num" style="color:#F87171; font-size:10px;">Stop ${formatRupees(p.stop)}</span>
                  <span class="num" style="color:#34D399; font-size:10px;">T1 ${formatRupees(p.t1)}</span>
                ` : ""}
                <button id="btn-settings-hud" class="btn-tool ${prefs.settingsOpen ? "active" : ""}" title="Customizer">⚙</button>
                <button id="btn-set-mode-full" class="btn-tool" title="Expand Full Card">⤢</button>
                <button id="btn-close-hud" class="btn-tool" title="Close">✕</button>
              </div>
            </div>
          ` : ""}

          <!-- MODE: TARGETS ONLY -->
          ${prefs.displayMode === "targets_only" ? `
            <div class="hud-header" id="qp-drag-handle">
              <div style="display:flex; align-items:center; gap:6px;">
                <span class="tag-symbol">${data.symbol}</span>
                ${p ? `
                  <span class="num" style="font-size:10px; color:#F87171; background:#222; padding:2px 5px; border-radius:3px; border:1px solid rgba(248,113,113,0.3);">Stop ${formatRupees(p.stop)}</span>
                  <span class="num" style="font-size:10px; color:#34D399; background:#222; padding:2px 5px; border-radius:3px; border:1px solid rgba(52,211,153,0.3);">T1 ${formatRupees(p.t1)}</span>
                  <span class="num" style="font-size:10px; color:#34D399; background:#222; padding:2px 5px; border-radius:3px; border:1px solid rgba(52,211,153,0.3);">T2 ${formatRupees(p.t2)}</span>
                  <span class="num" style="font-size:10px; color:#34D399; background:#222; padding:2px 5px; border-radius:3px; border:1px solid rgba(52,211,153,0.3);">T3 ${formatRupees(p.t3)}</span>
                ` : "<span>No Active Plan</span>"}
                <button id="btn-settings-hud" class="btn-tool" title="Customizer">⚙</button>
                <button id="btn-set-mode-full" class="btn-tool" title="Full View">⤢</button>
                <button id="btn-close-hud" class="btn-tool" title="Close">✕</button>
              </div>
            </div>
          ` : ""}

          <!-- MODE: SIGNAL ONLY -->
          ${prefs.displayMode === "signal_only" ? `
            <div class="hud-header" id="qp-drag-handle">
              <div style="display:flex; align-items:center; gap:6px;">
                <span class="tag-symbol">${data.symbol}</span>
                ${hasSignal ? `
                  <span style="font-size:10.5px; font-weight:700; color:#FFF; background:${isBuy ? "#0B6A4E" : "#A8380B"}; padding:2px 8px; border-radius:12px;">
                    ${isBuy ? "▲ BUY SIGNAL" : "▼ EXIT SIGNAL"} · ${data.latestSignal.label} (Trigger: ${formatRupees(data.latestSignal.price)})
                  </span>
                ` : `<span style="font-size:10.5px; color:#888;">Consolidation</span>`}
                <button id="btn-settings-hud" class="btn-tool" title="Customizer">⚙</button>
                <button id="btn-set-mode-full" class="btn-tool" title="Full View">⤢</button>
                <button id="btn-close-hud" class="btn-tool" title="Close">✕</button>
              </div>
            </div>
          ` : ""}

          <!-- MODE: FULL TERMINAL CARD -->
          ${prefs.displayMode === "full" ? `
            <div class="hud-header" id="qp-drag-handle">
              <div class="brand-section">
                <div class="logo-mark">
                  <svg viewBox="0 0 32 32" width="12" height="12">
                    <path d="M6 18.5h6.2l2.1-7.5 3.4 11 2.3-6.2 1.3 2.7H26" fill="none" stroke="#E6E4D7" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle cx="26" cy="18.5" r="2.5" fill="#F26A4B"/>
                  </svg>
                </div>
                <span class="brand-title">QuantsPulse</span>
                <span class="tag-symbol">${data.symbol}</span>
              </div>
              <div class="header-tools">
                <button id="btn-settings-hud" class="btn-tool ${prefs.settingsOpen ? "active" : ""}" title="Customizer / Layout">⚙</button>
                <button id="btn-copy-pine" class="btn-tool" title="Copy TradingView Pine Script Indicator">📋 Pine</button>
                <button id="btn-set-mode-compact" class="btn-tool" title="Minimize to compact bar">—</button>
                <button id="btn-close-hud" class="btn-tool" title="Close">✕</button>
              </div>
            </div>
          ` : ""}

          <!-- On-Chart Customizer Drawer -->
          <div id="qp-settings-drawer" class="settings-drawer ${prefs.settingsOpen ? "" : "hidden"}">
            <div style="font-size:10px; font-weight:700; color:#888; text-transform:uppercase;">HUD Layout Style</div>
            <div class="mode-buttons">
              <button class="btn-mode ${prefs.displayMode === "full" ? "active" : ""}" data-setmode="full">Full Card</button>
              <button class="btn-mode ${prefs.displayMode === "compact" ? "active" : ""}" data-setmode="compact">Compact Bar</button>
              <button class="btn-mode ${prefs.displayMode === "targets_only" ? "active" : ""}" data-setmode="targets_only">Targets Only</button>
              <button class="btn-mode ${prefs.displayMode === "signal_only" ? "active" : ""}" data-setmode="signal_only">Signal Only</button>
            </div>
            <div style="font-size:10px; font-weight:700; color:#888; text-transform:uppercase; margin-top:2px;">Components</div>
            <div class="settings-checks">
              <label><input type="checkbox" id="chk-signal" ${prefs.showSignal ? "checked" : ""}> Signal Card</label>
              <label><input type="checkbox" id="chk-targets" ${prefs.showTargets ? "checked" : ""}> Targets (T1-T3)</label>
              <label><input type="checkbox" id="chk-levels" ${prefs.showLevels ? "checked" : ""}> Key Levels</label>
              <label><input type="checkbox" id="chk-sentiment" ${prefs.showSentiment ? "checked" : ""}> RSI Sentiment</label>
            </div>
            <div class="dock-row">
              <span>Snap:</span>
              <button class="btn-dock" data-dock="top-right">Top-Right</button>
              <button class="btn-dock" data-dock="top-left">Top-Left</button>
              <button class="btn-dock" data-dock="bottom-right">Bottom-Right</button>
              <button class="btn-dock" data-dock="bottom-left">Bottom-Left</button>
            </div>
          </div>

          <!-- FULL BODY (Visible only when in "full" mode) -->
          ${prefs.displayMode === "full" ? `
            <div class="hud-body">
              <!-- Live Quote -->
              <div class="quote-row">
                <div>
                  <span class="num quote-price">${formatRupees(data.last_price)}</span>
                  <span class="num quote-delta">${deltaText}</span>
                </div>
                <div style="font-size:10px;color:#94938B;">
                  ${data.sector || "NSE Equity"}
                </div>
              </div>

              <!-- Quantitative Signal Card -->
              ${prefs.showSignal ? `
                <div class="signal-box">
                  <div class="signal-top">
                    <span class="signal-pill">
                      ${hasSignal ? (isBuy ? "▲ BUY SIGNAL" : "▼ EXIT SIGNAL") : "⚖ IN CONSOLIDATION"}
                    </span>
                    ${data.latestSignal?.date ? `
                      <span class="num signal-date">${new Date(data.latestSignal.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
                    ` : ""}
                  </div>
                  <div class="signal-name">
                    ${hasSignal ? data.latestSignal.label : "Mean-reversion Equilibrium / Range"}
                  </div>
                  <div class="signal-grid">
                    <div class="signal-metric">
                      <dt>Entry Trigger</dt>
                      <dd class="num">${hasSignal ? formatRupees(data.latestSignal.price) : formatRupees(data.last_price)}</dd>
                    </div>
                    <div class="signal-metric">
                      <dt>Protective Stop</dt>
                      <dd class="num" style="color:#F87171;">${p ? formatRupees(p.stop) : "—"}</dd>
                    </div>
                  </div>
                </div>
              ` : ""}

              <!-- Asymmetric Trade Plan Multiples -->
              ${prefs.showTargets && p ? `
                <div>
                  <div class="plan-title">Asymmetric Targets (0.75R / 2.0R / 3.0R)</div>
                  <div class="targets-grid">
                    <div class="target-col is-stop">
                      <div class="target-label">STOP</div>
                      <div class="num target-pct loss">-${stopLossGain}%</div>
                      <div class="num target-val">${formatRupees(p.stop)}</div>
                    </div>
                    <div class="target-col">
                      <div class="target-label">T1 0.75R</div>
                      <div class="num target-pct gain">+${t1Gain}%</div>
                      <div class="num target-val">${formatRupees(p.t1)}</div>
                    </div>
                    <div class="target-col">
                      <div class="target-label">T2 2.0R</div>
                      <div class="num target-pct gain">+${t2Gain}%</div>
                      <div class="num target-val">${formatRupees(p.t2)}</div>
                    </div>
                    <div class="target-col is-t3">
                      <div class="target-label">T3 3.0R</div>
                      <div class="num target-pct gain">+${t3Gain}%</div>
                      <div class="num target-val">${formatRupees(p.t3)}</div>
                    </div>
                  </div>
                </div>
              ` : ""}

              <!-- Key Levels & Sentiment -->
              ${prefs.showLevels || prefs.showSentiment ? `
                <div class="levels-row num">
                  ${prefs.showLevels ? `
                    <span>SMA20 <b>${data.sma20 ? formatRupees(data.sma20) : "—"}</b></span>
                    <span>SMA50 <b>${data.sma50 ? formatRupees(data.sma50) : "—"}</b></span>
                  ` : ""}
                  ${prefs.showSentiment ? `
                    <span>RSI <b>${data.sentiment?.rsi != null ? data.sentiment.rsi.toFixed(1) : "—"}</b></span>
                  ` : ""}
                </div>
              ` : ""}

              <!-- Footer -->
              <div class="hud-footer">
                <a href="${data.quantPulseUrl || `https://quantplus-ten.vercel.app/app/markets/${encodeURIComponent(data.symbol)}`}" target="_blank" class="footer-link">
                  Open QuantsPulse Terminal ↗
                </a>
                <span id="btn-copy-pine-foot" class="pine-link">📋 Copy Pine Script</span>
              </div>
            </div>
          ` : ""}
        </div>
      `}
    `;

    // Wire HUD Event Listeners
    wireHudEvents(shadow, pineScriptCode, data);
  }

  function wireHudEvents(shadow, pineScriptCode, data) {
    // Restore from bubble
    const btnRestore = shadow.getElementById("btn-restore-hud");
    if (btnRestore) {
      btnRestore.addEventListener("click", () => {
        prefs.isHidden = false;
        savePrefs();
        if (currentQuoteData) renderHud(currentQuoteData);
      });
    }

    // Close / Hide
    const btnClose = shadow.getElementById("btn-close-hud");
    if (btnClose) {
      btnClose.addEventListener("click", () => {
        prefs.isHidden = true;
        savePrefs();
        if (currentQuoteData) renderHud(currentQuoteData);
      });
    }

    // Settings Toggle
    const btnSettings = shadow.getElementById("btn-settings-hud");
    if (btnSettings) {
      btnSettings.addEventListener("click", () => {
        prefs.settingsOpen = !prefs.settingsOpen;
        savePrefs();
        if (currentQuoteData) renderHud(currentQuoteData);
      });
    }

    // Mode Switchers
    const btnSetFull = shadow.getElementById("btn-set-mode-full");
    if (btnSetFull) {
      btnSetFull.addEventListener("click", () => {
        prefs.displayMode = "full";
        savePrefs();
        if (currentQuoteData) renderHud(currentQuoteData);
      });
    }

    const btnSetCompact = shadow.getElementById("btn-set-mode-compact");
    if (btnSetCompact) {
      btnSetCompact.addEventListener("click", () => {
        prefs.displayMode = "compact";
        savePrefs();
        if (currentQuoteData) renderHud(currentQuoteData);
      });
    }

    // Mode buttons in settings drawer
    shadow.querySelectorAll(".btn-mode").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-setmode");
        if (mode) {
          prefs.displayMode = mode;
          savePrefs();
          if (currentQuoteData) renderHud(currentQuoteData);
        }
      });
    });

    // Checkbox toggles in settings drawer
    const chkSignal = shadow.getElementById("chk-signal");
    if (chkSignal) {
      chkSignal.addEventListener("change", (e) => {
        prefs.showSignal = e.target.checked;
        savePrefs();
        if (currentQuoteData) renderHud(currentQuoteData);
      });
    }

    const chkTargets = shadow.getElementById("chk-targets");
    if (chkTargets) {
      chkTargets.addEventListener("change", (e) => {
        prefs.showTargets = e.target.checked;
        savePrefs();
        if (currentQuoteData) renderHud(currentQuoteData);
      });
    }

    const chkLevels = shadow.getElementById("chk-levels");
    if (chkLevels) {
      chkLevels.addEventListener("change", (e) => {
        prefs.showLevels = e.target.checked;
        savePrefs();
        if (currentQuoteData) renderHud(currentQuoteData);
      });
    }

    const chkSentiment = shadow.getElementById("chk-sentiment");
    if (chkSentiment) {
      chkSentiment.addEventListener("change", (e) => {
        prefs.showSentiment = e.target.checked;
        savePrefs();
        if (currentQuoteData) renderHud(currentQuoteData);
      });
    }

    // Snap Dock positions
    shadow.querySelectorAll(".btn-dock").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dock = btn.getAttribute("data-dock");
        let newPos = { top: "65px", left: "75px", right: "auto", bottom: "auto" };
        if (dock === "top-right") newPos = { top: "65px", left: `${Math.max(50, window.innerWidth - 420)}px`, right: "auto", bottom: "auto" };
        if (dock === "top-left") newPos = { top: "65px", left: "75px", right: "auto", bottom: "auto" };
        if (dock === "bottom-right") newPos = { top: `${Math.max(50, window.innerHeight - 380)}px`, left: `${Math.max(50, window.innerWidth - 420)}px`, right: "auto", bottom: "auto" };
        if (dock === "bottom-left") newPos = { top: `${Math.max(50, window.innerHeight - 380)}px`, left: "75px", right: "auto", bottom: "auto" };
        try {
          localStorage.setItem("qp_hud_coords", JSON.stringify(newPos));
        } catch {}
        if (currentQuoteData) renderHud(currentQuoteData);
      });
    });

    // Copy Pine Script
    const copyBtns = [shadow.getElementById("btn-copy-pine"), shadow.getElementById("btn-copy-pine-foot")].filter(Boolean);
    copyBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(pineScriptCode).then(() => {
          const original = btn.textContent;
          btn.textContent = "✓ Copied!";
          setTimeout(() => { btn.textContent = original; }, 2000);
        });
      });
    });

    // Drag and Drop Handling
    const dragHandle = shadow.getElementById("qp-drag-handle");
    const hudBox = shadow.getElementById("qp-hud-box");
    if (dragHandle && hudBox) {
      dragHandle.addEventListener("mousedown", (e) => {
        const tag = (e.target.tagName || "").toUpperCase();
        if (tag === "BUTTON" || tag === "INPUT" || tag === "SELECT" || tag === "LABEL") return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = hudBox.getBoundingClientRect();
        origLeft = rect.left;
        origTop = rect.top;
        e.preventDefault();
      });
    }

    // Attach global window drag handlers once to prevent memory leaks
    if (!isGlobalDragAttached) {
      isGlobalDragAttached = true;

      window.addEventListener("mousemove", (e) => {
        if (!isDragging || !hudShadow) return;
        const currentBox = hudShadow.getElementById("qp-hud-box");
        if (!currentBox) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const newLeft = Math.max(10, Math.min(window.innerWidth - currentBox.offsetWidth - 10, origLeft + dx));
        const newTop = Math.max(10, Math.min(window.innerHeight - 60, origTop + dy));

        currentBox.style.left = `${newLeft}px`;
        currentBox.style.top = `${newTop}px`;
        currentBox.style.right = "auto";
        currentBox.style.bottom = "auto";
      });

      window.addEventListener("mouseup", () => {
        if (isDragging && hudShadow) {
          isDragging = false;
          const currentBox = hudShadow.getElementById("qp-hud-box");
          if (currentBox) {
            try {
              const rect = currentBox.getBoundingClientRect();
              localStorage.setItem(
                "qp_hud_coords",
                JSON.stringify({ top: `${rect.top}px`, left: `${rect.left}px`, right: "auto", bottom: "auto" })
              );
            } catch {}
          }
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // STATEFUL, INSTITUTIONAL PINE SCRIPT v5 GENERATOR (Zero clutter, zero staircase lines)
  // ---------------------------------------------------------------------------
  function generateCleanPineScript(data) {
    const sym = data?.symbol || "NSE Equities";
    return `//@version=5
// =============================================================================
// QuantsPulse Quantitative Strategy Indicator
// Stock: ${sym}
// =============================================================================
indicator("QuantsPulse Quantitative Signals & Levels (${sym})", overlay=true, max_labels_count=500, max_lines_count=500)

// -----------------------------------------------------------------------------
// 1. USER INPUTS & DISPLAY OPTIONS
// -----------------------------------------------------------------------------
grpDisplay   = "Display Options"
showTable    = input.bool(true, "Show Dashboard Table", group=grpDisplay)
showSignals  = input.bool(true, "Show Buy / Exit Signals", group=grpDisplay)
showTargets  = input.bool(true, "Show Active Targets (T1 / T2 / T3)", group=grpDisplay)
showStops    = input.bool(true, "Show Active Stop Loss", group=grpDisplay)
showSMAs     = input.bool(true, "Show Moving Averages (20 / 50 / 200)", group=grpDisplay)

grpStrategy  = "Strategy Parameters"
riskPercent  = input.float(3.5, "Stop Loss Risk Budget %", minval=1.0, maxval=12.0, step=0.5, group=grpStrategy)
rsiPeriod    = input.int(14, "RSI Length", minval=5, maxval=50, group=grpStrategy)

// -----------------------------------------------------------------------------
// 2. TECHNICAL INDICATORS
// -----------------------------------------------------------------------------
sma20  = ta.sma(close, 20)
sma50  = ta.sma(close, 50)
sma200 = ta.sma(close, 200)

plot(showSMAs ? sma20 : na, "SMA 20", color=color.new(#3B82F6, 15), linewidth=1)
plot(showSMAs ? sma50 : na, "SMA 50", color=color.new(#F59E0B, 15), linewidth=1)
plot(showSMAs ? sma200 : na, "SMA 200", color=color.new(#8B5CF6, 10), linewidth=2)

rsiVal = ta.rsi(close, rsiPeriod)
volAvg = ta.sma(volume, 20)
bool volOk = na(volume) or volume == 0 or volume > volAvg * 1.1

// -----------------------------------------------------------------------------
// 3. STATEFUL SIGNAL ENGINE (Clean Alternating Signals, Zero Repeats)
// -----------------------------------------------------------------------------
var int tradeState = 0        // 0 = Cash / Out, 1 = In Active Long Trade
var float entryPrice = na
var float stopLoss = na
var float target1 = na
var float target2 = na
var float target3 = na
var string lastSignalLabel = "Cash / Neutral"

// Repainting Protection: Real-time confirmation check
bool isConfirmed = not barstate.isrealtime or barstate.isconfirmed

// Buy Triggers (Only evaluated when OUT of a position)
oversoldBounce = ta.crossover(rsiVal, 30) and close > ta.ema(close, 9)
smaBreakout    = ta.crossover(close, sma20) and volOk
rawBuy         = oversoldBounce or smaBreakout

bool isBuySignal = rawBuy and tradeState == 0 and isConfirmed

if isBuySignal
    tradeState := 1
    entryPrice := close
    lastSignalLabel := oversoldBounce ? "RSI Oversold Bounce" : "SMA 20 Breakout"
    stopLoss   := close * (1.0 - (riskPercent / 100.0))
    float risk = entryPrice - stopLoss
    target1    := entryPrice + (risk * 0.75)
    target2    := entryPrice + (risk * 2.0)
    target3    := entryPrice + (risk * 3.0)

// Exit Triggers (Only evaluated when IN an active position)
bool hitStop    = low <= stopLoss
bool hitT3      = high >= target3
bool trendBreak = ta.crossunder(close, sma20) and rsiVal < 48
bool rawExit    = hitStop or hitT3 or trendBreak

bool isExitSignal = rawExit and tradeState == 1 and isConfirmed

if isExitSignal
    tradeState := 0
    lastSignalLabel := hitStop ? "Stop Loss Hit" : hitT3 ? "Target 3 (+3.0R) Hit" : "Trend Breakdown"

// Clean Signal Markers (Only 1 Buy and 1 Exit per trade cycle)
plotshape(showSignals and isBuySignal, title="BUY Signal", location=location.belowbar, color=color.new(#0B6A4E, 0), style=shape.triangleup, size=size.small, text="BUY")
plotshape(showSignals and isExitSignal, title="EXIT Signal", location=location.abovebar, color=color.new(#A8380B, 0), style=shape.triangledown, size=size.small, text="EXIT")

// -----------------------------------------------------------------------------
// 4. CLEAN TARGETS & STOPS (Only plotted during active trades; no empty staircases)
// -----------------------------------------------------------------------------
plot(tradeState == 1 and showTargets ? target1 : na, "Target 1 (0.75R)", color=color.new(#34D399, 0), style=plot.style_linebr, linewidth=1)
plot(tradeState == 1 and showTargets ? target2 : na, "Target 2 (2.0R)", color=color.new(#10B981, 0), style=plot.style_linebr, linewidth=2)
plot(tradeState == 1 and showTargets ? target3 : na, "Target 3 (3.0R)", color=color.new(#059669, 0), style=plot.style_linebr, linewidth=2)
plot(tradeState == 1 and showStops ? stopLoss : na, "Stop Loss (1.0R)", color=color.new(#F87171, 0), style=plot.style_linebr, linewidth=1)

// -----------------------------------------------------------------------------
// 5. NATIVE TRADINGVIEW EXECUTIVE DASHBOARD TABLE
// -----------------------------------------------------------------------------
var table hud = table.new(position.top_right, 2, 7, bgcolor=color.new(#161616, 5), border_color=color.new(#2E2E2E, 0), border_width=1)

if barstate.islast
    if showTable
        color statusBg = tradeState == 1 ? color.new(#0B6A4E, 0) : color.new(#262626, 0)
        string statusText = tradeState == 1 ? "▲ LONG TRADE" : "⚖ IN CASH"
        
        float curReturn = tradeState == 1 and not na(entryPrice) ? ((close - entryPrice) / entryPrice) * 100 : 0.0
        color returnColor = curReturn >= 0 ? color.new(#34D399, 0) : color.new(#F87171, 0)
        string returnStr = (curReturn >= 0 ? "+" : "") + str.tostring(curReturn, "#.##") + "%"

        table.cell(hud, 0, 0, "QuantsPulse", bgcolor=color.new(#242424, 0), text_color=color.new(#F26A4B, 0), text_size=size.small)
        table.cell(hud, 1, 0, syminfo.ticker, bgcolor=color.new(#242424, 0), text_color=color.white, text_size=size.small)

        table.cell(hud, 0, 1, "Status", text_color=color.gray, text_size=size.small)
        table.cell(hud, 1, 1, statusText, bgcolor=statusBg, text_color=color.white, text_size=size.small)

        table.cell(hud, 0, 2, "Entry / Return", text_color=color.gray, text_size=size.small)
        table.cell(hud, 1, 2, tradeState == 1 ? str.tostring(entryPrice, "#.##") + " (" + returnStr + ")" : "—", text_color=returnColor, text_size=size.small)

        table.cell(hud, 0, 3, "Stop (1.0R)", text_color=color.gray, text_size=size.small)
        table.cell(hud, 1, 3, tradeState == 1 ? str.tostring(stopLoss, "#.##") + " (-" + str.tostring(riskPercent, "#.#") + "%)" : "—", text_color=color.new(#F87171, 0), text_size=size.small)

        table.cell(hud, 0, 4, "T1 (0.75R)", text_color=color.gray, text_size=size.small)
        table.cell(hud, 1, 4, tradeState == 1 ? str.tostring(target1, "#.##") + (high >= target1 ? " [HIT ✓]" : "") : "—", text_color=color.new(#34D399, 0), text_size=size.small)

        table.cell(hud, 0, 5, "T2 (2.0R)", text_color=color.gray, text_size=size.small)
        table.cell(hud, 1, 5, tradeState == 1 ? str.tostring(target2, "#.##") + (high >= target2 ? " [HIT ✓]" : "") : "—", text_color=color.new(#10B981, 0), text_size=size.small)

        table.cell(hud, 0, 6, "RSI / Trend", text_color=color.gray, text_size=size.small)
        table.cell(hud, 1, 6, str.tostring(rsiVal, "#.#") + " (" + (close > sma50 ? "Bullish" : "Bearish") + ")", text_color=color.white, text_size=size.small)
    else
        table.clear(hud, 0, 0, 1, 6)
`;
  }

  // Bootstrap observers and sync listeners safely
  function setupObserversAndListeners() {
    if (!isExtensionValid()) return;

    // 1. Initial Storage Bootstrap & Immediate Render
    safeStorageGet(["activeQuoteData", "activeSymbol", "showChartOverlay", "qpHudPrefs"], (res) => {
      if (!res) return;
      if (res.qpHudPrefs) {
        prefs = Object.assign(prefs, res.qpHudPrefs);
      }
      if (res.showChartOverlay === false) {
        if (hudRoot) hudRoot.style.display = "none";
      } else {
        prefs.isHidden = false;
        if (res.activeQuoteData && res.activeQuoteData.symbol) {
          lastDetectedSymbol = res.activeQuoteData.symbol;
          currentQuoteData = res.activeQuoteData;
          renderHud(res.activeQuoteData);
        } else if (res.activeSymbol) {
          lastDetectedSymbol = res.activeSymbol;
          fetchAndRenderHud(res.activeSymbol);
        }
      }
      scheduleDetect(100);
    });

    // 2. Watch for DOM & Title changes with debouncing
    const obsTarget = document.body || document.documentElement;
    if (obsTarget) {
      mutationObserver = new MutationObserver(() => {
        scheduleDetect(300);
      });
      mutationObserver.observe(obsTarget, {
        subtree: true,
        childList: true,
        characterData: false,
      });
    }

    const titleEl = document.querySelector("title");
    if (titleEl) {
      titleObserver = new MutationObserver(() => {
        scheduleDetect(150);
      });
      titleObserver.observe(titleEl, { subtree: true, characterData: true, childList: true });
    }

    // 3. User interactions (clicks, keyboard)
    document.addEventListener("click", onUserInteraction, { passive: true });
    document.addEventListener("keyup", onUserKeyup, { passive: true });

    // 4. Periodic background sync (every 3s, not spamming main thread)
    syncIntervalId = setInterval(() => {
      if (!isExtensionValid()) {
        destroyContentScript();
        return;
      }
      scheduleDetect(500);
    }, 3000);

    // 5. Storage synchronization (2-way sync with Side Panel)
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (!isExtensionValid()) return;
        if (area === "local") {
          if (changes.showChartOverlay) {
            if (changes.showChartOverlay.newValue === false) {
              if (hudRoot) hudRoot.style.display = "none";
            } else {
              prefs.isHidden = false;
              if (hudRoot) hudRoot.style.display = "block";
              if (currentQuoteData) {
                renderHud(currentQuoteData);
              } else if (lastDetectedSymbol) {
                fetchAndRenderHud(lastDetectedSymbol);
              }
            }
          }
          if (changes.qpHudPrefs?.newValue) {
            prefs = Object.assign(prefs, changes.qpHudPrefs.newValue);
            if (currentQuoteData && prefs.showChartOverlay !== false) {
              renderHud(currentQuoteData);
            }
          }
          if (changes.activeQuoteData?.newValue) {
            const quote = changes.activeQuoteData.newValue;
            if (quote && quote.symbol) {
              lastDetectedSymbol = quote.symbol;
              currentQuoteData = quote;
              if (prefs.showChartOverlay !== false) {
                prefs.isHidden = false;
                renderHud(quote);
              }
            }
          } else if (changes.activeSymbol?.newValue) {
            const sym = changes.activeSymbol.newValue;
            if (sym && sym !== lastDetectedSymbol && prefs.showChartOverlay !== false) {
              lastDetectedSymbol = sym;
              fetchAndRenderHud(sym);
            }
          }
        }
      });
    } catch (e) {}

    // 6. Direct Message from Side Panel / Background
    try {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!isExtensionValid()) return;
        if (message?.type === "RENDER_HUD_DIRECT" && message.data) {
          currentQuoteData = message.data;
          lastDetectedSymbol = message.data.symbol;
          prefs.isHidden = false;
          renderHud(message.data);
          try { sendResponse({ ok: true }); } catch {}
          return true;
        }
      });
    } catch (e) {}
  }

  setupObserversAndListeners();
})();
