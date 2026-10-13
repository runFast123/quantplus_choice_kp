import "server-only";

import { serviceRole } from "./service-role";
import { isPlatformAdmin } from "./admin";
import { PrivilegedError } from "./guards";

export interface SyncEodOptions {
  actorId?: string;
  scope?: "active" | "top" | "all" | "custom";
  symbols?: string[];
  days?: number;
  triggerDownstream?: boolean;
}

export interface SyncEodReport {
  success: boolean;
  scope: string;
  symbolsTargeted: number;
  symbolsUpdated: number;
  candlesUpserted: number;
  failedSymbols: string[];
  analyticsTotals: Record<string, number>;
  researchCount: number;
  alertsDispatched: Record<string, unknown> | null;
  durationMs: number;
}

interface RawYahooBar {
  symbol: string;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const DEFAULT_BENCHMARKS = ["NIFTY", "BANKNIFTY", "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "SBIN", "BHARTIARTL", "ITC"];

/**
 * Determine if an IST session is settled.
 * Trading closes at 15:30 IST; closing auction settles by 15:45 IST.
 */
function isSessionSettled(now = new Date()): { settledDateStr: string; isTodaySettled: boolean } {
  // IST offset is UTC + 5:30 (330 minutes)
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffsetMs);
  const hours = istTime.getUTCHours();
  const minutes = istTime.getUTCMinutes();
  const totalMins = hours * 60 + minutes;

  // 15:45 IST is 15 * 60 + 45 = 945 minutes
  const isTodaySettled = totalMins >= 945;

  // Format today in IST as YYYY-MM-DD
  const todayStr = istTime.toISOString().slice(0, 10);
  if (isTodaySettled) {
    return { settledDateStr: todayStr, isTodaySettled: true };
  }

  // If today is not settled yet, settled date is yesterday
  const prevDay = new Date(istTime.getTime() - 24 * 60 * 60 * 1000);
  return { settledDateStr: prevDay.toISOString().slice(0, 10), isTodaySettled: false };
}

/**
 * Fetch daily candles for a single ticker from Yahoo Finance v8 chart API.
 */
async function fetchYahooBars(
  symbol: string,
  vendorTicker: string | null,
  rangeDays = 10,
  settled: { settledDateStr: string; isTodaySettled: boolean },
): Promise<RawYahooBar[]> {
  const ticker = vendorTicker || (symbol.startsWith("^") ? symbol : `${symbol}.NS`);
  const range = rangeDays <= 5 ? "5d" : rangeDays <= 15 ? "1mo" : "3mo";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json",
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
    return [];
  }

  const timestamps: number[] = result.timestamp;
  const quotes = result.indicators.quote[0];
  const meta = result.meta || {};
  const fallbackPrice: number | null = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : null;

