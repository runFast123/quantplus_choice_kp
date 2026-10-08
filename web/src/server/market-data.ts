import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Candle, Holding, Quote, RetiredSymbol } from "@/lib/types";

export async function getQuotes(db: SupabaseClient, symbols?: string[]): Promise<Map<string, Quote>> {
  let q = db.from("market_snapshot").select("*");
  if (symbols) {
    if (!symbols.length) return new Map();
    q = q.in("symbol", symbols);
  }
  const { data } = await q;
  return new Map(((data ?? []) as Quote[]).map((r) => [r.symbol, normalizeQuote(r)]));
}

/** The header tape: NSE indices, then the 30 largest companies. */
export async function getTape(db: SupabaseClient): Promise<Quote[]> {
  const [idx, big] = await Promise.all([
    db.from("market_snapshot").select("*").eq("segment", "index").not("last_price", "is", null).order("symbol"),
    db.from("market_snapshot").select("*").eq("segment", "equity").not("mcap_rank", "is", null).order("mcap_rank").limit(30),
  ]);
  const order = ["NIFTY", "BANKNIFTY", "NIFTYIT", "NIFTYMIDCAP100", "NIFTYSMALLCAP100", "INDIAVIX"];
  const indices = ((idx.data ?? []) as Quote[]).filter((q) => order.includes(q.symbol)).sort((a, b) => order.indexOf(a.symbol) - order.indexOf(b.symbol));
  return [...indices, ...((big.data ?? []) as Quote[])].map(normalizeQuote);
}

/**
 * Market breadth across every listed NSE stock (counted in the database), and
 * leaders / laggards among the 500 largest — SME names hitting their price band
 * would otherwise fill the list every day.
 */
export async function getBreadth(db: SupabaseClient) {
  const base = () => db.from("market_snapshot").select("symbol", { count: "exact", head: true }).eq("segment", "equity");
  const movers = (asc: boolean) =>
    db.from("market_snapshot").select("*").eq("segment", "equity").lte("mcap_rank", 500).not("change_pct", "is", null)
      .order("change_pct", { ascending: asc }).limit(4);
  const [up, down, total, leaders, laggards] = await Promise.all([
    base().gt("change_pct", 0), base().lt("change_pct", 0), base().not("change_pct", "is", null), movers(false), movers(true),
  ]);
  const lead = ((leaders.data ?? []) as Quote[]).map(normalizeQuote);
  return {
    up: up.count ?? 0,
    down: down.count ?? 0,
    total: total.count ?? 0,
    leaders: lead,
    laggards: ((laggards.data ?? []) as Quote[]).map(normalizeQuote),
    asOf: lead[0]?.as_of ?? null,
  };
}

/** Symbols among `symbols` that no longer trade, with the note explaining why. */
export async function getRetired(db: SupabaseClient, symbols: string[]): Promise<Map<string, RetiredSymbol>> {
  if (!symbols.length) return new Map();
  const { data } = await db.from("market_symbols").select("symbol, name, status_note, successors").in("symbol", symbols).eq("is_active", false);
  return new Map(((data ?? []) as RetiredSymbol[]).map((r) => [r.symbol, r]));
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
    mcap_rank: n(r.mcap_rank),
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
