import "server-only";

import { calculateTradePlan, evaluateSentiment, getAlphaLevel } from "@/lib/trade-plan";
import { signalDisplayName } from "@/lib/format";
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
  latestSignal: {
    kind: "buy" | "exit";
    strategy: string;
    label: string;
    date: string;
    price: number | null;
    stop: number | null;
  } | null;
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
    s = s.split(":")[1];
  }
  return s.replace(/\.(NS|BO)$/i, "").replace(/-EQ$/i, "").trim();
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
      .select("close")
      .eq("symbol", symbol)
      .eq("exchange", exchange)
      .eq("interval", "1d")
      .order("ts", { ascending: false })
      .limit(205),
  ]);

  if (!quoteRes.data) return null;

  const q = normalizeQuote(quoteRes.data as Quote);
  const signals = signalsRes.data ?? [];
  const closes = (candlesRes.data ?? []).map((c) => Number(c.close));

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
  const latestSig = signals[0];
  const latestSignal = latestSig
    ? {
        kind: latestSig.signal_type as "buy" | "exit",
        strategy: latestSig.strategy,
        label: signalDisplayName(latestSig.strategy, latestSig.signal_type),
        date: latestSig.generated_at,
        price: Number(latestSig.payload?.close ?? latestSig.payload?.trigger_price ?? 0) || null,
        stop: Number(latestSig.payload?.stop ?? 0) || null,
      }
    : null;

  // Asymmetric Trade Plan
  const latestBuy = signals.find((s) => s.signal_type === "buy");
  const entry = Number(latestBuy?.payload?.close) || q.last_price || 0;
  const stop =
    Number(latestBuy?.payload?.stop) ||
    (sma20 && sma20 < entry ? sma20 : sma50 && sma50 < entry ? sma50 : Number((entry * 0.95).toFixed(2)));

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
    tradePlan,
    sentiment,
    quantPulseUrl: `${appBase}/app/markets/${encodeURIComponent(q.symbol)}`,
  };
}