  const bars: RawYahooBar[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const rawTs = timestamps[i];
    const dateObj = new Date(rawTs * 1000);
    const dateStr = dateObj.toISOString().slice(0, 10);

    // If today is not yet settled (before 15:45 IST), skip today's partial moving bar
    if (dateStr > settled.settledDateStr) {
      continue;
    }

    let o = quotes.open?.[i];
    let h = quotes.high?.[i];
    let l = quotes.low?.[i];
    let c = quotes.close?.[i];
    const v = quotes.volume?.[i] ?? 0;

    // Use regularMarketPrice if close is missing on the last bar
    if ((c === null || c === undefined) && i === timestamps.length - 1 && fallbackPrice !== null) {
      c = fallbackPrice;
      if (o === null || o === undefined) o = fallbackPrice;
      if (h === null || h === undefined) h = Math.max(o, fallbackPrice);
      if (l === null || l === undefined) l = Math.min(o, fallbackPrice);
    }

    if (o === null || h === null || l === null || c === null) continue;
    if (typeof o !== "number" || typeof h !== "number" || typeof l !== "number" || typeof c !== "number") continue;
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;

    // Sanity checks on OHLC
    const high = Math.max(h, o, c);
    const low = Math.min(l, o, c);
    const volume = Math.max(0, Math.floor(v));

    // Candle ts stamped at 10:00:00Z = 15:30 IST session close per spec
    const isoTs = `${dateStr}T10:00:00.000Z`;

    bars.push({
      symbol,
      ts: isoTs,
      open: Math.round(o * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: Math.round(c * 100) / 100,
      volume,
    });
  }

  return bars;
}

/**
 * Execute synchronous EOD price sync across active or full market universe.
 */
export async function syncEodPrices(options: SyncEodOptions = {}): Promise<SyncEodReport> {
  const t0 = performance.now();
  const db = serviceRole();
  const { actorId, scope = "active", days = 10, triggerDownstream = true } = options;

  if (actorId && !(await isPlatformAdmin(actorId))) {
    throw new PrivilegedError("NOT_AUTHORIZED");
  }

  // 1. Resolve Target Symbols
  let targetSymbols: string[] = [];

  if (options.symbols && options.symbols.length > 0) {
    targetSymbols = options.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  } else if (scope === "active") {
    // Collect watched, held, and alerted symbols
    const [wRes, hRes, aRes] = await Promise.all([
      db.from("watchlist_items").select("symbol"),
      db.from("holdings").select("symbol"),
      db.from("price_alerts").select("symbol"),
    ]);

    const activeSet = new Set<string>(DEFAULT_BENCHMARKS);
    for (const r of wRes.data ?? []) if (r.symbol) activeSet.add(r.symbol);
    for (const r of hRes.data ?? []) if (r.symbol) activeSet.add(r.symbol);
    for (const r of aRes.data ?? []) if (r.symbol) activeSet.add(r.symbol);

    targetSymbols = Array.from(activeSet);
  } else if (scope === "top") {
    const { data } = await db
      .from("market_symbols")
      .select("symbol")
      .eq("exchange", "NSE")
      .eq("is_active", true)
      .order("mcap_rank", { ascending: true, nullsFirst: false })
      .limit(100);
    targetSymbols = (data ?? []).map((r) => r.symbol);
    if (!targetSymbols.includes("NIFTY")) targetSymbols.push("NIFTY");
    if (!targetSymbols.includes("BANKNIFTY")) targetSymbols.push("BANKNIFTY");
  } else if (scope === "all") {
    const { data } = await db
      .from("market_symbols")
      .select("symbol")
      .eq("exchange", "NSE")
      .eq("is_active", true)
      .order("symbol");
    targetSymbols = (data ?? []).map((r) => r.symbol);
  }

  if (targetSymbols.length === 0) {
    return {
      success: true,
      scope,
      symbolsTargeted: 0,
      symbolsUpdated: 0,
      candlesUpserted: 0,
      failedSymbols: [],
      analyticsTotals: {},
      researchCount: 0,
      alertsDispatched: null,
      durationMs: Math.round(performance.now() - t0),
    };
  }

  // Fetch symbol vendor mappings
  const { data: symMeta } = await db
    .from("market_symbols")
    .select("symbol, vendor_ticker")
    .in("symbol", targetSymbols);
  const vendorMap = new Map<string, string | null>();
  for (const m of symMeta ?? []) {
    vendorMap.set(m.symbol, m.vendor_ticker);
  }

  const settled = isSessionSettled();
  const allCandles: RawYahooBar[] = [];
  const failedSymbols: string[] = [];
  const updatedSymbolsSet = new Set<string>();

  // Fetch in chunks of 10 concurrently
  const CHUNK_SIZE = 10;
  for (let i = 0; i < targetSymbols.length; i += CHUNK_SIZE) {
    const chunk = targetSymbols.slice(i, i + CHUNK_SIZE);
    const results = await Promise.allSettled(
      chunk.map(async (s) => {
        const bars = await fetchYahooBars(s, vendorMap.get(s) ?? null, days, settled);
        return { symbol: s, bars };
      }),
    );

    for (let j = 0; j < results.length; j++) {
      const res = results[j];
      const s = chunk[j];
      if (res.status === "fulfilled" && res.value.bars.length > 0) {
        allCandles.push(...res.value.bars);
        updatedSymbolsSet.add(s);
      } else {
        failedSymbols.push(s);
      }
    }

    // Small delay between chunks to be courteous to Yahoo
    if (i + CHUNK_SIZE < targetSymbols.length) {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }

  // 2. Upsert candles into public.market_candles in batches of 500
  let candlesUpserted = 0;
  if (allCandles.length > 0) {
    const dbRows = allCandles.map((c) => ({
      symbol: c.symbol,
      exchange: "NSE",
      interval: "1d",
      ts: c.ts,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    const BATCH_SIZE = 500;
    for (let k = 0; k < dbRows.length; k += BATCH_SIZE) {
      const slice = dbRows.slice(k, k + BATCH_SIZE);
      const { error } = await db.from("market_candles").upsert(slice, {
        onConflict: "symbol,exchange,interval,ts",
      });
      if (error) {
        console.error("market_candles upsert error:", error.message);
      } else {
        candlesUpserted += slice.length;
      }
    }
  }

  // 3. Downstream Pipeline Execution
  const analyticsTotals: Record<string, number> = {};
  let researchCount = 0;
  let alertsDispatched: Record<string, unknown> | null = null;

  const touchedSymbols = Array.from(updatedSymbolsSet);

  if (triggerDownstream && touchedSymbols.length > 0) {
    // A. Recalculate Wilder RSI and SMAs
    const ANALYTICS_CHUNK = 50;
    for (let m = 0; m < touchedSymbols.length; m += ANALYTICS_CHUNK) {
      const part = touchedSymbols.slice(m, m + ANALYTICS_CHUNK);
      try {
        const { data: aData } = await db.rpc("svc_refresh_market_analytics", {
          p_days: Math.max(10, days + 5),
          p_symbols: part,
        });
        if (aData && typeof aData === "object") {
          for (const [k, v] of Object.entries(aData as Record<string, number>)) {
            analyticsTotals[k] = (analyticsTotals[k] || 0) + (typeof v === "number" ? v : 0);
          }
        }
      } catch (err) {
        console.warn("svc_refresh_market_analytics batch error:", err);
      }
    }

    // B. Rebuild Research Notes
    const RESEARCH_CHUNK = 100;
    for (let n = 0; n < touchedSymbols.length; n += RESEARCH_CHUNK) {
      const part = touchedSymbols.slice(n, n + RESEARCH_CHUNK);
      try {
        const { data: rData } = await db.rpc("svc_refresh_research", { p_symbols: part });
        researchCount += Number(rData || 0);
      } catch (err) {
        console.warn("svc_refresh_research batch error:", err);
      }
    }

    // C. Dispatch EOD Notifier
    try {
      const { data: notifData } = await db.rpc("svc_run_eod_notifier");
      alertsDispatched = notifData as Record<string, unknown>;
    } catch (err) {
      console.warn("svc_run_eod_notifier error:", err);
    }
  }

  const durationMs = Math.round(performance.now() - t0);

  // 4. Audit Log
  if (actorId) {
    await db.from("audit_log").insert({
      action: "admin.eod_sync",
      actor_user_id: actorId,
      target_type: "pipeline",
      target_id: scope,
      metadata: {
        scope,
        symbolsTargeted: targetSymbols.length,
        symbolsUpdated: touchedSymbols.length,
        candlesUpserted,
        failedCount: failedSymbols.length,
        durationMs,
      },
    });
  }

  return {
    success: true,
    scope,
    symbolsTargeted: targetSymbols.length,
    symbolsUpdated: touchedSymbols.length,
    candlesUpserted,
    failedSymbols,
    analyticsTotals,
    researchCount,
    alertsDispatched,
    durationMs,
  };
}
