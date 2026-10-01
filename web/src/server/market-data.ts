import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Candle, Holding, Quote } from "@/lib/types";

export async function getQuotes(db: SupabaseClient, symbols?: string[]): Promise<Map<string, Quote>> {
  let q = db.from("market_snapshot").select("*");
  if (symbols) {
    if (!symbols.length) return new Map();
    q = q.in("symbol", symbols);
  }
  const { data } = await q;
  return new Map(((data ?? []) as Quote[]).map((r) => [r.symbol, normalizeQuote(r)]));
}

/** PostgREST returns numeric as string; normalise once at the edge. */
export function normalizeQuote(r: Quote): Quote {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    ...r,
    last_price: n(r.last_price),
    prev_close: n(r.prev_close),
    change: n(r.change),
    change_pct: n(r.change_pct),
    volume: n(r.volume),
    high_52w: n(r.high_52w),
    low_52w: n(r.low_52w),
    rsi: n(r.rsi),
  };
}

/** Daily closes for sparklines, oldest → newest. */
export async function getSparks(db: SupabaseClient, symbols: string[], days = 45): Promise<Map<string, number[]>> {
  if (!symbols.length) return new Map();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data } = await db
    .from("market_candles")
    .select("symbol, ts, close")
    .eq("interval", "1d")
    .in("symbol", symbols)
    .gte("ts", since)
    .order("ts", { ascending: true })
    .limit(symbols.length * days);
  const out = new Map<string, number[]>();
  for (const r of data ?? []) {
    const arr = out.get(r.symbol) ?? [];
    arr.push(Number(r.close));
    out.set(r.symbol, arr);
  }
  return out;
}

export async function getCandles(db: SupabaseClient, symbol: string, exchange = "NSE", days = 730): Promise<Candle[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data } = await db
    .from("market_candles")
    .select("ts, open, high, low, close, volume")
    .eq("symbol", symbol)
    .eq("exchange", exchange)
    .eq("interval", "1d")
    .gte("ts", since)
    .order("ts", { ascending: true })
    .limit(1000);
  return (data ?? []).map((c) => ({
    ts: c.ts,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume),
  }));
}

export interface Position {
  holding: Holding;
  quote: Quote | undefined;
  invested: number;
  value: number;
  dayPnl: number;
  totalPnl: number;
  totalPct: number;
}

export function positions(holdings: Holding[], quotes: Map<string, Quote>): Position[] {
  return holdings.map((h) => {
    const quantity = Number(h.quantity);
    const avg = Number(h.avg_price);
    const q = quotes.get(h.symbol);
    const last = q?.last_price ?? avg;
    const invested = quantity * avg;
    const value = quantity * last;
    return {
      holding: { ...h, quantity, avg_price: avg },
      quote: q,
      invested,
      value,
      dayPnl: quantity * (q?.change ?? 0),
      totalPnl: value - invested,
      totalPct: invested ? ((value - invested) / invested) * 100 : 0,
    };
  });
}

export function summarize(ps: Position[]) {
  const invested = ps.reduce((s, p) => s + p.invested, 0);
  const value = ps.reduce((s, p) => s + p.value, 0);
  const dayPnl = ps.reduce((s, p) => s + p.dayPnl, 0);
  const prevValue = value - dayPnl;
  return {
    invested,
    value,
    dayPnl,
    dayPct: prevValue ? (dayPnl / prevValue) * 100 : 0,
    totalPnl: value - invested,
    totalPct: invested ? ((value - invested) / invested) * 100 : 0,
  };
}
