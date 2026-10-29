import "server-only";

import { calculateTradePlan, evaluateSentiment, getAlphaLevel } from "@/lib/trade-plan";
import { describeSignal, toExtensionSignal, type ExtensionSignal } from "@/lib/extension-signals";
import type { Quote } from "@/lib/types";
import { normalizeQuote } from "../market-data";
import { serviceRole } from "./service-role";

export interface ExtensionQuotePayload {
  symbol: string;
  exchange: string;
  name: string;
  segment: string | null;
  sector: string | null;
  last_price: number | null;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
  volume: number | null;
  rsi: number | null;
  low_52w: number | null;
  high_52w: number | null;
  as_of: string | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  /** The latest stored signal, with what it means and how far price has moved since it fired. */
  latestSignal: (ExtensionSignal & { rule: string; sessionsSince: number | null; moveSincePct: number | null }) | null;
  recentSignals?: ExtensionSignal[];
  /** Daily closes for the last ~3 months (oldest first), for the side panel's price line. */
  history: Array<{ date: string; close: number }>;
  tradePlan: {
    entry: number;
    stop: number;
    riskPerShare: number;
    riskPercent: number;
    t1: number;
    t2: number;
    t3: number;
    isValid: boolean;
  } | null;
  sentiment: {
    rsi: number | null;
    zone: string;
    alphaLevel: string;
    description: string;
  } | null;
  quantPulseUrl: string;
}

/**
 * Clean incoming ticker string (handles TradingView "NSE:TCS", Yahoo "TCS.NS", Kite "TCS-EQ").
 */
export function cleanExtensionSymbol(raw: string): string {
  let s = raw.trim().toUpperCase();
  if (s.includes(":")) {
    const parts = s.split(":");
    s = parts[parts.length - 1];
  }
  s = s.replace(/\.(NS|BO)$/i, "").replace(/-EQ$/i, "").trim();

  const ALIASES: Record<string, string> = {
    NIFTY50: "NIFTY",
    "NIFTY-50": "NIFTY",
    "NIFTY 50": "NIFTY",
    CNXNIFTY: "NIFTY",
    "CNX NIFTY": "NIFTY",
    NIFTYBANK: "BANKNIFTY",
    "NIFTY BANK": "BANKNIFTY",
    BANKNIFTY: "BANKNIFTY",
    "BANK NIFTY": "BANKNIFTY",
    CNXBANK: "BANKNIFTY",
    FINNIFTY: "NIFTYFINSERV",
    "FIN NIFTY": "NIFTYFINSERV",
    "NIFTY FIN": "NIFTYFINSERV",
    "NIFTY FINANCIAL": "NIFTYFINSERV",
    "NIFTY FINANCIAL SERVICES": "NIFTYFINSERV",
    "NIFTY FIN SERVICE": "NIFTYFINSERV",
    "NIFTY FIN SERVICES": "NIFTYFINSERV",
    MIDCPNIFTY: "NIFTYMIDCAP50",
    "MIDCAP NIFTY": "NIFTYMIDCAP50",
    "NIFTY MIDCAP": "NIFTYMIDCAP50",
    "NIFTY MIDCAP 50": "NIFTYMIDCAP50",
    "NIFTY MIDCAP 100": "NIFTYMIDCAP100",
    "NIFTY SMALLCAP 100": "NIFTYSMALLCAP100",
    NIFTYJR: "NIFTY100",
    "NIFTY JR": "NIFTY100",
    "NIFTY JUNIOR": "NIFTY100",
    "NIFTY NEXT 50": "NIFTY100",
    "JUNIOR NIFTY": "NIFTY100",
  };

  return ALIASES[s] ?? s;
}

/**
 * Fetch full quantitative intelligence payload for the Chrome Extension side panel.
 */
