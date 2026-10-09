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

  // Load preferences
  chrome.storage.local.get(["backendUrl", "activeSymbol", "platform"], (res) => {
    if (res.backendUrl) {
      backendUrl = res.backendUrl.replace(/\/$/, "");
      inputBackend.value = backendUrl;
    }
    if (res.platform) {
      elPlatformBadge.textContent = res.platform;
    }
    if (res.activeSymbol) {
      loadSymbol(res.activeSymbol);
    }
  });

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

  // Refresh
  btnRefresh.addEventListener("click", () => {
    if (currentSymbol) loadSymbol(currentSymbol);
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
