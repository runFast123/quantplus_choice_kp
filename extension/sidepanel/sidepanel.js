// QuantsPulse Side Panel Controller

(function () {
  let currentSymbol = "";
  let backendUrl = "https://quantplus-ten.vercel.app";

  // Elements
  const $ = (id) => document.getElementById(id);
  const elPlatformBadge = $("platform-badge");
  const inputSymbol = $("symbol-input");
  const formSymbol = $("symbol-form");
  const btnRefresh = $("btn-refresh");
  const btnCopyPine = $("btn-copy-pine");
  const elUserAuthBadge = $("user-auth-badge");
  const elUserAuthEmail = $("user-auth-email");
  const btnAuthCheck = $("btn-auth-check");
  const btnAuthLogin = $("btn-auth-login");
  const btnAuthSignup = $("btn-auth-signup");

  // One view at a time: loading | empty | locked | error | content
  const VIEWS = {
    loading: $("state-loading"),
    empty: $("state-empty"),
    locked: $("state-locked"),
    error: $("state-error"),
    content: $("content"),
  };
  let view = "empty";
  function showView(name) {
    view = name;
    for (const [key, el] of Object.entries(VIEWS)) el.classList.toggle("hidden", key !== name);
  }

  const sendMessage = (msg) =>
    new Promise((resolve) =>
      chrome.runtime.sendMessage(msg, (resp) => {
        void chrome.runtime.lastError;
        resolve(resp);
      }),
    );

  let qpUser = null;
  let qpAuthenticated = false;

  function updateAuthUI(isAuthed, user) {
    qpAuthenticated = Boolean(isAuthed);
    qpUser = user || null;
    btnAuthLogin.href = `${backendUrl}/login`;
    btnAuthSignup.href = `${backendUrl}/signup`;

    if (qpAuthenticated) {
      elUserAuthBadge.classList.remove("hidden");
      elUserAuthEmail.textContent = qpUser?.email ? qpUser.email.split("@")[0] : "Signed in";
      if (view === "locked") showView("empty");
    } else {
      elUserAuthBadge.classList.add("hidden");
      if (!currentSymbol) showView("locked");
    }
  }

  const DEFAULT_BACKEND = "https://quantplus-ten.vercel.app";
  const ALLOWED_BACKENDS = [DEFAULT_BACKEND, "http://localhost:3000"];
  function allowedBackend(stored) {
    const url = String(stored || "").trim().replace(/\/$/, "");
    return ALLOWED_BACKENDS.includes(url) ? url : DEFAULT_BACKEND;
  }

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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  // KK breakdowns open a short ("sell") and close it with a "cover"; older servers send only buy/exit.
  function signalMeta(kind) {
    switch (kind) {
      case "buy": return { up: true, badge: "BUY SIGNAL", word: "BUY", priceLabel: "Entry Trigger" };
      case "sell": return { up: false, badge: "SELL (SHORT) SIGNAL", word: "SELL", priceLabel: "Entry Trigger" };
      case "cover": return { up: true, badge: "COVER SIGNAL", word: "COVER", priceLabel: "Exit Price" };
      default: return { up: false, badge: "EXIT SIGNAL", word: "EXIT", priceLabel: "Exit Price" };
    }
  }

  function formatSignalDate(d) {
    if (!d) return "";
    try {
      const dt = new Date(d);
      return isNaN(dt.getTime()) ? "" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
    } catch {
      return "";
    }
  }


  // Load preferences and then inspect active tab
  chrome.storage.local.get(["backendUrl", "activeSymbol", "platform", "qpAuthenticated", "qpUser", "qpPanelTab"], (res) => {
    backendUrl = allowedBackend(res.backendUrl);
    selectTab(res.qpPanelTab || "signal");
    updateAuthUI(Boolean(res.qpAuthenticated), res.qpUser || null);
    if (res.platform) elPlatformBadge.textContent = res.platform;
    if (res.activeSymbol) loadSymbol(res.activeSymbol);
    // Proactively detect the current active tab immediately upon opening
    detectActiveTab();
  });

  btnCopyPine.addEventListener("click", () => {
    const code = generateCleanPineScript(currentSymbol || "NSE Equities");
    navigator.clipboard.writeText(code).then(
      () => toast("Pine Script copied"),
      () => toast("Couldn't copy"),
    );
  });

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
stratMode    = input.string("QuantsPulse Core (Platform Match)", "Strategy Mode", options=["QuantsPulse Core (Platform Match)", "Fast Swing (Price vs SMA20)"], group=grpStrategy)
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

// QuantsPulse Platform Strategies (Matches Supabase Postgres \`svc_refresh_market_analytics\`):
// 1. \`sma_20_50_cross\`: SMA 20 crosses SMA 50 (Golden Cross / Death Cross)
// 2. \`rsi_reversal\`: RSI dips below 30 and crosses back above 30, or rises above 70 and falls back below 70
bool qpBuyGolden = ta.crossover(sma20, sma50)
bool qpBuyRsi    = ta.crossover(rsiVal, 30)
bool qpExitDeath = ta.crossunder(sma20, sma50)
bool qpExitRsi   = ta.crossunder(rsiVal, 70)

// Fast Swing Alternative (Price vs SMA20 Breakout)
bool fastBuy     = (ta.crossover(rsiVal, 30) and close > ta.ema(close, 9)) or (ta.crossover(close, sma20) and volOk)
bool fastExit    = (low <= stopLoss) or (high >= target3) or (ta.crossunder(close, sma20) and rsiVal < 48)

// Active Rules based on selected Strategy Mode
bool isCoreMode  = stratMode == "QuantsPulse Core (Platform Match)"
bool rawBuy      = isCoreMode ? (qpBuyGolden or qpBuyRsi) : fastBuy
bool rawExit     = isCoreMode ? (qpExitDeath or qpExitRsi or (low <= stopLoss)) : fastExit

bool isBuySignal = rawBuy and tradeState == 0 and isConfirmed

if isBuySignal
    tradeState := 1
    entryPrice := close
    lastSignalLabel := isCoreMode ? (qpBuyGolden ? "SMA 20/50 Golden Cross" : "RSI Oversold Reversal") : (ta.crossover(rsiVal, 30) ? "RSI Oversold Bounce" : "SMA 20 Breakout")
    stopLoss   := close * (1.0 - (riskPercent / 100.0))
    float risk = entryPrice - stopLoss
    target1    := entryPrice + (risk * 0.75)
    target2    := entryPrice + (risk * 2.0)
    target3    := entryPrice + (risk * 3.0)

bool isExitSignal = rawExit and tradeState == 1 and isConfirmed

if isExitSignal
    tradeState := 0
    lastSignalLabel := isCoreMode ? (qpExitDeath ? "SMA 20/50 Death Cross" : qpExitRsi ? "RSI Overbought Exit" : "Stop Loss Hit") : (low <= stopLoss ? "Stop Loss Hit" : high >= target3 ? "Target 3 (+3.0R) Hit" : "Trend Breakdown")

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

  // Settings (server, on-chart overlay) live on the extension's options page
  $("btn-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

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

  // 1. Direct runtime message listener from content scripts (instant detection without storage lag)
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "SYMBOL_DETECTED" && message.symbol) {
      const sym = message.symbol.toUpperCase().trim();
      if (message.platform) {
        elPlatformBadge.textContent = message.platform;
      }
      if (sym && sym !== currentSymbol) {
        loadSymbol(sym);
      }
    }
  });

  // 2. Storage listener for live tab updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.platform?.newValue) {
        elPlatformBadge.textContent = changes.platform.newValue;
      }
      if (changes.activeSymbol?.newValue && changes.activeSymbol.newValue !== currentSymbol) {
        loadSymbol(changes.activeSymbol.newValue);
      }
      // Sign-in changes come from the background worker (website session check).
      if (changes.qpAuthenticated) {
        const authed = Boolean(changes.qpAuthenticated.newValue);
        chrome.storage.local.get(["qpUser"], (r) => updateAuthUI(authed, r?.qpUser || null));
        if (authed && changes.qpAuthenticated.oldValue === false && currentSymbol) loadSymbol(currentSymbol);
      }
    }
  });

  // 3. Tab switch & URL navigation listeners
  if (chrome.tabs?.onActivated) {
    chrome.tabs.onActivated.addListener(() => {
      detectActiveTab();
    });
  }
  if (chrome.tabs?.onUpdated) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === "complete" || changeInfo.url) {
        detectActiveTab();
      }
    });
  }

  // 4. Periodic background sync (every 2.5s) to guarantee side panel tracks in-chart transitions
  setInterval(() => {
    detectActiveTab();
  }, 2500);

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

  // Choice FinX exchange security token dictionary (maps numeric segment@token to canonical symbol)
  const CHOICE_INDEX_TOKENS = {
    "26000": "NIFTY",
    "26009": "BANKNIFTY",
    "26037": "NIFTYFINSERV",
    "26014": "NIFTYMIDCAP50",
    "26002": "NIFTY100",
    "1": "SENSEX",
    "12": "BANKEX",
  };

  function resolveChoiceToken(val) {
    if (!val) return "";
    try {
      const decoded = decodeURIComponent(String(val)).trim();
      const token = decoded.includes("@") ? decoded.split("@")[1] : decoded;
      return CHOICE_INDEX_TOKENS[token] || "";
    } catch {
      return "";
    }
  }

  function parseTabMeta(url, title) {
    if (!url && !title) return null;
    const platform = getPlatformFromUrl(url);

    // 1. Check URL for explicit symbol parameters (e.g. ?symbol=NSE:HDFCBANK or Choice tokens symbols=1@26000)
    if (url) {
      try {
        const u = new URL(url);
        const p = u.searchParams.get("symbol") || u.searchParams.get("symbols") || u.searchParams.get("scrip") || u.searchParams.get("tradingsymbol");
        if (p) {
          const choiceSym = resolveChoiceToken(p);
          if (choiceSym) return { symbol: choiceSym, platform };
          if (p.includes(":")) {
            const parts = p.split(":");
            const raw = parts[parts.length - 1].replace(/\.(NS|BO)$/i, "").replace(/-EQ$/i, "").toUpperCase();
            if (raw && raw.length >= 2) return { symbol: raw, platform };
          }
          if (!/^\d+$/.test(p) && !p.includes("@")) {
            const cleanSym = p.replace(/\.(NS|BO)$/i, "").replace(/-EQ$/i, "").replace(/[^A-Z0-9&-]/gi, "").toUpperCase();
            const idx = extractIndexSymbol(cleanSym);
            if (idx) return { symbol: idx, platform };
            if (cleanSym && cleanSym.length >= 2) return { symbol: cleanSym, platform };
          }
        }
        if (u.pathname.includes("/symbols/")) {
          const pathParts = u.pathname.split("/symbols/")[1];
          if (pathParts) {
            const raw = pathParts.replace(/^(?:NSE|BSE)-/i, "").split(/[\/?#]/)[0].toUpperCase();
            if (raw && raw.length >= 2) return { symbol: raw, platform };
          }
        }
      } catch {}
    }

    // 2. Check title for known Indian indices first (e.g. "Nifty 50", "Bank Nifty", "Nifty Bank")
    if (title) {
      const idx = extractIndexSymbol(title);
      if (idx) return { symbol: idx, platform };
    }

    // 3. Colon / bracket match in title
    if (title) {
      const colonMatch = title.match(/(?:NSE|BSE)\s*:\s*([A-Z0-9&-]{2,15})/i);
      if (colonMatch) {
        return { symbol: colonMatch[1].toUpperCase(), platform };
      }
      const parenMatch = title.match(/\(([A-Z0-9&-]{2,15})\)/i);
      if (parenMatch) {
        return { symbol: parenMatch[1].toUpperCase(), platform };
      }

      // 4. Ticker followed by live price: "RELIANCE 2,950.00 (+1.2%) — TradingView" or "INFY 1,920.00 / Kite"
      const priceMatch = title.match(/^([A-Z0-9&-]{2,15})\s+[\d,]+(?:\.\d+)?(?:\s*[-+▲▼\(\)]|\s*\/|\s*—|\s*-|\s*·)/i);
      if (priceMatch) {
        const sym = priceMatch[1].toUpperCase();
        return { symbol: sym, platform };
      }

      // 5. Ticker followed by financial words: "RELIANCE Share Price", "TCS Stock Chart"
      const nounMatch = title.match(/^([A-Z0-9&-]{2,15})\s+(?:Share\s*Price|Stock\s*Price|Live\s*Chart|Overview)\b/i);
      if (nounMatch) {
        const sym = nounMatch[1].toUpperCase();
        return { symbol: sym, platform };
      }
    }

    return null;
  }

  async function detectActiveTab(forceReload = false) {
    try {
      const tab = await findActiveFinanceTab();
      if (!tab || !tab.url) return;

      let detected = null;

      // 1. In-tab script execution across all frames (identifies exact chart frame vs watchlist container)
      if (chrome.scripting && tab.id && isSupportedFinanceUrl(tab.url)) {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: inTabExtractorFunc,
          });
          if (results && Array.isArray(results)) {
            // Prioritize chart source > watchlist source > url source > title source
            const chartHit = results.find((r) => r?.result?.source === "chart");
            const watchlistHit = results.find((r) => r?.result?.source === "watchlist");
            const anyHit = results.find((r) => r?.result && r.result.symbol);
            const hit = chartHit || watchlistHit || anyHit;
            if (hit?.result?.symbol) {
              detected = hit.result;
            }
          }
        } catch (e) {
          // Fallback below
        }
      }

      // 2. Direct message probe to content script if in-tab execution didn't resolve
      if (!detected && tab.id) {
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
      "OVERVIEW", "TECHNICALS", "FINANCIALS", "COMMUNITY", "IDEAS", "SCRIP", "NSE", "BSE", "NFO", "MCX", "CDS",
      "ZERODHA", "KITE", "GROWW", "DHAN", "ANGEL", "ONE", "GOOGLE", "YAHOO", "FINANCE", "INR", "USD",
      "CHOICE", "CHOICEINDIA", "FINX", "UPSTOX", "FYERS", "KOTAK", "NEO", "ICICI", "DIRECT", "ICICIDIRECT",
      "MOTILAL", "OSWAL", "PAYTM", "PAYTMMONEY", "5PAISA", "SHAREKHAN", "HDFC", "HDFCSKY", "AXIS", "AXISDIRECT",
      "SHOONYA", "FINVASIA", "ALICEBLUE", "TERMINAL", "CONSOLE", "DASHBOARD", "PORTFOLIO", "ORDER", "ORDERS",
      "POSITION", "POSITIONS", "HOLDINGS", "FUNDS", "STRATEGY", "INDICATOR", "INDICATORS",
      "1D", "1W", "1M", "1Y", "5D", "5M", "15M", "30M", "1H", "2H", "4H", "D", "W", "M", "Y",
      "BUY", "SELL", "LONG", "SHORT", "CANDLE", "CANDLES", "BAR", "BARS", "EQUITY", "EQ",
      "TRACK", "ALL", "MARKET", "SUPERCHARTS", "SCREENER", "HEATMAP", "ECONOMIC", "CALENDAR",
      "ONLINE", "TRADE", "TRADING", "PLATFORM", "BROKER", "BROKING", "PORTAL", "HOMEPAGE", "HOME",
      "PAGE", "APP", "WELCOME", "ACCOUNT", "LOGIN", "SIGNIN", "SIGNUP", "REGISTER", "SYSTEM",
      "CHARTING", "WEB", "INVEST", "INVESTING", "INVESTMENT", "MUTUAL", "WEALTH", "CAPITAL",
      "SECURITIES", "SECURITY", "OPTION", "OPTIONS", "FUTURE", "FUTURES", "DERIVATIVES", "CURRENCY",
      "COMMODITY", "EXCHANGE", "DESK", "VIEW", "PANEL", "PRO", "PLUS", "SMART", "DESKTOP", "MOBILE",
      "CLIENT", "CONNECT", "STATUS", "SERVER", "EXPAND", "SAVE", "CREATE", "FREE", "DEMAT", "OPEN", "BEST", "TOP",
      "ALERT", "ALERTS", "REPLAY", "COMPARE", "PUBLISH", "UPGRADE", "UNDO", "REDO", "SAVED", "LAYOUT", "LAYOUTS",
      "LINE", "AREA", "HEIKIN", "RENKO", "SNAPSHOT", "PROPERTIES", "SETTINGS", "FULLSCREEN", "HELP"
    ]);

    const CHOICE_INDEX_TOKENS = {
      "26000": "NIFTY",
      "26009": "BANKNIFTY",
      "26037": "NIFTYFINSERV",
      "26014": "NIFTYMIDCAP50",
      "26002": "NIFTY100",
      "1": "SENSEX",
      "12": "BANKEX",
    };

    function resolveChoiceToken(val) {
      if (!val) return "";
      try {
        const decoded = decodeURIComponent(String(val)).trim();
        const token = decoded.includes("@") ? decoded.split("@")[1] : decoded;
        return CHOICE_INDEX_TOKENS[token] || "";
      } catch {
        return "";
      }
    }

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
      const tokens = sText.split(/[\s,·|_\/\(\)]+/).filter(Boolean);
      if (tokens.length > 0) {
        const first = clean(tokens[0]);
        if (first) {
          if (tokens.length <= 3 || /^(?:\d+[DWM]?|NSE|BSE|EQ|[\d,]+(?:\.\d+)?)$/i.test(tokens[1])) {
            return first;
          }
        }
        if (tokens.length <= 3) {
          for (const t of tokens) {
            const c = clean(t);
            if (c) return c;
          }
        }
      }
      return "";
    }

    function extractTitle(title) {
      if (!title) return "";
      const s = String(title).trim();
      if (s.startsWith("TradingView") || s.startsWith("Unnamed")) return "";

      const idx = extractIndex(s);
      if (idx) return idx;

      const colonMatch = s.match(/(?:NSE|BSE)\s*:\s*([A-Z0-9&-]{2,15})/i);
      if (colonMatch) {
        const c = clean(colonMatch[1]);
        if (c) return c;
      }

      const parenMatch = s.match(/\(([A-Z0-9&-]{2,15})\)/i);
      if (parenMatch) {
        const c = clean(parenMatch[1]);
        if (c) return c;
      }

      const priceMatch = s.match(/^([A-Z0-9&-]{2,15})\s+[\d,]+(?:\.\d+)?(?:\s*[-+▲▼\(\)]|\s*\/|\s*—|\s*-|\s*·)/i);
      if (priceMatch) {
        const c = clean(priceMatch[1]);
        if (c) return c;
      }

      const nounMatch = s.match(/^([A-Z0-9&-]{2,15})\s+(?:Share\s*Price|Stock\s*Price|Live\s*Chart|Overview)\b/i);
      if (nounMatch) {
        const c = clean(nounMatch[1]);
        if (c) return c;
      }

      return "";
    }

    // 1. Embedded TradingView / Broker Chart Header Toolbar Button (HIGHEST PRIORITY)
    const tvHeaders = document.querySelectorAll(
      "#header-toolbar-symbol-search, [data-name='header-toolbar-symbol-search'], [data-name='symbol-search-items'], button[id*='symbol-search' i], div[id*='symbol-search' i], button[aria-label*='Symbol' i], button[aria-label*='symbol' i], button[title*='Symbol' i], [class*='symbolSearchText'], [class*='symbolSearch-'], div[class*='symbolSearch'], [class*='symbol-edit'], [class*='symbolEdit'], [data-role='button'][id*='symbol' i]"
    );
    for (const btn of tvHeaders) {
      const text = btn.textContent || btn.getAttribute("title") || btn.getAttribute("aria-label");
      if (text) {
        const sym = extract(text);
        if (sym) return { symbol: sym, platform, source: "chart" };
      }
    }

    // 2. Chart Legend Series Title (where active candle ticker is rendered)
    const legEls = document.querySelectorAll(
      "[data-name='legend-source-title'], [data-name='legend-series-item'], div[class*='legendSourceTitle'], div[class*='titleWrapper'], div[class*='seriesTitle'], .chart-widget .pane-legend-line, div[class*='pane-legend'], .pane-legend, [class*='apply-common-tooltip'][class*='title'], [class*='legend-'] [class*='title'], [class*='pane-legend-title'], [class*='sourcesWrapper']"
    );
    for (const leg of legEls) {
      const text = leg.getAttribute("data-symbol-full") || leg.getAttribute("data-symbol") || leg.getAttribute("title") || leg.getAttribute("aria-label") || leg.textContent;
      if (text) {
        const sym = extract(text);
        if (sym) return { symbol: sym, platform, source: "chart" };
      }
    }

    // 3. Active Watchlist & Selected Scrip Selectors across all brokers
    const activeSelectors = [
      "[data-name='watch-list-item'][class*='active']",
      "[data-name='watch-list-item'][aria-selected='true']",
      "[data-name='watch-list-item'].selected",
      ".instrument.selected .nice-name",
      ".instrument.selected",
      "[class*='selected-scrip']",
      "[class*='active-instrument']",
      "[class*='scrip-item'][class*='active']",
      "[class*='scrip-item'][class*='selected']",
      "tr[class*='active'] [class*='scrip']",
      "tr[class*='selected'] [class*='scrip']",
      "tr[class*='active'] [class*='symbol']",
      "tr[class*='selected'] [class*='symbol']",
      "tr[class*='active']",
      "tr[class*='selected']",
      "div[class*='item'][class*='active']",
      "div[class*='item'][class*='selected']",
      "li[class*='active']",
      "li[class*='selected']",
      "[aria-selected='true'][class*='scrip']",
      "[aria-selected='true'][class*='symbol']",
      "[aria-selected='true']",
      ".order-window .instrument-name",
      ".tv-chart-container .instrument",
      "[class*='active-scrip']",
      "[class*='header-symbol']",
      "[data-testid*='active-symbol']",
    ];
    for (const sel of activeSelectors) {
      try {
        const itemEls = document.querySelectorAll(sel);
        for (const item of itemEls) {
          const raw = item.getAttribute("data-symbol-full") || item.getAttribute("data-symbol") || item.getAttribute("data-ticker") || item.textContent;
          if (raw) {
            const sym = extract(raw);
            if (sym) return { symbol: sym, platform, source: "watchlist" };
          }
        }
      } catch {}
    }

    // 4. TradingView official URL router parameter
    if (host.includes("tradingview.com")) {
      try {
        const p = new URLSearchParams(window.location.search);
        const sVal = p.get("symbol");
        if (sVal) {
          const sym = extract(sVal);
          if (sym) return { symbol: sym, platform, source: "url" };
        }
        if (href.includes("/symbols/")) {
          const pathParts = window.location.pathname.split("/symbols/")[1];
          if (pathParts) {
            const sym = extract(pathParts);
            if (sym) return { symbol: sym, platform, source: "url" };
          }
        }
      } catch {}
    }

    // 5. URL parameters & path (e.g. ?symbols=1@26000, ?symbol=RELIANCE, /stocks/..., /chart/...)
    try {
      const params = new URLSearchParams(window.location.search);
      for (const pKey of ["symbol", "symbols", "scrip", "tradingsymbol", "ticker", "instrument"]) {
        const val = params.get(pKey);
        if (val) {
          const choiceSym = resolveChoiceToken(val);
          if (choiceSym) return { symbol: choiceSym, platform, source: "url" };
          if (!/^\d+$/.test(val) && !val.includes("@")) {
            const sym = extract(val);
            if (sym) return { symbol: sym, platform, source: "url" };
          }
        }
      }
      if (href.includes("/symbols/")) {
        const pathParts = window.location.pathname.split("/symbols/")[1];
        if (pathParts) {
          const sym = extract(pathParts);
          if (sym) return { symbol: sym, platform, source: "url" };
        }
      }
    } catch {}

    // 6. Broker-specific URL fallbacks
    if (host.includes("zerodha.com")) {
      const m = href.match(/\/chart\/(?:ext\/tvc\/)?(?:NSE|BSE)\/([A-Z0-9&-]+)/i);
      if (m) {
        const c = clean(m[1]);
        if (c) return { symbol: c, platform: "Zerodha Kite", source: "url" };
      }
    } else if (host.includes("groww.in")) {
      if (href.includes("/stocks/")) {
        const slug = href.split("/stocks/")[1]?.split(/[?#/]/)[0];
        if (slug) {
          const c = clean(slug);
          if (c) return { symbol: c, platform: "Groww", source: "url" };
        }
      }
    } else if (host.includes("google.com") && href.includes("/finance")) {
      const m = href.match(/\/quote\/([A-Z0-9&-]+):(NSE|BSE)/i);
      if (m) {
        const c = clean(m[1]);
        if (c) return { symbol: c, platform: "Google Finance", source: "url" };
      }
    } else if (host.includes("finance.yahoo.com")) {
      const m = href.match(/\/quote\/([A-Z0-9&-]+)\.(?:NS|BO)/i);
      if (m) {
        const c = clean(m[1]);
        if (c) return { symbol: c, platform: "Yahoo Finance", source: "url" };
      }
    }

    // 7. Strict Document Title Fallback
    if (title) {
      const sym = extractTitle(title);
      if (sym) return { symbol: sym, platform, source: "title" };
    }

    return null;
  }

  // Main fetch & render function with in-flight guard
  let isLoading = false;
  let latestRenderedData = null;

  async function loadSymbol(sym) {
    if (!sym) return;
    if (isLoading && sym === currentSymbol) return;

    const isNewSymbol = sym !== currentSymbol;
    currentSymbol = sym;
    inputSymbol.value = sym;
    // A refresh of the symbol on screen keeps it visible instead of flashing the placeholder.
    if (isNewSymbol || view !== "content") showView("loading");
    isLoading = true;

    try {
      // The background worker owns the token (renews it from the website session) and the cache.
      const resp = await sendMessage({ type: "FETCH_QUOTE_DATA", symbol: sym, exchange: "NSE" });
      if (resp?.isAuthError) {
        updateAuthUI(false, null);
        showView("locked");
        return;
      }
      if (!resp?.ok) throw new Error(resp?.error || "Failed to fetch quote");
      const data = resp.data;
      const stored = await new Promise((r) => chrome.storage.local.get(["qpUser"], r));
      updateAuthUI(true, stored?.qpUser || null);
      render(data);
      currentSymbol = data.symbol || sym;

      chrome.storage.local.get(["activeSymbol"], (s) => {
        if (s?.activeSymbol !== data.symbol) {
          chrome.storage.local.set({ activeQuoteData: data, activeSymbol: data.symbol });
        }
      });
      pushHudDirectToTabs(data);
    } catch (err) {
      if (isNewSymbol || view !== "content") showError(sym, err);
    } finally {
      isLoading = false;
    }
  }

  const SEGMENT = { equity: "Equity", sme: "SME", etf: "ETF", index: "Index" };
  const shortDay = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  // Gain/loss is never colour-only: sign + glyph + colour (MASTER.md).
  const signedPct = (v) => `${v >= 0 ? "▲ +" : "▼ −"}${Math.abs(v).toFixed(2)}%`;

  function render(data) {
    latestRenderedData = data;
    showView("content");

    $("stock-symbol").textContent = data.symbol;
    $("stock-name").textContent = data.name || data.symbol;
    $("stock-name").title = data.name || "";
    $("stock-exchange").textContent = `${data.exchange || "NSE"} · ${SEGMENT[data.segment] || "Equity"}`;
    $("stock-sector").textContent = data.sector || "";
    $("stock-sector").classList.toggle("hidden", !data.sector);
    $("stock-asof").textContent = data.as_of ? `EOD · ${shortDay(data.as_of)} close` : "EOD";

    const price = $("stock-price");
    price.textContent = formatRupees(data.last_price);
    setCopy(price, data.last_price, "price");

    const elDelta = $("stock-delta");
    if (data.change_pct != null) {
      const up = data.change_pct >= 0;
      const sign = up ? "+" : "−";
      elDelta.textContent = `${up ? "▲" : "▼"} ${sign}${Math.abs(data.change_pct).toFixed(2)}% (${sign}${formatRupees(Math.abs(data.change))})`;
      elDelta.className = `stock-delta num ${up ? "text-gain" : "text-loss"}`;
    } else {
      elDelta.textContent = "—";
      elDelta.className = "stock-delta num";
    }

    renderSpark(data);
    renderSignal(data);
    renderPlan(data);
    renderLevels(data);

    $("btn-open-app").href = data.quantPulseUrl || `${backendUrl}/app/markets/${encodeURIComponent(data.symbol)}`;
  }

  // ---------- 3-month price line: 1.5px ink line, end dot by direction, ≥8px signal dots ----------
  const SVG_NS = "http://www.w3.org/2000/svg";
  let spark = null;

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  }

  function renderSpark(data) {
    const fig = $("spark");
    const svg = $("spark-svg");
    const hist = (data?.history || []).filter((p) => Number.isFinite(p.close));
    svg.replaceChildren();
    $("spark-tip").classList.add("hidden");
    if (hist.length < 2) {
      fig.classList.add("hidden");
      spark = null;
      return;
    }
    fig.classList.remove("hidden");

    const w = Math.max(200, Math.round(svg.getBoundingClientRect().width || 300));
    const h = 48;
    const pad = 5;
    const closes = hist.map((p) => p.close);
    const min = Math.min(...closes);
    const span = Math.max(...closes) - min || 1;
    const x = (i) => pad + (i * (w - pad * 2)) / (hist.length - 1);
    const y = (v) => pad + (1 - (v - min) / span) * (h - pad * 2);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

    const d = hist.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join("");
    svg.append(svgEl("path", { class: "spark-line", d }));

    const last = hist.length - 1;
    const dir = closes[last] >= closes[0] ? "up" : "down";
    const index = new Map(hist.map((p, i) => [p.date, i]));
    const sigs = (data.recentSignals || [])
      .map((s) => ({ s, i: index.get(String(s.date).slice(0, 10)) }))
      .filter((o) => o.i !== undefined);
    for (const { s, i } of sigs) {
      svg.append(svgEl("circle", { class: `spark-dot ${signalMeta(s.kind).up ? "up" : "down"}`, cx: x(i), cy: y(hist[i].close), r: 4 }));
    }
    svg.append(svgEl("circle", { class: `spark-end ${dir}`, cx: x(last), cy: y(closes[last]), r: 3 }));

    const hover = svgEl("g", { class: "hidden" });
    const cross = svgEl("line", { class: "spark-cross", y1: 0, y2: h });
    const knob = svgEl("circle", { class: "spark-hover", r: 3.5 });
    hover.append(cross, knob);
    svg.append(hover);

    const chg = ((closes[last] - closes[0]) / closes[0]) * 100;
    $("spark-caption").textContent =
      `Closing price over the last ${hist.length} sessions: ${formatRupees(closes[0])} on ${shortDay(hist[0].date)} ` +
      `to ${formatRupees(closes[last])} on ${shortDay(hist[last].date)} (${chg >= 0 ? "+" : "−"}${Math.abs(chg).toFixed(1)}%). ` +
      `${sigs.length} signal${sigs.length === 1 ? "" : "s"} marked. Use the arrow keys to read each day.`;
    spark = { hist, x, y, w, pad, hover, cross, knob, sigs, at: last };
  }

  function sparkShow(i) {
    if (!spark) return;
    const { hist, x, y, w, hover, cross, knob, sigs } = spark;
    i = Math.max(0, Math.min(hist.length - 1, i));
    spark.at = i;
    hover.classList.remove("hidden");
    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    knob.setAttribute("cx", x(i));
    knob.setAttribute("cy", y(hist[i].close));

    const tip = $("spark-tip");
    const sig = sigs.find((o) => o.i === i);
    tip.replaceChildren();
    const line1 = document.createElement("div");
    line1.append(`${shortDay(hist[i].date)} · `);
    const px = document.createElement("span");
    px.className = "num";
    px.textContent = formatRupees(hist[i].close);
    line1.append(px);
    tip.append(line1);
    if (sig) {
      const m = signalMeta(sig.s.kind);
      const line2 = document.createElement("div");
      line2.textContent = `${m.up ? "▲" : "▼"} ${m.word} · ${sig.s.label}`;
      tip.append(line2);
    }
    tip.style.left = `${Math.min(85, Math.max(15, (x(i) / w) * 100))}%`;
    tip.classList.remove("hidden");
  }

  function sparkHide() {
    if (!spark) return;
    spark.hover.classList.add("hidden");
    $("spark-tip").classList.add("hidden");
  }

  const fig = $("spark");
  fig.addEventListener("pointermove", (e) => {
    if (!spark) return;
    const rect = $("spark-svg").getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * spark.w;
    sparkShow(Math.round(((px - spark.pad) / (spark.w - spark.pad * 2)) * (spark.hist.length - 1)));
  });
  fig.addEventListener("pointerleave", sparkHide);
  fig.addEventListener("focus", () => spark && sparkShow(spark.at));
  fig.addEventListener("blur", sparkHide);
  fig.addEventListener("keydown", (e) => {
    if (!spark) return;
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (step) sparkShow(spark.at + step);
    else if (e.key === "Home") sparkShow(0);
    else if (e.key === "End") sparkShow(spark.hist.length - 1);
    else return;
    e.preventDefault();
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => latestRenderedData && renderSpark(latestRenderedData), 120);
  });

  // ---------- Tabs ----------
  const TABS = ["signal", "plan", "levels"];

  function selectTab(name, focus = false) {
    if (!TABS.includes(name)) name = "signal";
    TABS.forEach((t, i) => {
      const on = t === name;
      const tab = $(`tab-${t}`);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      $(`panel-${t}`).classList.toggle("hidden", !on);
      if (on) {
        document.querySelector(".tab-indicator").style.transform = `translateX(${i * 100}%)`;
        if (focus) tab.focus();
      }
    });
    chrome.storage.local.set({ qpPanelTab: name });
  }

  document.querySelector(".tabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) selectTab(tab.dataset.tab);
  });
  document.querySelector(".tabs").addEventListener("keydown", (e) => {
    const current = TABS.indexOf(document.activeElement?.dataset?.tab);
    if (current < 0) return;
    const next = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    selectTab(TABS[(next + TABS.length) % TABS.length], true);
  });

  // ---------- Signal story ----------
  function renderSignal(data) {
    const s = data.latestSignal;
    $("signal-none").classList.toggle("hidden", Boolean(s));
    $("signal-body").classList.toggle("hidden", !s);
    if (!s) return;

    const m = signalMeta(s.kind);
    const badge = $("signal-badge");
    badge.className = `badge ${m.up ? "badge-up" : "badge-down"}`;
    badge.textContent = `${m.up ? "▲" : "▼"} ${m.badge.replace(/ SIGNAL$/, "")}`;

    const n = s.sessionsSince;
    const ago = n == null ? "" : n === 0 ? " · latest close" : ` · ${n} session${n === 1 ? "" : "s"} ago`;
    $("signal-when").textContent = `${formatSignalDate(s.date)}${ago}`;
    $("signal-label").textContent = s.label;
    $("signal-rule").textContent = s.rule || "";
    $("signal-rule").classList.toggle("hidden", !s.rule);

    $("signal-price-label").textContent = m.priceLabel === "Exit Price" ? "Exit price" : "Signal price";
    const sp = $("signal-price");
    sp.textContent = formatRupees(s.price);
    setCopy(sp, s.price, "signal price");
    const st = $("signal-stop");
    st.textContent = s.stop ? formatRupees(s.stop) : "—";
    setCopy(st, s.stop, "stop");

    const since = $("signal-since");
    if (s.moveSincePct != null) {
      since.textContent = signedPct(s.moveSincePct);
      since.className = `num ${s.moveSincePct >= 0 ? "text-gain" : "text-loss"}`;
    } else {
      since.textContent = "—";
      since.className = "num";
    }

    const list = $("signal-timeline");
    list.replaceChildren();
    for (const sig of (data.recentSignals || []).slice(0, 5)) {
      const mm = signalMeta(sig.kind);
      const dir = mm.up ? "up" : "down";
      const li = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = `tl-dot ${dir}`;
      const main = document.createElement("span");
      main.className = "tl-main";
      const word = document.createElement("span");
      word.className = `tl-word ${dir}`;
      word.textContent = `${mm.up ? "▲" : "▼"} ${mm.word}`;
      const label = document.createElement("span");
      label.className = "tl-label";
      label.textContent = sig.label;
      main.append(word, label);
      const side = document.createElement("span");
      side.className = "tl-side";
      const px = document.createElement("span");
      px.className = "num";
      px.textContent = formatRupees(sig.price);
      const date = document.createElement("span");
      date.className = "tl-date num";
      date.textContent = formatSignalDate(sig.date);
      side.append(px, date);
      li.append(dot, main, side);
      list.append(li);
    }
  }

  // ---------- Plan: one price ladder, rungs at their real distances ----------
  function renderPlan(data) {
    const p = data.tradePlan;
    $("plan-none").classList.toggle("hidden", Boolean(p));
    $("plan-body").classList.toggle("hidden", !p);
    if (!p) return;

    $("plan-r").textContent = `${formatRupees(p.riskPerShare)} (${p.riskPercent.toFixed(1)}%)`;
    const now = Number(data.last_price);
    const rungs = [
      { tag: "T3", r: "+3R", px: p.t3, cls: "target" },
      { tag: "T2", r: "+2R", px: p.t2, cls: "target" },
      { tag: "T1", r: "+0.75R", px: p.t1, cls: "target" },
      { tag: "Entry", r: "", px: p.entry, cls: "entry" },
      { tag: "Stop", r: "−1R", px: p.stop, cls: "stop" },
    ];

    const values = rungs.map((r) => r.px).concat(Number.isFinite(now) ? [now] : []);
    const hi = Math.max(...values);
    const lo = Math.min(...values);
    const H = 232;
    const inset = 14;
    const yOf = (v) => inset + ((hi - v) / (hi - lo || 1)) * (H - inset * 2);

    // Keep labels from colliding when rungs are close; the rail grows if it must.
    const MIN_GAP = 32;
    let prev = -Infinity;
    const ys = rungs.map((r) => {
      const yv = Math.max(yOf(r.px), prev + MIN_GAP);
      prev = yv;
      return yv;
    });
    const height = Math.max(H, prev + inset);
    const ladder = $("ladder");
    ladder.replaceChildren();
    ladder.style.height = `${height}px`;

    const entryY = ys[3];
    const zone = (cls, top, bottom) => {
      const z = document.createElement("span");
      z.className = `ladder-zone ${cls}`;
      z.style.top = `${top}px`;
      z.style.height = `${Math.max(0, bottom - top)}px`;
      z.setAttribute("aria-hidden", "true");
      ladder.append(z);
    };
    zone("reward", ys[0], entryY);
    zone("risk", entryY, ys[4]);

    rungs.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = `rung ${r.cls}`;
      row.setAttribute("role", "listitem");
      row.style.top = `${ys[i]}px`;
      const tag = document.createElement("span");
      tag.className = "rung-tag";
      tag.textContent = r.tag;
      if (r.r) {
        const small = document.createElement("small");
        small.textContent = r.r;
        tag.append(small);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rung-px num copyable";
      btn.textContent = formatRupees(r.px);
      setCopy(btn, r.px, r.tag);
      if (r.cls !== "entry") {
        const pct = ((r.px - p.entry) / p.entry) * 100;
        const small = document.createElement("small");
        small.textContent = `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`;
        btn.append(small);
      }
      row.append(tag, btn);
      ladder.append(row);
    });

    if (Number.isFinite(now)) {
      const marker = document.createElement("span");
      marker.className = "now";
      marker.textContent = "Now";
      marker.title = `Last close ${formatRupees(now)}`;
      marker.style.top = `${Math.min(height - inset, Math.max(inset, yOf(now)))}px`;
      marker.setAttribute("role", "listitem");
      marker.setAttribute("aria-label", `Last close ${formatRupees(now)}`);
      ladder.append(marker);
    }
  }

  // ---------- Levels: each value with where the price sits against it ----------
  function renderLevels(data) {
    const list = $("levels");
    list.replaceChildren();
    const last = Number(data.last_price);

    const row = (name, value, copyVal, sub) => {
      const li = document.createElement("li");
      li.className = "lv";
      const n = document.createElement("span");
      n.className = "lv-name";
      n.textContent = name;
      const v = document.createElement(copyVal != null ? "button" : "span");
      v.className = `lv-val num${copyVal != null ? " copyable" : ""}`;
      if (copyVal != null) {
        v.type = "button";
        setCopy(v, copyVal, name);
      }
      v.textContent = value;
      li.append(n, v);
      if (sub) li.append(sub);
      list.append(li);
    };
    const subRow = (text, track) => {
      const s = document.createElement("span");
      s.className = "lv-sub";
      if (track) s.append(track);
      const t = document.createElement("span");
      t.className = "num";
      t.textContent = text;
      s.append(t);
      return s;
    };
    const trackEl = (parts) => {
      const t = document.createElement("span");
      t.className = "track";
      t.setAttribute("aria-hidden", "true");
      for (const [cls, style] of parts) {
        const el = document.createElement("span");
        el.className = cls;
        Object.assign(el.style, style);
        t.append(el);
      }
      return t;
    };

    row("Prev close", formatRupees(data.prev_close), data.prev_close);
    row("Volume", formatVolume(data.volume), null);

    for (const [name, val] of [["SMA 20", data.sma20], ["SMA 50", data.sma50], ["SMA 200", data.sma200]]) {
      if (!val || !Number.isFinite(last)) {
        row(name, formatRupees(val), val || null);
        continue;
      }
      // Diverging bar: centre = the average; ±15% fills the half.
      const pct = ((last - val) / val) * 100;
      const half = (Math.min(Math.abs(pct), 15) / 15) * 50;
      const fill = pct >= 0 ? { left: "50%", width: `${half}%` } : { left: `${50 - half}%`, width: `${half}%` };
      const track = trackEl([[`track-fill ${pct >= 0 ? "up" : "down"}`, fill], ["track-mid", {}]]);
      row(name, formatRupees(val), val, subRow(`${signedPct(pct)} ${pct >= 0 ? "above" : "below"}`, track));
    }

    if (data.low_52w != null && data.high_52w != null && Number.isFinite(last)) {
      const range = data.high_52w - data.low_52w || 1;
      const pos = Math.min(100, Math.max(0, ((last - data.low_52w) / range) * 100));
      const track = trackEl([["track-pin", { left: `${pos}%` }]]);
      row("52-week range", `${formatRupees(data.low_52w)} – ${formatRupees(data.high_52w)}`, null, subRow(`${pos.toFixed(0)}% of range`, track));
    }

    const s = data.sentiment;
    if (s && s.rsi != null) {
      const rsi = Math.min(100, Math.max(0, s.rsi));
      const track = trackEl([["track-band", { left: "30%", width: "40%" }], ["track-pin", { left: `${rsi}%` }]]);
      row("RSI (14)", s.rsi.toFixed(1), null, subRow(s.zone || "", track));
      if (s.description) {
        const li = list.lastElementChild;
        const note = document.createElement("span");
        note.className = "lv-sub";
        note.textContent = s.description;
        li.append(note);
      }
    }
  }

  // ---------- Errors ----------
  function showError(sym, err) {
    const notFound = /404|not found/i.test(String(err?.message || ""));
    $("error-title").textContent = notFound ? `${sym} isn't covered` : `Couldn't load ${sym}`;
    $("error-text").textContent = notFound
      ? "QuantsPulse covers NSE stocks, ETFs and indices. Check the symbol, or try one of these."
      : "QuantsPulse didn't answer. Check your connection and try again.";
    $("btn-retry").classList.toggle("hidden", notFound);
    showView("error");
  }

  $("btn-retry").addEventListener("click", () => {
    const sym = currentSymbol;
    currentSymbol = "";
    loadSymbol(sym);
  });
  document.querySelectorAll("[data-sym]").forEach((b) =>
    b.addEventListener("click", () => {
      inputSymbol.value = b.dataset.sym;
      loadSymbol(b.dataset.sym);
    }),
  );

  // ---------- Sign-in check ----------
  btnAuthCheck.addEventListener("click", async () => {
    btnAuthCheck.textContent = "Checking…";
    btnAuthCheck.disabled = true;
    try {
      // The background worker asks the website with your QuantsPulse cookies and stores the token.
      const resp = await sendMessage({ type: "QP_REFRESH_AUTH" });
      if (!resp) throw new Error("no response");
      const stored = await new Promise((r) => chrome.storage.local.get(["qpAuthenticated", "qpUser"], r));
      if (resp.ok && stored.qpAuthenticated) {
        updateAuthUI(true, stored.qpUser || null);
        toast("Signed in");
        if (currentSymbol) {
          const sym = currentSymbol;
          currentSymbol = "";
          loadSymbol(sym);
        }
      } else {
        toast("Not signed in yet");
      }
    } catch {
      toast("Couldn't reach QuantsPulse");
    } finally {
      btnAuthCheck.textContent = "Check login status";
      btnAuthCheck.disabled = false;
    }
  });

  // Real-time auth event synchronization from background worker / auth-sync.js
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "QP_AUTH_UPDATE") {
      updateAuthUI(message.authenticated, message.user);
      if (message.authenticated && currentSymbol) loadSymbol(currentSymbol);
    }
  });

  // ---------- Click a price to copy it ----------
  function setCopy(el, value, label) {
    const ok = value != null && Number.isFinite(Number(value));
    el.dataset.copy = ok ? Number(value).toFixed(2) : "";
    el.dataset.copyLabel = label;
    el.title = ok ? `Copy ${label}` : "";
    el.disabled = !ok;
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-copy]");
    if (!el || !el.dataset.copy) return;
    navigator.clipboard.writeText(el.dataset.copy).then(
      () => toast(`Copied ${el.dataset.copyLabel} ₹${el.dataset.copy}`),
      () => toast("Couldn't copy"),
    );
  });

  let toastTimer;
  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.classList.remove("hidden");
    t.style.animation = "none";
    void t.offsetWidth; // restart the entrance
    t.style.animation = "";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 1600);
  }

  // Keyboard: '/' or Ctrl/Cmd+K to search, Escape to leave the field
  window.addEventListener("keydown", (e) => {
    const isTyping = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable;
    if ((e.key === "/" && !isTyping) || ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K"))) {
      e.preventDefault();
      inputSymbol.focus();
      inputSymbol.select();
    } else if (e.key === "Escape" && isTyping) {
      e.target.blur();
    }
  });
})();
