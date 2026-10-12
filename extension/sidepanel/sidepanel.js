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
  const selectHudMode = document.getElementById("select-hud-mode");
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
  chrome.storage.local.get(["backendUrl", "activeSymbol", "platform", "showChartOverlay", "qpHudPrefs"], async (res) => {
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
    if (selectHudMode && res.qpHudPrefs?.displayMode) {
      selectHudMode.value = res.qpHudPrefs.displayMode;
    }
    if (res.activeSymbol) {
      loadSymbol(res.activeSymbol);
    }
    // Proactively detect the current active tab immediately upon opening
    detectActiveTab();
  });

  if (toggleOverlay) {
    toggleOverlay.addEventListener("change", (e) => {
      chrome.storage.local.set({
        showChartOverlay: e.target.checked,
        qpHudPrefs: { isHidden: !e.target.checked }
      });
    });
  }

  if (selectHudMode) {
    selectHudMode.addEventListener("change", (e) => {
      const mode = e.target.value;
      chrome.storage.local.get(["qpHudPrefs"], (res) => {
        const p = Object.assign({}, res.qpHudPrefs || {}, { displayMode: mode, isHidden: false });
        chrome.storage.local.set({ qpHudPrefs: p, showChartOverlay: true });
      });
    });
  }

  if (btnCopyPine) {
    btnCopyPine.addEventListener("click", () => {
      const code = generateCleanPineScript(currentSymbol || "NSE Equities");
      navigator.clipboard.writeText(code).then(() => {
        const span = btnCopyPine.querySelector("span");
        const originalText = span ? span.textContent : "";
        if (span) span.textContent = "✓ Clean Pine Script Copied to Clipboard!";
        setTimeout(() => {
          if (span) span.textContent = originalText;
        }, 2500);
      });
    });
  }

  function generateCleanPineScript(symbol) {
    const sym = symbol || "NSE Equities";
    return `//@version=5
// =============================================================================
// QuantsPulse Quantitative Strategy Indicator for TradingView
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

  // Active Tab Detector across any window (including split / popped out views)
  async function findActiveFinanceTab() {
    if (!chrome.tabs) return null;
    try {
      // 1. Try active tab in current window
      let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      let tab = tabs?.find((t) => t?.url && isSupportedFinanceUrl(t.url));
      if (tab) return tab;

      // 2. Try active tab in last focused window (the browser window before clicking the side panel)
      tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tab = tabs?.find((t) => t?.url && isSupportedFinanceUrl(t.url));
      if (tab) return tab;

      // 3. Try any active tab in any window
      tabs = await chrome.tabs.query({ active: true });
      tab = tabs?.find((t) => t?.url && isSupportedFinanceUrl(t.url));
      if (tab) return tab;

      // 4. Fallback: Search all open tabs for any financial platform tab
      tabs = await chrome.tabs.query({});
      tab = tabs?.find((t) => t?.url && isSupportedFinanceUrl(t.url));
      return tab || null;
    } catch {
      return null;
    }
  }

  async function pushHudDirectToTabs(data) {
    if (!chrome.tabs || !data) return;
    try {
      const tabs = await chrome.tabs.query({});
      for (const t of tabs) {
        if (t.id && t.url && isSupportedFinanceUrl(t.url)) {
          chrome.tabs.sendMessage(t.id, {
            type: "RENDER_HUD_DIRECT",
            data: data,
          }).catch(() => {});
        }
      }
    } catch (e) {
      // Benign if tabs closed
    }
  }

  const KNOWN_INDICES = [
    { regex: /\b(?:NIFTY\s*BANK|BANK\s*NIFTY|BANKNIFTY|CNX\s*BANK)\b/i, symbol: "BANKNIFTY" },
    { regex: /\b(?:NIFTY\s*FIN(?:ANCIAL)?(?:\s*SERVICES?)?|FIN\s*NIFTY|FINNIFTY)\b/i, symbol: "NIFTYFINSERV" },
    { regex: /\b(?:NIFTY\s*MID(?:CAP)?(?:\s*SELECT)?|MIDCAP\s*NIFTY|MIDCPNIFTY)\b/i, symbol: "NIFTYMIDCAP50" },
    { regex: /\b(?:NIFTY\s*NEXT\s*50|JUNIOR\s*NIFTY|NIFTYJR)\b/i, symbol: "NIFTY100" },
    { regex: /\b(?:NIFTY\s*50|CNX\s*NIFTY|NIFTY50)\b/i, symbol: "NIFTY" },
    { regex: /\b(?:NIFTY\s*IT|CNX\s*IT|NIFTYIT)\b/i, symbol: "NIFTYIT" },
    { regex: /\b(?:NIFTY\s*AUTO|NIFTYAUTO)\b/i, symbol: "NIFTYAUTO" },
    { regex: /\b(?:NIFTY\s*PHARMA|NIFTYPHARMA)\b/i, symbol: "NIFTYPHARMA" },
    { regex: /\b(?:NIFTY\s*FMCG|NIFTYFMCG)\b/i, symbol: "NIFTYFMCG" },
    { regex: /\b(?:NIFTY\s*METAL|NIFTYMETAL)\b/i, symbol: "NIFTYMETAL" },
    { regex: /\b(?:NIFTY\s*ENERGY|NIFTYENERGY)\b/i, symbol: "NIFTYENERGY" },
    { regex: /\b(?:NIFTY\s*INFRA|NIFTYINFRA)\b/i, symbol: "NIFTYINFRA" },
    { regex: /\b(?:NIFTY\s*REALTY|NIFTYREALTY)\b/i, symbol: "NIFTYREALTY" },
    { regex: /\b(?:NIFTY\s*PSU\s*BANK)\b/i, symbol: "NIFTYPSUBANK" },
    { regex: /\b(?:NIFTY\s*MEDIA)\b/i, symbol: "NIFTYMEDIA" },
    { regex: /\b(?:BSE\s*SENSEX|S&P\s*BSE\s*SENSEX|SENSEX)\b/i, symbol: "SENSEX" },
    { regex: /\b(?:BSE\s*BANKEX|BANKEX)\b/i, symbol: "BANKEX" },
    { regex: /\b(?:INDIA\s*VIX|NIFTY\s*VIX|INDIAVIX)\b/i, symbol: "INDIAVIX" },
    { regex: /\bNIFTY\b/i, symbol: "NIFTY" },
  ];

  function extractIndexSymbol(text) {
    if (!text) return "";
    const s = String(text);
    for (const item of KNOWN_INDICES) {
      if (item.regex.test(s)) {
        return item.symbol;
      }
    }
    return "";
  }

  function getPlatformFromUrl(url) {
    if (!url) return "Broker Terminal";
    const u = url.toLowerCase();
    if (u.includes("choiceindia.com")) return "Choice FinX";
    if (u.includes("tradingview.com")) return "TradingView";
    if (u.includes("zerodha.com")) return "Zerodha Kite";
    if (u.includes("groww.in")) return "Groww";
    if (u.includes("dhan.co")) return "Dhan";
    if (u.includes("angelone.in")) return "Angel One";
    if (u.includes("upstox.com")) return "Upstox";
    if (u.includes("fyers.in")) return "Fyers";
    if (u.includes("kotak")) return "Kotak Neo";
    if (u.includes("icicidirect.com")) return "ICICI Direct";
    if (u.includes("motilaloswal.com")) return "Motilal Oswal";
    if (u.includes("paytmmoney.com")) return "Paytm Money";
    if (u.includes("5paisa.com")) return "5paisa";
    if (u.includes("sharekhan.com")) return "Sharekhan";
    if (u.includes("hdfc")) return "HDFC Sky";
    if (u.includes("axisdirect")) return "Axis Direct";
    if (u.includes("shoonya") || u.includes("finvasia")) return "Shoonya";
    if (u.includes("aliceblue")) return "Alice Blue";
    if (u.includes("google.com")) return "Google Finance";
    if (u.includes("yahoo.com")) return "Yahoo Finance";
    return "Broker Terminal";
  }

  function isSupportedFinanceUrl(url) {
    if (!url) return false;
    return /(tradingview|choiceindia|zerodha|groww|dhan|angelone|upstox|fyers|kotaksecurities|kotakneo|kotak|icicidirect|motilaloswal|paytmmoney|5paisa|sharekhan|hdfcsec|hdfcsky|axisdirect|shoonya|finvasia|aliceblue|google\.com\/finance|finance\.yahoo)/i.test(url);
  }

  function parseTabMeta(url, title) {
    if (!url && !title) return null;
    const platform = getPlatformFromUrl(url);

    // 1. Check title for known Indian indices first (e.g. "Nifty Bank", "Bank Nifty", "Nifty 50")
    if (title) {
      const idx = extractIndexSymbol(title);
      if (idx) return { symbol: idx, platform };
    }

    // 2. Colon / bracket match in title
    if (title) {
      const colonMatch = title.match(/(?:NSE|BSE)\s*:\s*([A-Z0-9&-]{2,15})/i);
      if (colonMatch) {
        return { symbol: colonMatch[1].toUpperCase(), platform };
      }
      const parenMatch = title.match(/\(([A-Z0-9&-]{2,15})\)/i);
      if (parenMatch) {
        return { symbol: parenMatch[1].toUpperCase(), platform };
      }
    }

    // 3. Fallback token extraction from title
    if (title) {
      const EX = new Set([
        "TRADINGVIEW", "CHART", "CHARTS", "WATCHLIST", "UNTITLED", "UNNAMED", "INDEX", "MARKETS",
        "SEARCH", "QUOTE", "QUOTES", "LIVE", "SHARE", "SHARES", "PRICE", "TODAY", "STOCK", "STOCKS",
        "OVERVIEW", "TECHNICALS", "FINANCIALS", "COMMUNITY", "IDEAS", "SCRIP", "NSE", "BSE", "NFO",
        "ZERODHA", "KITE", "GROWW", "DHAN", "ANGEL", "ONE", "GOOGLE", "YAHOO", "FINANCE", "INR", "USD",
        "CHOICE", "FINX", "UPSTOX", "FYERS", "KOTAK", "NEO", "ICICI", "DIRECT", "MOTILAL", "OSWAL",
        "PAYTM", "5PAISA", "SHAREKHAN", "HDFC", "AXIS"
      ]);
      const firstToken = title.trim().split(/[\s,·_|\/]+/)[0].toUpperCase();
      if (firstToken.length >= 2 && firstToken.length <= 15 && !EX.has(firstToken) && !/^\d+$/.test(firstToken)) {
        return { symbol: firstToken, platform };
      }
    }

    return null;
  }

  async function detectActiveTab(forceReload = false) {
    try {
      const tab = await findActiveFinanceTab();
      if (!tab || !tab.url) return;

      let detected = null;

      // 1. Direct message probe to content script first (quickest response)
      if (tab.id) {
        try {
          const resp = await new Promise((resolve) => {
            chrome.tabs.sendMessage(tab.id, { type: "POLL_DETECTED_SYMBOL" }, (r) => {
              if (chrome.runtime.lastError || !r) resolve(null);
              else resolve(r);
            });
          });
          if (resp && resp.symbol) {
            detected = { symbol: resp.symbol, platform: resp.platform || getPlatformFromUrl(tab.url) };
          }
        } catch {}
      }

      // 2. In-tab script execution across all frames (crucial for broker embedded chart iframes like Choice FinX tv-charts)
      if (!detected && chrome.scripting && tab.id && isSupportedFinanceUrl(tab.url)) {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: inTabExtractorFunc,
          });
          if (results && Array.isArray(results)) {
            const hit = results.find((r) => r?.result && r.result.symbol);
            if (hit?.result) {
              detected = hit.result;
            }
          }
        } catch (e) {
          // Fallback to title/url analysis below
        }
      }

      // 3. Fallback heuristic from tab title & url
      if (!detected && isSupportedFinanceUrl(tab.url)) {
        detected = parseTabMeta(tab.url, tab.title || "");
      }

      if (detected && detected.symbol) {
        const platform = detected.platform || getPlatformFromUrl(tab.url);
        elPlatformBadge.textContent = platform;
        if (detected.symbol !== currentSymbol || forceReload) {
          chrome.storage.local.set({
            activeSymbol: detected.symbol,
            platform: platform,
            exchange: "NSE",
          });
          loadSymbol(detected.symbol);
        }
      } else if (forceReload && currentSymbol) {
        loadSymbol(currentSymbol);
      }
    } catch (err) {
      console.warn("detectActiveTab error:", err);
    }
  }

  // Self-contained extractor function passed into the active tab
  function inTabExtractorFunc() {
    const host = window.location.hostname.toLowerCase();
    const href = window.location.href;
    const title = document.title || "";

    const KNOWN_INDICES = [
      { regex: /\b(?:NIFTY\s*BANK|BANK\s*NIFTY|BANKNIFTY|CNX\s*BANK)\b/i, symbol: "BANKNIFTY" },
      { regex: /\b(?:NIFTY\s*FIN(?:ANCIAL)?(?:\s*SERVICES?)?|FIN\s*NIFTY|FINNIFTY)\b/i, symbol: "NIFTYFINSERV" },
      { regex: /\b(?:NIFTY\s*MID(?:CAP)?(?:\s*SELECT)?|MIDCAP\s*NIFTY|MIDCPNIFTY)\b/i, symbol: "NIFTYMIDCAP50" },
      { regex: /\b(?:NIFTY\s*NEXT\s*50|JUNIOR\s*NIFTY|NIFTYJR)\b/i, symbol: "NIFTY100" },
      { regex: /\b(?:NIFTY\s*50|CNX\s*NIFTY|NIFTY50)\b/i, symbol: "NIFTY" },
      { regex: /\b(?:NIFTY\s*IT|CNX\s*IT|NIFTYIT)\b/i, symbol: "NIFTYIT" },
      { regex: /\b(?:NIFTY\s*AUTO|NIFTYAUTO)\b/i, symbol: "NIFTYAUTO" },
      { regex: /\b(?:NIFTY\s*PHARMA|NIFTYPHARMA)\b/i, symbol: "NIFTYPHARMA" },
      { regex: /\b(?:NIFTY\s*FMCG|NIFTYFMCG)\b/i, symbol: "NIFTYFMCG" },
      { regex: /\b(?:NIFTY\s*METAL|NIFTYMETAL)\b/i, symbol: "NIFTYMETAL" },
      { regex: /\b(?:NIFTY\s*ENERGY|NIFTYENERGY)\b/i, symbol: "NIFTYENERGY" },
      { regex: /\b(?:NIFTY\s*INFRA|NIFTYINFRA)\b/i, symbol: "NIFTYINFRA" },
      { regex: /\b(?:NIFTY\s*REALTY|NIFTYREALTY)\b/i, symbol: "NIFTYREALTY" },
      { regex: /\b(?:NIFTY\s*PSU\s*BANK)\b/i, symbol: "NIFTYPSUBANK" },
      { regex: /\b(?:NIFTY\s*MEDIA)\b/i, symbol: "NIFTYMEDIA" },
      { regex: /\b(?:BSE\s*SENSEX|S&P\s*BSE\s*SENSEX|SENSEX)\b/i, symbol: "SENSEX" },
      { regex: /\b(?:BSE\s*BANKEX|BANKEX)\b/i, symbol: "BANKEX" },
      { regex: /\b(?:INDIA\s*VIX|NIFTY\s*VIX|INDIAVIX)\b/i, symbol: "INDIAVIX" },
      { regex: /\bNIFTY\b/i, symbol: "NIFTY" },
    ];

    function extractIndex(text) {
      if (!text) return "";
      const s = String(text);
      for (const item of KNOWN_INDICES) {
        if (item.regex.test(s)) {
          return item.symbol;
        }
      }
      return "";
    }

    const EX = new Set([
      "TRADINGVIEW", "CHART", "CHARTS", "WATCHLIST", "UNTITLED", "UNNAMED", "INDEX", "MARKETS",
      "SEARCH", "QUOTE", "QUOTES", "LIVE", "SHARE", "SHARES", "PRICE", "TODAY", "STOCK", "STOCKS",
      "OVERVIEW", "TECHNICALS", "FINANCIALS", "COMMUNITY", "IDEAS", "SCRIP", "NSE", "BSE", "NFO",
      "ZERODHA", "KITE", "GROWW", "DHAN", "ANGEL", "ONE", "GOOGLE", "YAHOO", "FINANCE", "INR", "USD",
      "CHOICE", "CHOICEINDIA", "FINX", "UPSTOX", "FYERS", "KOTAK", "NEO", "ICICI", "DIRECT", "ICICIDIRECT",
      "MOTILAL", "OSWAL", "PAYTM", "PAYTMMONEY", "5PAISA", "SHAREKHAN", "HDFC", "HDFCSKY", "AXIS", "AXISDIRECT",
      "SHOONYA", "FINVASIA", "ALICEBLUE", "TERMINAL", "CONSOLE", "DASHBOARD", "PORTFOLIO", "ORDER", "ORDERS",
      "POSITION", "POSITIONS", "HOLDINGS", "FUNDS", "STRATEGY", "INDICATOR", "INDICATORS",
      "1D", "1W", "1M", "1Y", "5D", "5M", "15M", "30M", "1H", "2H", "4H", "D", "W", "M", "Y",
      "BUY", "SELL", "LONG", "SHORT", "CANDLE", "CANDLES", "BAR", "BARS", "EQUITY", "EQ",
      "TRACK", "ALL", "MARKET", "SUPERCHARTS", "SCREENER", "HEATMAP", "ECONOMIC", "CALENDAR"
    ]);

    function getPlatform() {
      if (host.includes("choiceindia.com")) return "Choice FinX";
      if (host.includes("tradingview.com")) return "TradingView";
      if (host.includes("zerodha.com")) return "Zerodha Kite";
      if (host.includes("groww.in")) return "Groww";
      if (host.includes("dhan.co")) return "Dhan";
      if (host.includes("angelone.in")) return "Angel One";
      if (host.includes("upstox.com")) return "Upstox";
      if (host.includes("fyers.in")) return "Fyers";
      if (host.includes("kotak")) return "Kotak Neo";
      if (host.includes("icicidirect")) return "ICICI Direct";
      if (host.includes("motilaloswal")) return "Motilal Oswal";
      if (host.includes("paytmmoney")) return "Paytm Money";
      if (host.includes("5paisa")) return "5paisa";
      if (host.includes("sharekhan")) return "Sharekhan";
      if (host.includes("hdfc")) return "HDFC Sky";
      if (host.includes("axisdirect")) return "Axis Direct";
      if (host.includes("shoonya") || host.includes("finvasia")) return "Shoonya";
      if (host.includes("aliceblue")) return "Alice Blue";
      if (host.includes("google.com")) return "Google Finance";
      if (host.includes("yahoo.com")) return "Yahoo Finance";
      return "Broker Terminal";
    }

    const platform = getPlatform();

    function clean(raw) {
      if (!raw) return "";
      let s = String(raw).trim().toUpperCase();
      if (s.includes(":")) {
        const p = s.split(":");
        s = p[p.length - 1];
      }
      s = s.replace(/\.(NS|BO)$/i, "").replace(/-EQ$/i, "").replace(/[^A-Z0-9&-]/g, "");
      if (s === "NIFTY50" || s === "CNXNIFTY" || s === "NIFTY-50" || s === "NIFTY 50") s = "NIFTY";
      if (s === "NIFTYBANK" || s === "CNXBANK" || s === "BANKNIFTY" || s === "NIFTY BANK" || s === "BANK NIFTY") s = "BANKNIFTY";
      if (s === "FINNIFTY" || s === "FIN NIFTY" || s === "NIFTYFIN" || s === "NIFTYFINSERV") s = "NIFTYFINSERV";
      if (s === "MIDCPNIFTY" || s === "MIDCAPNIFTY" || s === "NIFTYMIDCAP50") s = "NIFTYMIDCAP50";
      if (s === "NIFTYJR" || s === "NIFTYNEXT50" || s === "NIFTY100") s = "NIFTY100";
      if (s === "SENSEX" || s === "BSESENSEX") s = "SENSEX";
      if (s === "BANKEX" || s === "BSEBANKEX") s = "BANKEX";
      if (s.length < 2 || s.length > 15 || EX.has(s)) return "";
      if (/^\d+$/.test(s)) return "";
      return s;
    }

    function extract(text) {
      if (!text) return "";
      const sText = String(text).trim();
      if (sText.startsWith("TradingView") || sText.startsWith("Unnamed")) return "";

      const idxSym = extractIndex(sText);
      if (idxSym) return idxSym;

      const colonMatch = sText.match(/(?:NSE|BSE)\s*:\s*([A-Z0-9&-]{2,15})/i);
      if (colonMatch) {
        const c = clean(colonMatch[1]);
        if (c) return c;
      }
      const parenMatch = sText.match(/\(([A-Z0-9&-]{2,15})\)/i);
      if (parenMatch) {
        const c = clean(parenMatch[1]);
        if (c) return c;
      }
      const tokens = sText.split(/[\s,·|_\/\(\)]+/);
      for (const t of tokens) {
        const c = clean(t);
        if (c) return c;
      }
      return "";
    }

    // 1. Title
    if (title && !title.startsWith("TradingView") && !title.startsWith("Unnamed")) {
      const sym = extract(title);
      if (sym) return { symbol: sym, platform };
    }

    // 2. URL parameters (e.g. ?symbol=... or ?symbols=...)
    try {
      const params = new URLSearchParams(window.location.search);
      for (const pKey of ["symbol", "symbols", "scrip", "tradingsymbol", "ticker", "instrument"]) {
        const val = params.get(pKey);
        if (val && !/^\d+$/.test(val) && !val.includes("@")) {
          const sym = extract(val);
          if (sym) return { symbol: sym, platform };
        }
      }
      if (href.includes("/symbols/")) {
        const pathParts = window.location.pathname.split("/symbols/")[1];
        if (pathParts) {
          const sym = extract(pathParts);
          if (sym) return { symbol: sym, platform };
        }
      }
    } catch {}

    // 3. Embedded TradingView Chart Header Toolbar Button
    const tvHeaders = document.querySelectorAll(
      "#header-toolbar-symbol-search, [data-name='header-toolbar-symbol-search'], button[id*='symbol-search'], div[id*='symbol-search'], [class*='symbolSearchText'], [data-role='button'][id*='symbol'], div[class*='symbolSearch'], div[class*='js-button-text'], [class*='button-'][class*='-symbol']"
    );
    for (const btn of tvHeaders) {
      const text = btn.textContent || btn.getAttribute("title") || btn.getAttribute("aria-label");
      if (text) {
        const sym = extract(text);
        if (sym) return { symbol: sym, platform };
      }
    }

    // 4. Chart Legend Series Title (where "Nifty Bank · 15 · NSE" is shown)
    const legEls = document.querySelectorAll(
      "[data-name='legend-source-title'], [data-name='legend-series-item'], div[class*='legendSourceTitle'], div[class*='titleWrapper'], div[class*='seriesTitle'], .chart-widget .pane-legend-line, div[class*='pane-legend'], .pane-legend, [class*='apply-common-tooltip'][class*='title'], [class*='legend-'] [class*='title']"
    );
    for (const leg of legEls) {
      const text = leg.textContent || leg.getAttribute("title") || leg.getAttribute("aria-label");
      if (text) {
        const sym = extract(text);
        if (sym) return { symbol: sym, platform };
      }
    }

    // 5. Watchlist & Scrip Selectors across all brokers
    const itemEls = document.querySelectorAll(
      "[data-name='symbol-title'], [data-name='quote-ticker'], div[class*='symbolTitle'], div[class*='symbol-title'], div[class*='symbolName'], [data-name='watch-list-item'][class*='active'], [data-name='watch-list-item'][aria-selected='true'], .instrument.selected .nice-name, .instrument.selected, .order-window .instrument-name, .tv-chart-container .instrument, [class*='selected-scrip'], [class*='active-instrument'], [class*='scrip_name'], [class*='symbol_name'], [class*='stock-name'], .scrip-name, [data-testid*='symbol'], [data-testid*='instrument'], [class*='symbol-item-name'], [class*='header-symbol']"
    );
    for (const item of itemEls) {
      const raw = item.getAttribute("data-symbol-full") || item.getAttribute("data-symbol") || item.textContent;
      if (raw) {
        const sym = extract(raw);
        if (sym) return { symbol: sym, platform };
      }
    }

    // 6. Broker-specific URL fallbacks
    if (host.includes("zerodha.com")) {
      const m = href.match(/\/chart\/(?:ext\/tvc\/)?(?:NSE|BSE)\/([A-Z0-9&-]+)/i);
      if (m) {
        const c = clean(m[1]);
        if (c) return { symbol: c, platform: "Zerodha Kite" };
      }
    } else if (host.includes("groww.in")) {
      const m = title.match(/\(([A-Z0-9&-]+)\)\s+(?:Share|Stock)/i);
      if (m) {
        const c = clean(m[1]);
        if (c) return { symbol: c, platform: "Groww" };
      }
      if (href.includes("/stocks/")) {
        const slug = href.split("/stocks/")[1]?.split(/[?#/]/)[0];
        if (slug) {
          const c = clean(slug);
          if (c) return { symbol: c, platform: "Groww" };
        }
      }
    } else if (host.includes("google.com") && href.includes("/finance")) {
      const m = href.match(/\/quote\/([A-Z0-9&-]+):(NSE|BSE)/i);
      if (m) {
        const c = clean(m[1]);
        if (c) return { symbol: c, platform: "Google Finance" };
      }
    } else if (host.includes("finance.yahoo.com")) {
      const m = href.match(/\/quote\/([A-Z0-9&-]+)\.(?:NS|BO)/i);
      if (m) {
        const c = clean(m[1]);
        if (c) return { symbol: c, platform: "Yahoo Finance" };
      }
    }

    return null;
  }

  // Main fetch & render function with in-flight guard and smooth updating
  let isLoading = false;

  async function loadSymbol(sym) {
    if (!sym) return;
    if (isLoading && sym === currentSymbol) return;

    const isNewSymbol = sym !== currentSymbol;
    currentSymbol = sym;
    inputSymbol.value = sym;

    if (isNewSymbol) {
      elEmpty.classList.add("hidden");
      elContent.classList.add("hidden");
      elLoading.classList.remove("hidden");
    }
    isLoading = true;

    try {
      const url = `${backendUrl}/api/extension/quote?symbol=${encodeURIComponent(sym)}&exchange=NSE`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      render(data);
      if (data && data.symbol) {
        currentSymbol = data.symbol;
      }

      chrome.storage.local.get(["activeSymbol"], (stored) => {
        if (stored?.activeSymbol !== data.symbol) {
          chrome.storage.local.set({
            activeQuoteData: data,
            activeSymbol: data.symbol,
          });
        }
      });

      pushHudDirectToTabs(data);
    } catch (err) {
      if (isNewSymbol) showError(err);
    } finally {
      isLoading = false;
      elLoading.classList.add("hidden");
    }
  }

  function render(data) {
    elEmpty.classList.add("hidden");
    elContent.classList.remove("hidden");
    const emptyH3 = elEmpty.querySelector("h3");
    if (emptyH3) emptyH3.textContent = "No active chart detected";
    const emptyMuted = elEmpty.querySelector(".muted-text");
    if (emptyMuted) emptyMuted.innerHTML = "Navigate to <strong>TradingView</strong>, <strong>Choice FinX</strong>, <strong>Zerodha Kite</strong>, <strong>Groww</strong>, or any broker chart to auto-sync, or search a symbol above.";

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
      document.getElementById("plan-stop-pct").textContent = `-${p.riskPercent ? p.riskPercent.toFixed(1) : "0.0"}%`;

      const t1Gain = p.entry ? ((p.t1 - p.entry) / p.entry) * 100 : 0;
      document.getElementById("plan-t1-price").textContent = formatRupees(p.t1);
      document.getElementById("plan-t1-pct").textContent = `+${t1Gain.toFixed(1)}%`;

      const t2Gain = p.entry ? ((p.t2 - p.entry) / p.entry) * 100 : 0;
      document.getElementById("plan-t2-price").textContent = formatRupees(p.t2);
      document.getElementById("plan-t2-pct").textContent = `+${t2Gain.toFixed(1)}%`;

      const t3Gain = p.entry ? ((p.t3 - p.entry) / p.entry) * 100 : 0;
      document.getElementById("plan-t3-price").textContent = formatRupees(p.t3);
      document.getElementById("plan-t3-pct").textContent = `+${t3Gain.toFixed(1)}%`;
    } else {
      document.getElementById("plan-stop-price").textContent = "—";
      document.getElementById("plan-stop-pct").textContent = "—";
      document.getElementById("plan-t1-price").textContent = "—";
      document.getElementById("plan-t1-pct").textContent = "—";
      document.getElementById("plan-t2-price").textContent = "—";
      document.getElementById("plan-t2-pct").textContent = "—";
      document.getElementById("plan-t3-price").textContent = "—";
      document.getElementById("plan-t3-pct").textContent = "—";
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
    } else {
      document.getElementById("sentiment-zone").textContent = "—";
      document.getElementById("sentiment-alpha").textContent = "—";
      document.getElementById("sentiment-rsi").textContent = "—";
      document.getElementById("sentiment-desc").textContent = "No sentiment data available.";
      document.getElementById("rsi-bar").style.width = `50%`;
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
