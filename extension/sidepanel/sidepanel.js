// QuantsPulse Side Panel Controller

(function () {
  let currentSymbol = "";
  let backendUrl = "https://quantplus-ten.vercel.app";

  // Elements
  const elEmpty = document.getElementById("empty-state");
  const elLoading = document.getElementById("loading-state");
  const elContent = document.getElementById("content-panel");
  const elSettings = document.getElementById("settings-panel");
  const elPlatformBadge = document.getElementById("platform-badge");

  const inputSymbol = document.getElementById("symbol-input");
  const formSymbol = document.getElementById("symbol-form");
  const inputBackend = document.getElementById("backend-url");
  const btnSaveSettings = document.getElementById("btn-save-settings");
  const btnSettingsToggle = document.getElementById("btn-settings-toggle");
  const btnRefresh = document.getElementById("btn-refresh");
  const toggleOverlay = document.getElementById("toggle-overlay");
  const btnCopyPine = document.getElementById("btn-copy-pine");

  // Formatters
  function formatRupees(num) {
    if (num == null || isNaN(num)) return "—";
    return "₹" + Number(num).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatVolume(v) {
    if (v == null || isNaN(v)) return "—";
    const n = Number(v);
    if (n >= 10000000) return (n / 10000000).toFixed(2) + " Cr";
    if (n >= 100000) return (n / 100000).toFixed(2) + " L";
    if (n >= 1000) return (n / 1000).toFixed(1) + " k";
    return String(n);
  }

  // Load preferences and then inspect active tab
  chrome.storage.local.get(["backendUrl", "activeSymbol", "platform", "showChartOverlay"], async (res) => {
    if (res.backendUrl) {
      backendUrl = res.backendUrl.replace(/\/$/, "");
      inputBackend.value = backendUrl;
    }
    if (res.platform) {
      elPlatformBadge.textContent = res.platform;
    }
    if (toggleOverlay) {
      toggleOverlay.checked = res.showChartOverlay !== false;
    }
    if (res.activeSymbol) {
      loadSymbol(res.activeSymbol);
    }
    // Proactively detect the current active tab immediately upon opening
    detectActiveTab();
  });

  if (toggleOverlay) {
    toggleOverlay.addEventListener("change", (e) => {
      chrome.storage.local.set({ showChartOverlay: e.target.checked });
    });
  }

  if (btnCopyPine) {
    btnCopyPine.addEventListener("click", () => {
      const code = generatePineScript(currentSymbol || "NSE Equities");
      navigator.clipboard.writeText(code).then(() => {
        const span = btnCopyPine.querySelector("span");
        const originalText = span ? span.textContent : "";
        if (span) span.textContent = "✓ Pine Script Copied to Clipboard!";
        setTimeout(() => {
          if (span) span.textContent = originalText;
        }, 2200);
      });
    });
  }

  function generatePineScript(symbol) {
    return `//@version=5
// QuantsPulse Quantitative Indicators for TradingView
// Stock: ${symbol || "NSE Equities"}
indicator("QuantsPulse Quantitative Signals & Levels (${symbol || "NSE"})", overlay=true)

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

  // Settings toggle & save
  btnSettingsToggle.addEventListener("click", () => {
    elSettings.classList.toggle("hidden");
  });

  btnSaveSettings.addEventListener("click", () => {
    const val = inputBackend.value.trim().replace(/\/$/, "");
    if (val) {
      backendUrl = val;
      chrome.storage.local.set({ backendUrl });
      elSettings.classList.add("hidden");
      if (currentSymbol) loadSymbol(currentSymbol);
    }
  });

  // Manual search submit
  formSymbol.addEventListener("submit", (e) => {
    e.preventDefault();
    const sym = inputSymbol.value.trim().toUpperCase();
    if (sym) {
      elPlatformBadge.textContent = "Manual";
      loadSymbol(sym);
    }
  });

  // Refresh button: trigger active tab re-probe & symbol reload
  btnRefresh.addEventListener("click", async () => {
    btnRefresh.classList.add("spinning");
    await detectActiveTab(true);
    setTimeout(() => btnRefresh.classList.remove("spinning"), 600);
  });

  // Storage listener for live tab updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.platform?.newValue) {
        elPlatformBadge.textContent = changes.platform.newValue;
      }
      if (changes.activeSymbol?.newValue && changes.activeSymbol.newValue !== currentSymbol) {
        loadSymbol(changes.activeSymbol.newValue);
      }
    }
  });

  // Active Tab Detector
  async function detectActiveTab(forceReload = false) {
    try {
      if (!chrome.tabs) return;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) return;

      let detected = null;

      // 1. Try in-tab script execution if permissions allow
      if (chrome.scripting && tab.id && isSupportedFinanceUrl(tab.url)) {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: inTabExtractorFunc,
          });
          if (results && results[0] && results[0].result) {
            detected = results[0].result;
          }
        } catch (e) {
          // Fallback to title/url analysis below
        }
      }

      // 2. Fallback heuristic from tab title & url
      if (!detected && isSupportedFinanceUrl(tab.url)) {
        detected = parseTabMeta(tab.url, tab.title || "");
      }

      if (detected && detected.symbol) {
        elPlatformBadge.textContent = detected.platform || "Synced";
        chrome.storage.local.set({
          activeSymbol: detected.symbol,
          platform: detected.platform,
          exchange: "NSE",
          detectedAt: Date.now(),
        });
        if (detected.symbol !== currentSymbol || forceReload) {
          loadSymbol(detected.symbol);
        }
      } else if (forceReload && currentSymbol) {
        loadSymbol(currentSymbol);
      }
    } catch (err) {
      console.warn("detectActiveTab error:", err);
    }
  }

  function isSupportedFinanceUrl(url) {
    if (!url) return false;
    return /(tradingview|zerodha|groww|dhan|angelone|google\.com\/finance|finance\.yahoo)/i.test(url);
  }

  function parseTabMeta(url, title) {
    if (!title) return null;
    const EX = new Set(["TRADINGVIEW", "CHART", "CHARTS", "WATCHLIST", "UNTITLED", "INDEX", "MARKETS", "SEARCH", "QUOTE", "QUOTES", "LIVE", "SHARE", "PRICE", "TODAY", "STOCK", "STOCKS", "NSE", "BSE", "INR", "USD"]);
    if (url.includes("tradingview.com")) {
      const firstToken = title.trim().split(/[\s,·\-_]+/)[0].toUpperCase();
      if (firstToken.length >= 2 && firstToken.length <= 15 && !EX.has(firstToken)) {
        return { symbol: firstToken, platform: "TradingView" };
      }
    }
    return null;
  }

  // Self-contained extractor function passed into the active tab
  function inTabExtractorFunc() {
    const host = window.location.hostname.toLowerCase();
    const title = document.title || "";
    const EX = new Set([
      "TRADINGVIEW", "CHART", "CHARTS", "WATCHLIST", "UNTITLED", "INDEX", "MARKETS",
      "SEARCH", "QUOTE", "QUOTES", "LIVE", "SHARE", "PRICE", "TODAY", "STOCK", "STOCKS",
      "OVERVIEW", "TECHNICALS", "FINANCIALS", "COMMUNITY", "IDEAS", "SCRIP", "NSE", "BSE",
      "ZERODHA", "KITE", "GROWW", "DHAN", "ANGEL", "ONE", "GOOGLE", "YAHOO", "FINANCE", "INR", "USD"
    ]);

    function clean(raw) {
      if (!raw) return "";
      let s = String(raw).trim().toUpperCase();
      if (s.includes(":")) {
        const p = s.split(":");
        s = p[p.length - 1];
      }
      s = s.replace(/\.(NS|BO)$/i, "").replace(/-EQ$/i, "").replace(/[^A-Z0-9&-]/g, "");
      return s.length >= 2 && s.length <= 15 && !EX.has(s) ? s : "";
    }

    if (host.includes("tradingview.com")) {
      // 1. Header Toolbar symbol search button (top left pill)
      const btn = document.querySelector(
        "#header-toolbar-symbol-search, [data-name='header-toolbar-symbol-search'], button[id*='symbol-search'], [class*='symbolSearchText'], [data-role='button'][id*='symbol']"
      );
      if (btn && btn.textContent) {
        const c = clean(btn.textContent);
        if (c) return { symbol: c, platform: "TradingView" };
      }

      // 2. Document Title (e.g. "HINDUNILVR 1,856.70 INR ...")
      if (title) {
        const first = title.trim().split(/[\s,·\-_]+/)[0];
        const c = clean(first);
        if (c) return { symbol: c, platform: "TradingView" };
      }

      // 3. Chart Legend
      const leg = document.querySelector("[data-name='legend-source-title'], [data-name='legend-series-item'], .chart-widget .pane-legend-line");
      if (leg && leg.textContent) {
        const c = clean(leg.textContent);
        if (c) return { symbol: c, platform: "TradingView" };
      }

      // 4. Watchlist active item
      const item = document.querySelector(
        "[data-name='watch-list-item'][class*='active'], [data-name='watch-list-item'][aria-selected='true'], div[class*='selected-'][data-symbol-full], [data-name='watch-list-item'].active"
      );
      if (item) {
        const val = item.getAttribute("data-symbol-full") || item.getAttribute("data-symbol") || item.textContent;
        const c = clean(val);
        if (c) return { symbol: c, platform: "TradingView" };
      }
    }

    if (host.includes("zerodha.com")) {
      const m = window.location.href.match(/\/chart\/(?:ext\/tvc\/)?(?:NSE|BSE)\/([A-Z0-9&-]+)/i);
      if (m) {
        const c = clean(m[1]);
        if (c) return { symbol: c, platform: "Zerodha Kite" };
      }
      const item = document.querySelector(".instrument.selected .nice-name, .order-window .instrument-name");
      if (item) {
        const c = clean(item.textContent);
        if (c) return { symbol: c, platform: "Zerodha Kite" };
      }
    }

    if (host.includes("groww.in")) {
      const m = title.match(/\(([A-Z0-9&-]+)\)\s+(?:Share|Stock)/i);
      if (m) {
        const c = clean(m[1]);
        if (c) return { symbol: c, platform: "Groww" };
      }
    }

    return null;
  }

  // Main fetch & render function
  async function loadSymbol(sym) {
    if (!sym) return;
    currentSymbol = sym;
    inputSymbol.value = sym;

    elEmpty.classList.add("hidden");
    elContent.classList.add("hidden");
    elLoading.classList.remove("hidden");

    try {
      const url = `${backendUrl}/api/extension/quote?symbol=${encodeURIComponent(sym)}&exchange=NSE`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      render(data);
    } catch (err) {
      showError(err);
    } finally {
      elLoading.classList.add("hidden");
    }
  }

  function render(data) {
    elEmpty.classList.add("hidden");
    elContent.classList.remove("hidden");

    // 1. Quote Header
    document.getElementById("stock-symbol").textContent = data.symbol;
    document.getElementById("stock-name").textContent = data.name || data.symbol;
    document.getElementById("stock-exchange").textContent = `${data.exchange || "NSE"} · ${data.segment ? data.segment.toUpperCase() : "EQUITY"}`;
    document.getElementById("stock-sector").textContent = data.sector || "General Market";

    const lastPrice = data.last_price;
    document.getElementById("stock-price").textContent = formatRupees(lastPrice);

    const chg = data.change_pct;
    const elDelta = document.getElementById("stock-delta");
    if (chg != null) {
      const isPositive = chg >= 0;
      elDelta.textContent = `${isPositive ? "▲ +" : "▼ "}${chg.toFixed(2)}% (${formatRupees(data.change)})`;
      elDelta.className = `num stock-delta ${isPositive ? "text-gain" : "text-loss"}`;
    } else {
      elDelta.textContent = "—";
      elDelta.className = "num stock-delta";
    }

    if (data.as_of) {
      const d = new Date(data.as_of);
      document.getElementById("stock-asof").textContent = `Close · ${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`;
    }

    // 2. Signal Card
    const elSignalCard = document.getElementById("signal-card");
    const elSignalBadge = document.getElementById("signal-badge");
    const elSignalStrategy = document.getElementById("signal-strategy");
    const elSignalDate = document.getElementById("signal-date");
    const elSignalEntry = document.getElementById("signal-entry");
    const elSignalStop = document.getElementById("signal-stop");

    if (data.latestSignal) {
      elSignalCard.classList.remove("hidden");
      const isBuy = data.latestSignal.kind === "buy";
      elSignalCard.className = `card signal-card ${isBuy ? "" : "is-exit"}`;
      elSignalBadge.className = `signal-badge ${isBuy ? "signal-buy" : "signal-exit"}`;
      elSignalBadge.textContent = isBuy ? "▲ BUY SIGNAL" : "▼ EXIT SIGNAL";
      elSignalStrategy.textContent = data.latestSignal.label;

      if (data.latestSignal.date) {
        const sd = new Date(data.latestSignal.date);
        elSignalDate.textContent = sd.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      } else {
        elSignalDate.textContent = "";
      }

      elSignalEntry.textContent = formatRupees(data.latestSignal.price);
      elSignalStop.textContent = formatRupees(data.latestSignal.stop);
    } else {
      elSignalCard.classList.add("hidden");
    }

    // 3. Trade Plan Targets
    const p = data.tradePlan;
    if (p) {
      document.getElementById("plan-stop-price").textContent = formatRupees(p.stop);
      document.getElementById("plan-stop-pct").textContent = `-${p.riskPercent.toFixed(1)}%`;

      const t1Gain = p.entry ? ((p.t1 - p.entry) / p.entry) * 100 : 0;
      document.getElementById("plan-t1-price").textContent = formatRupees(p.t1);
      document.getElementById("plan-t1-pct").textContent = `+${t1Gain.toFixed(1)}%`;

      const t2Gain = p.entry ? ((p.t2 - p.entry) / p.entry) * 100 : 0;
      document.getElementById("plan-t2-price").textContent = formatRupees(p.t2);
      document.getElementById("plan-t2-pct").textContent = `+${t2Gain.toFixed(1)}%`;

      const t3Gain = p.entry ? ((p.t3 - p.entry) / p.entry) * 100 : 0;
      document.getElementById("plan-t3-price").textContent = formatRupees(p.t3);
      document.getElementById("plan-t3-pct").textContent = `+${t3Gain.toFixed(1)}%`;
    }

    // 4. Key Levels
    document.getElementById("level-prev").textContent = formatRupees(data.prev_close);
    document.getElementById("level-vol").textContent = formatVolume(data.volume);

    const fmtSma = (val) => (val ? formatRupees(val) + (lastPrice ? (lastPrice >= val ? " (above)" : " (below)") : "") : "—");
    document.getElementById("level-sma20").textContent = fmtSma(data.sma20);
    document.getElementById("level-sma50").textContent = fmtSma(data.sma50);
    document.getElementById("level-sma200").textContent = fmtSma(data.sma200);

    if (data.low_52w != null && data.high_52w != null) {
      document.getElementById("level-52w").textContent = `${formatRupees(data.low_52w)} – ${formatRupees(data.high_52w)}`;
    } else {
      document.getElementById("level-52w").textContent = "—";
    }

    // 5. Sentiment Audit
    const s = data.sentiment;
    if (s) {
      document.getElementById("sentiment-zone").textContent = s.zone || "Equilibrium";
      document.getElementById("sentiment-alpha").textContent = s.alphaLevel || "ALPHA TARGET";
      document.getElementById("sentiment-rsi").textContent = s.rsi != null ? `RSI ${s.rsi.toFixed(1)}` : "—";
      document.getElementById("sentiment-desc").textContent = s.description;

      const rsiVal = Math.min(Math.max(s.rsi || 50, 0), 100);
      document.getElementById("rsi-bar").style.width = `${rsiVal}%`;
    }

    // 6. Direct Launcher
    const launchUrl = data.quantPulseUrl || `${backendUrl}/app/markets/${encodeURIComponent(data.symbol)}`;
    document.getElementById("btn-open-app").setAttribute("href", launchUrl);
  }

  function showError(err) {
    elContent.classList.add("hidden");
    elEmpty.classList.remove("hidden");
    elEmpty.querySelector("h3").textContent = `Could not load ${currentSymbol}`;
    elEmpty.querySelector(".muted-text").textContent = `Please verify the backend is active at ${backendUrl}. Check console for details.`;
  }
})();
