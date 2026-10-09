// QuantsPulse Ticker Detector & On-Chart Signal HUD Content Script
// Automatically detects active stock tickers and renders real-time Quantitative Signals,
// Asymmetric Trade Plans & Sentiment Audits directly on TradingView, Zerodha Kite, Groww, etc.

(function () {
  const EXCLUDED = new Set([
    "TRADINGVIEW", "CHART", "CHARTS", "WATCHLIST", "UNTITLED", "INDEX", "MARKETS",
    "SEARCH", "QUOTE", "QUOTES", "LIVE", "SHARE", "PRICE", "TODAY", "STOCK", "STOCKS",
    "OVERVIEW", "TECHNICALS", "FINANCIALS", "COMMUNITY", "IDEAS", "SCRIP", "NSE", "BSE",
    "ZERODHA", "KITE", "GROWW", "DHAN", "ANGEL", "ONE", "GOOGLE", "YAHOO", "FINANCE", "INR", "USD"
  ]);

  let lastDetectedSymbol = "";
  let currentQuoteData = null;
  let hudRoot = null;
  let hudShadow = null;
  let isMinimized = false;
  let isHidden = false;

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
      const kiteUrlMatch = href.match(/\/chart\/(?:ext\/tvc\/)?(?:NSE|BSE)\/([A-Z0-9&-]+)/i);
      if (kiteUrlMatch) {
        symbol = cleanTicker(kiteUrlMatch[1]);
      } else {
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

      // Fetch quote & render on-chart HUD
      fetchAndRenderHud(symbol);
    }
  }

  // ---------------------------------------------------------------------------
  // ON-CHART SIGNAL HUD (Isolated Shadow DOM Overlay)
  // ---------------------------------------------------------------------------

  function fetchAndRenderHud(symbol) {
    chrome.storage.local.get(["showChartOverlay"], (res) => {
      // Default to enabled if not explicitly set to false
      if (res.showChartOverlay === false) {
        if (hudRoot) hudRoot.style.display = "none";
        return;
      }
      if (hudRoot) hudRoot.style.display = "block";

      chrome.runtime.sendMessage(
        { type: "FETCH_QUOTE_DATA", symbol, exchange: "NSE" },
        (resp) => {
          if (resp && resp.ok && resp.data) {
            currentQuoteData = resp.data;
            renderHud(resp.data);
          }
        }
      );
    });
  }

  function getOrCreateShadowRoot() {
    if (!hudRoot) {
      hudRoot = document.createElement("div");
      hudRoot.id = "quantspulse-chart-hud-root";
      hudRoot.style.all = "initial";
      hudRoot.style.position = "fixed";
      hudRoot.style.zIndex = "2147483647"; // Above TradingView/broker canvases
      document.documentElement.appendChild(hudRoot);
      hudShadow = hudRoot.attachShadow({ mode: "open" });
    }
    return hudShadow;
  }

  function formatRupees(num) {
    if (num == null || isNaN(num)) return "—";
    return "₹" + Number(num).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function renderHud(data) {
    const shadow = getOrCreateShadowRoot();

    // Load saved coordinates or default to top-right
    let savedPos = { top: "68px", right: "75px", left: "auto" };
    try {
      const stored = localStorage.getItem("qp_hud_coords");
      if (stored) savedPos = JSON.parse(stored);
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

    const pineScriptCode = generatePineScript(data);

    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
        }
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
          z-index: 2147483647;
          background: rgba(22, 22, 22, 0.94);
          color: #ECEBE4;
          border: 1px solid #333333;
          border-radius: 8px;
          box-shadow: 0 10px 32px rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          font-size: 12px;
          line-height: 1.4;
          user-select: none;
          min-width: 330px;
          max-width: 360px;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .hud-container.is-minimized {
          min-width: auto;
          max-width: none;
          border-radius: 20px;
          padding: 4px 10px;
        }
        .hud-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 10px;
          background: rgba(32, 32, 32, 0.85);
          border-bottom: 1px solid #2E2E2E;
          border-top-left-radius: 8px;
          border-top-right-radius: 8px;
          cursor: grab;
        }
        .hud-container.is-minimized .hud-header {
          padding: 0;
          background: transparent;
          border-bottom: none;
          border-radius: 0;
          cursor: grab;
        }
        .hud-header:active {
          cursor: grabbing;
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
          letter-spacing: -0.01em;
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
        /* Minimized View */
        .minimized-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11.5px;
        }
        .minimized-signal {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 3px;
        }
        .minimized-signal.is-buy {
          background: #0B6A4E;
          color: #FFFFFF;
        }
        .minimized-signal.is-exit {
          background: #A8380B;
          color: #FFFFFF;
        }
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
        /* Signal Banner */
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
        .signal-date {
          font-size: 10px;
          color: #94938B;
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
        .footer-link:hover {
          text-decoration: underline;
        }
        .pine-link {
          color: #94938B;
          cursor: pointer;
          font-size: 10.5px;
        }
        .pine-link:hover { color: #FFFFFF; }
        /* Floating Restore Bubble */
        .bubble-restore {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 2147483647;
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

      ${isHidden ? `
        <button id="btn-restore-hud" class="bubble-restore" title="Restore QuantsPulse Chart Overlay">
          <span>⚡ QuantsPulse (${data.symbol})</span>
        </button>
      ` : `
        <div id="qp-hud-box" class="hud-container ${isMinimized ? "is-minimized" : ""}">
          ${isMinimized ? `
            <div class="hud-header" id="qp-drag-handle">
              <div class="minimized-bar">
                <span class="tag-symbol">${data.symbol}</span>
                <span class="num">${formatRupees(data.last_price)}</span>
                ${hasSignal ? `
                  <span class="minimized-signal ${isBuy ? "is-buy" : "is-exit"}">
                    ${isBuy ? "▲ BUY" : "▼ EXIT"} @ ${formatRupees(data.latestSignal.price)}
                  </span>
                ` : `
                  <span class="minimized-signal" style="background:#333;color:#94938B;">CONSOLIDATION</span>
                `}
                ${p ? `
                  <span class="num" style="color:#F87171;font-size:10px;">Stop ${formatRupees(p.stop)}</span>
                  <span class="num" style="color:#34D399;font-size:10px;">T1 ${formatRupees(p.t1)}</span>
                ` : ""}
                <button id="btn-toggle-expand" class="btn-tool" title="Expand Full Intelligence">⤢</button>
                <button id="btn-close-hud" class="btn-tool" title="Close">✕</button>
              </div>
            </div>
          ` : `
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
                <button id="btn-copy-pine" class="btn-tool" title="Copy TradingView Pine Script Indicator">📋 Pine</button>
                <button id="btn-toggle-min" class="btn-tool" title="Minimize to compact bar">—</button>
                <button id="btn-close-hud" class="btn-tool" title="Close">✕</button>
              </div>
            </div>

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

              <!-- Asymmetric Trade Plan Multiples -->
              ${p ? `
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
              <div class="levels-row num">
                <span>SMA20 <b>${data.sma20 ? formatRupees(data.sma20) : "—"}</b></span>
                <span>SMA50 <b>${data.sma50 ? formatRupees(data.sma50) : "—"}</b></span>
                <span>RSI <b>${data.sentiment?.rsi != null ? data.sentiment.rsi.toFixed(1) : "—"}</b></span>
              </div>

              <!-- Footer -->
              <div class="hud-footer">
                <a href="${data.quantPulseUrl || `https://quantplus-ten.vercel.app/app/markets/${encodeURIComponent(data.symbol)}`}" target="_blank" class="footer-link">
                  Open QuantsPulse Terminal ↗
                </a>
                <span id="btn-copy-pine-foot" class="pine-link">📋 Pine Script</span>
              </div>
            </div>
          `}
        </div>
      `}
    `;

    // Wire HUD Event Listeners
    wireHudEvents(shadow, pineScriptCode);
  }

  function wireHudEvents(shadow, pineScriptCode) {
    // Restore from bubble
    const btnRestore = shadow.getElementById("btn-restore-hud");
    if (btnRestore) {
      btnRestore.addEventListener("click", () => {
        isHidden = false;
        if (currentQuoteData) renderHud(currentQuoteData);
      });
    }

    // Close / Hide
    const btnClose = shadow.getElementById("btn-close-hud");
    if (btnClose) {
      btnClose.addEventListener("click", () => {
        isHidden = true;
        if (currentQuoteData) renderHud(currentQuoteData);
      });
    }

    // Toggle minimize
    const btnToggleMin = shadow.getElementById("btn-toggle-min");
    if (btnToggleMin) {
      btnToggleMin.addEventListener("click", () => {
        isMinimized = true;
        if (currentQuoteData) renderHud(currentQuoteData);
      });
    }

    // Toggle expand
    const btnToggleExpand = shadow.getElementById("btn-toggle-expand");
    if (btnToggleExpand) {
      btnToggleExpand.addEventListener("click", () => {
        isMinimized = false;
        if (currentQuoteData) renderHud(currentQuoteData);
      });
    }

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
      let isDragging = false;
      let startX, startY, origLeft, origTop;

      dragHandle.addEventListener("mousedown", (e) => {
        if (e.target.tagName === "BUTTON") return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = hudBox.getBoundingClientRect();
        origLeft = rect.left;
        origTop = rect.top;
        e.preventDefault();
      });

      window.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const newLeft = Math.max(10, Math.min(window.innerWidth - 340, origLeft + dx));
        const newTop = Math.max(10, Math.min(window.innerHeight - 80, origTop + dy));

        hudBox.style.left = `${newLeft}px`;
        hudBox.style.top = `${newTop}px`;
        hudBox.style.right = "auto";
      });

      window.addEventListener("mouseup", () => {
        if (isDragging) {
          isDragging = false;
          try {
            const rect = hudBox.getBoundingClientRect();
            localStorage.setItem(
              "qp_hud_coords",
              JSON.stringify({ top: `${rect.top}px`, left: `${rect.left}px`, right: "auto" })
            );
          } catch {}
        }
      });
    }
  }

  function generatePineScript(data) {
    const sym = data?.symbol || "NSE Equities";
    return `//@version=5
// QuantsPulse Quantitative Indicator for TradingView
// Stock: ${sym}
indicator("QuantsPulse Quantitative Signals & Levels (${sym})", overlay=true)

// 1. Moving Averages
sma20 = ta.sma(close, 20)
sma50 = ta.sma(close, 50)
sma200 = ta.sma(close, 200)

plot(sma20, "SMA 20", color=color.new(#3B82F6, 0), linewidth=1)
plot(sma50, "SMA 50", color=color.new(#F59E0B, 0), linewidth=1)
plot(sma200, "SMA 200", color=color.new(#8B5CF6, 0), linewidth=2)

// 2. Quantitative Signals
rsiVal = ta.rsi(close, 14)
oversoldBounce = ta.crossover(rsiVal, 30) and close > ta.ema(close, 9)
smaBreakout = ta.crossover(close, sma20) and volume > ta.sma(volume, 20) * 1.2
buySignal = oversoldBounce or smaBreakout

overboughtExit = ta.crossunder(rsiVal, 70) and close < ta.ema(close, 9)
exitSignal = overboughtExit or ta.crossunder(close, sma20)

plotshape(buySignal, title="QuantsPulse BUY", location=location.belowbar, color=color.new(#0B6A4E, 0), style=shape.triangleup, size=size.small, text="BUY")
plotshape(exitSignal, title="QuantsPulse EXIT", location=location.abovebar, color=color.new(#A8380B, 0), style=shape.triangledown, size=size.small, text="EXIT")

// 3. Asymmetric Targets (0.75R / 2.0R / 3.0R)
var float entryPrice = na
var float stopLoss = na
var float target1 = na
var float target2 = na
var float target3 = na

if buySignal
    entryPrice := close
    stopLoss := close * 0.965
    float risk = entryPrice - stopLoss
    target1 := entryPrice + (risk * 0.75)
    target2 := entryPrice + (risk * 2.0)
    target3 := entryPrice + (risk * 3.0)

plot(buySignal ? na : stopLoss, "Stop Loss (1R)", color=color.new(#A8380B, 20), style=plot.style_linebr, linewidth=1)
plot(buySignal ? na : target1, "Target 1 (0.75R)", color=color.new(#0B6A4E, 20), style=plot.style_linebr, linewidth=1)
plot(buySignal ? na : target2, "Target 2 (2.0R)", color=color.new(#0B6A4E, 20), style=plot.style_linebr, linewidth=2)
plot(buySignal ? na : target3, "Target 3 (3.0R)", color=color.new(#0B6A4E, 20), style=plot.style_linebr, linewidth=2)
`;
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

  // Listen to storage changes (e.g. user toggles overlay on/off from side panel)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.showChartOverlay) {
      if (changes.showChartOverlay.newValue === false) {
        if (hudRoot) hudRoot.style.display = "none";
      } else {
        if (hudRoot) hudRoot.style.display = "block";
        if (lastDetectedSymbol) fetchAndRenderHud(lastDetectedSymbol);
      }
    }
  });
})();
