import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { throwIfFailed } from "@/lib/errors";
import { compareTrades, type BuyLot, type Comparison, type Last, type LotSale, type RuleTrade, type Split } from "@/lib/rule-compare";
import { RULE_KEYS } from "@/lib/rules";
import { getQuotes } from "./market-data";

const PAGE = 1000;

/** Every row of a query, 1,000 at a time (PostgREST returns at most 1,000). A failed page throws (error screen). */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await page(from, from + PAGE - 1);
    throwIfFailed(res);
    const rows = (res.data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const chunks = <T,>(xs: T[], n = 80) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const istDay = (ts: string) => new Date(Date.parse(ts) + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Your trades next to the rules' trades: loads your purchases and sales (own rows, RLS), the live rules' trades on those
 * stocks (public.rule_trades), splits, trading days and last closes, and matches them (lib/rule-compare.ts).
 * `symbol` limits it to one stock (the stock history page).
 */
export async function loadComparison(db: SupabaseClient, opts: { symbol?: string; portfolioId?: string | null } = {}): Promise<Comparison> {
  const lotPage = (a: number, b: number) => {
    let q = db.from("portfolio_lots").select("buy_txn_id, portfolio_id, symbol, buy_date, kind, buy_quantity, buy_price, open_quantity, open_price, charges");
    if (opts.symbol) q = q.eq("symbol", opts.symbol);
    if (opts.portfolioId) q = q.eq("portfolio_id", opts.portfolioId);
    return q.order("buy_date").order("buy_txn_id").range(a, b);
  };
  const salePage = (a: number, b: number) => {
    let q = db.from("portfolio_realized").select("buy_txn_id, sell_txn_id, symbol, sell_date, quantity, sell_price, cost, proceeds, gain");
    if (opts.symbol) q = q.eq("symbol", opts.symbol);
    if (opts.portfolioId) q = q.eq("portfolio_id", opts.portfolioId);
    return q.order("id").range(a, b);
  };
  const [lots, sales, firstRes] = await Promise.all([
    all<BuyLot>(lotPage),
    all<LotSale>(salePage),
    db.from("signal_outcomes").select("entry_day").in("strategy", [...RULE_KEYS]).eq("side", "long").order("entry_day").limit(1),
  ]);
  throwIfFailed(firstRes);
  const recordsFrom = (firstRes.data?.[0]?.entry_day as string | undefined) ?? null;

  const symbols = [...new Set(lots.map((l) => l.symbol))];
  if (!symbols.length) return compareTrades({ lots, sales, ruleTrades: [], splits: [], sessions: [], last: new Map(), recordsFrom });

  const sessionsFrom = recordsFrom
    ? new Date(Date.parse(recordsFrom) - 400 * 86_400_000).toISOString().slice(0, 10)
    : lots[0].buy_date;
  const [tradeParts, splitParts, candles, quotes] = await Promise.all([
    Promise.all(
      chunks(symbols).map((group) =>
        all<RuleTrade>((a, b) =>
          db
            .from("rule_trades")
            .select("strategy, symbol, entry_day, entry_price, exit_day, exit_price, exit_entry_fill, result, exit_label")
            .in("symbol", group)
            .eq("exchange", "NSE")
            .order("entry_day")
            .order("signal_id")
            .range(a, b),
        ),
      ),
    ),
    Promise.all(
      chunks(symbols).map((group) =>
        all<Split>((a, b) => db.from("corporate_actions").select("symbol, ex_date, factor").in("symbol", group).order("ex_date").range(a, b)),
      ),
    ),
    all<{ ts: string }>((a, b) =>
      db
        .from("market_candles")
        .select("ts")
        .eq("symbol", "NIFTY")
        .eq("exchange", "NSE")
        .eq("interval", "1d")
        .gte("ts", sessionsFrom)
        .order("ts")
        .range(a, b),
    ),
    getQuotes(db, symbols),
  ]);

  const num = <T extends object>(r: T, keys: (keyof T)[]) => {
    for (const k of keys) if (r[k] != null) (r[k] as unknown) = Number(r[k]);
    return r;
  };
  const last = new Map<string, Last>();
  for (const [sym, q] of quotes) if (q.last_price != null && q.as_of) last.set(sym, { price: Number(q.last_price), day: istDay(q.as_of) });

  return compareTrades({
    lots: lots.map((l) => num(l, ["buy_quantity", "buy_price", "open_quantity", "open_price", "charges"])),
    sales: sales.map((s) => num(s, ["quantity", "sell_price", "cost", "proceeds", "gain"])),
    ruleTrades: tradeParts.flat().map((t) => num(t, ["entry_price", "exit_price", "exit_entry_fill"])),
    splits: splitParts.flat().map((s) => num(s, ["factor"])),
    sessions: candles.map((c) => istDay(c.ts)),
    last,
    recordsFrom,
  });
}