export async function getExtensionQuote(rawSymbol: string, exchange = "NSE"): Promise<ExtensionQuotePayload | null> {
  const symbol = cleanExtensionSymbol(rawSymbol);
  if (!symbol) return null;

  const db = serviceRole();

  const [quoteRes, signalsRes, candlesRes] = await Promise.all([
    db.from("market_snapshot").select("*").eq("symbol", symbol).eq("exchange", exchange).maybeSingle(),
    db.from("trading_signals").select("*").eq("symbol", symbol).order("generated_at", { ascending: false }).limit(20),
    db
      .from("market_candles")
      .select("ts, close")
      .eq("symbol", symbol)
      .eq("interval", "1d")
      .order("ts", { ascending: false })
      .limit(205),
  ]);

  let quoteData = quoteRes.data;
  if (!quoteData) {
    const fallback = await db.from("market_snapshot").select("*").eq("symbol", symbol).limit(1).maybeSingle();
    quoteData = fallback.data;
  }

  if (!quoteData) return null;

  const q = normalizeQuote(quoteData as Quote);
  const signals = signalsRes.data ?? [];
  const candles = (candlesRes.data ?? []).map((c) => ({ date: String(c.ts).slice(0, 10), close: Number(c.close) }));
  const closes = candles.map((c) => c.close);

  // Compute Moving Averages
  const calcSma = (period: number) => {
    if (closes.length < period) return null;
    const sum = closes.slice(0, period).reduce((a, b) => a + b, 0);
    return Number((sum / period).toFixed(2));
  };
  const sma20 = calcSma(20);
  const sma50 = calcSma(50);
  const sma200 = calcSma(200);

  // Latest signals
  // Only stored signals from the published strategies — never a stand-in when a stock has none.
  const recentSignals = signals.slice(0, 6).map(toExtensionSignal);
  const latestRow = signals[0];
  const latestSignal = recentSignals[0]
    ? (() => {
        const sig = recentSignals[0];
        const day = sig.date.slice(0, 10);
        // Sessions since it fired, counted on the candles we have (null if older than them).
        const inRange = candles.length > 0 && candles[candles.length - 1].date <= day;
        return {
          ...sig,
          rule: describeSignal(latestRow),
          sessionsSince: inRange ? candles.filter((c) => c.date > day).length : null,
          moveSincePct:
            sig.price && q.last_price ? Number((((q.last_price - sig.price) / sig.price) * 100).toFixed(2)) : null,
        };
      })()
    : null;

  // The plan follows the latest signal only while it is an open long entry, from that signal's own
  // entry and stop. After an exit, a short entry or a cover there is no long plan to show.
  const entry = latestSignal?.kind === "buy" ? latestSignal.price ?? 0 : 0;
  const stop = latestSignal?.kind === "buy" ? latestSignal.stop ?? 0 : 0;

  let tradePlan: ExtensionQuotePayload["tradePlan"] = null;
  if (entry > 0 && stop > 0 && stop < entry) {
    try {
      tradePlan = calculateTradePlan({ entry, stop, lastPrice: q.last_price ?? undefined });
    } catch {
      tradePlan = null;
    }
  }

  // Sentiment Evaluation & Alpha Tier
  const sentimentMeta = evaluateSentiment(q.rsi);
  const alphaTier = q.rsi != null ? getAlphaLevel(q.rsi) : "ALPHA TARGET";
  const sentiment = {
    rsi: q.rsi,
    zone: sentimentMeta?.label ?? "Equilibrium",
    alphaLevel: alphaTier,
    description: sentimentMeta?.sub ?? "Price is navigating normal trading channels.",
  };

  const appBase = process.env.NEXT_PUBLIC_APP_URL || "https://quantplus-ten.vercel.app";

  return {
    symbol: q.symbol,
    exchange: q.exchange,
    name: q.name,
    segment: q.segment ?? null,
    sector: q.sector,
    last_price: q.last_price,
    prev_close: q.prev_close,
    change: q.change,
    change_pct: q.change_pct,
    volume: q.volume,
    rsi: q.rsi,
    low_52w: q.low_52w,
    high_52w: q.high_52w,
    as_of: q.as_of,
    sma20,
    sma50,
    sma200,
    latestSignal,
    recentSignals,
    history: candles.slice(0, 63).reverse(),
    tradePlan,
    sentiment,
    quantPulseUrl: `${appBase}/app/markets/${encodeURIComponent(q.symbol)}`,
  };
}
