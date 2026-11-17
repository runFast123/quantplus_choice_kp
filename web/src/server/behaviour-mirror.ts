import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { mirror, RUNUP_SESSIONS, type Close, type Mirror } from "@/lib/behaviour-mirror";
import { istToday } from "@/lib/ledger";
import type { BuyLot, Last, LotSale, Split } from "@/lib/rule-compare";
import { getQuotes } from "./market-data";
import { chunks, pageAll } from "./rule-compare";

const istDay = (ts: string) => new Date(Date.parse(ts) + 330 * 60_000).toISOString().slice(0, 10);
const num = <T extends object>(r: T, keys: (keyof T)[]) => {
  for (const k of keys) if (r[k] != null) (r[k] as unknown) = Number(r[k]);
  return r;
};

/**
 * The Behaviour mirror (lib/behaviour-mirror.ts) for the signed-in user: their purchases and sales (own rows, RLS),
 * splits, stored daily closes of those stocks from a little before their first purchase, and last closes.
 */
export async function loadMirror(db: SupabaseClient): Promise<Mirror & { firstBuy: string | null; stocks: number }> {
  const [lots, sales] = await Promise.all([
    pageAll<BuyLot>((a, b) =>
      db
        .from("portfolio_lots")
        .select("buy_txn_id, portfolio_id, symbol, buy_date, kind, buy_quantity, buy_price, open_quantity, open_price, charges")
        .order("buy_date")
        .order("buy_txn_id")
        .range(a, b),
    ),
    pageAll<LotSale>((a, b) =>
      db.from("portfolio_realized").select("buy_txn_id, sell_txn_id, symbol, sell_date, quantity, sell_price, cost, proceeds, gain").order("id").range(a, b),
    ),
  ]);
  const today = istToday();
  const symbols = [...new Set(lots.map((l) => l.symbol))];
  const firstBuy = lots.find((l) => l.kind === "buy")?.buy_date ?? null;
  const empty = { lots: [], sales: [], splits: [], closes: new Map<string, Close[]>(), last: new Map<string, Last>(), today };
  if (!symbols.length) return { ...mirror(empty), firstBuy, stocks: 0 };

  // Closes from ~2 months before the first purchase (the 20 sessions before it), to today.
  const from = new Date(Date.parse(firstBuy ?? lots[0].buy_date) - (RUNUP_SESSIONS * 2 + 15) * 86_400_000).toISOString().slice(0, 10);
  const [splitParts, candleParts, quotes] = await Promise.all([
    Promise.all(
      chunks(symbols).map((group) =>
        pageAll<Split>((a, b) => db.from("corporate_actions").select("symbol, ex_date, factor").in("symbol", group).order("ex_date").range(a, b)),
      ),
    ),
    Promise.all(
      chunks(symbols, 10).map((group) =>
        pageAll<{ symbol: string; ts: string; close: number }>((a, b) =>
          db
            .from("market_candles")
            .select("symbol, ts, close")
            .in("symbol", group)
            .eq("exchange", "NSE")
            .eq("interval", "1d")
            .gte("ts", from)
            .order("symbol")
            .order("ts")
            .range(a, b),
        ),
      ),
    ),
    getQuotes(db, symbols),
  ]);

  const closes = new Map<string, Close[]>();
  for (const c of candleParts.flat()) {
    const list = closes.get(c.symbol) ?? closes.set(c.symbol, []).get(c.symbol)!;
    list.push({ day: istDay(c.ts), close: Number(c.close) });
  }
  const last = new Map<string, Last>();
  for (const [sym, q] of quotes) if (q.last_price != null && q.as_of) last.set(sym, { price: Number(q.last_price), day: istDay(q.as_of) });

  const m = mirror({
    lots: lots.map((l) => num(l, ["buy_quantity", "buy_price", "open_quantity", "open_price", "charges"])),
    sales: sales.map((s) => num(s, ["quantity", "sell_price", "cost", "proceeds", "gain"])),
    splits: splitParts.flat().map((s) => num(s, ["factor"])),
    closes,
    last,
    today,
  });
  return { ...m, firstBuy, stocks: symbols.length };
}
