/**
 * The portfolio ledger, client side (ADR-046). The database works holdings, lots and gains out from the trades
 * (migration 51); these pure helpers turn its rows and errors into what a person reads.
 */
import { date, qty } from "./format";

export type TradeKind = "opening" | "buy" | "sell";
export type TradeSource = "manual" | "tradebook" | "contract_note" | "opening";

export interface Trade {
  id: string;
  portfolio_id: string;
  symbol: string;
  exchange: string;
  kind: TradeKind;
  trade_date: string;
  quantity: number;
  price: number;
  charges: number;
  note: string | null;
  sip: boolean;
  source: TradeSource;
  import_id: string | null;
  seq: number;
}

/** One row of public.portfolio_realized: shares of one purchase sold by one sell. */
export interface RealizedPart {
  sell_txn_id: string;
  symbol: string;
  buy_date: string;
  sell_date: string;
  quantity: number;
  buy_price: number;
  sell_price: number;
  cost: number;
  proceeds: number;
  gain: number;
  days_held: number;
}

/** A sell, with every purchase it drew from added up. */
export interface Sale {
  sellTxnId: string;
  symbol: string;
  sellDate: string;
  quantity: number;
  /** What the sold shares cost per share, without charges (oldest shares first). */
  avgBuyPrice: number;
  sellPrice: number;
  cost: number;
  proceeds: number;
  gain: number;
  /** Gain as a share of what the sold shares cost, in %. */
  gainPct: number;
  /** Days the oldest and newest of the sold shares were held. */
  longestDays: number;
  shortestDays: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function groupSales(parts: RealizedPart[]): Sale[] {
  const by = new Map<string, RealizedPart[]>();
  for (const p of parts) {
    const list = by.get(p.sell_txn_id);
    if (list) list.push(p);
    else by.set(p.sell_txn_id, [p]);
  }
  const out: Sale[] = [];
  for (const [id, list] of by) {
    const q = list.reduce((a, p) => a + Number(p.quantity), 0);
    const cost = list.reduce((a, p) => a + Number(p.cost), 0);
    const proceeds = list.reduce((a, p) => a + Number(p.proceeds), 0);
    const buyValue = list.reduce((a, p) => a + Number(p.quantity) * Number(p.buy_price), 0);
    const gain = round2(proceeds - cost);
    out.push({
      sellTxnId: id,
      symbol: list[0].symbol,
      sellDate: list[0].sell_date,
      quantity: q,
      avgBuyPrice: q ? round2(buyValue / q) : 0,
      sellPrice: Number(list[0].sell_price),
      cost: round2(cost),
      proceeds: round2(proceeds),
      gain,
      gainPct: cost ? round2((gain / cost) * 100) : 0,
      longestDays: Math.max(...list.map((p) => p.days_held)),
      shortestDays: Math.min(...list.map((p) => p.days_held)),
    });
  }
  return out.sort((a, b) => (a.sellDate < b.sellDate ? 1 : a.sellDate > b.sellDate ? -1 : 0));
}

/** "held 59 days", or "held 28 to 59 days" when the sale drew from several purchases. */
export function heldFor(s: Pick<Sale, "longestDays" | "shortestDays">): string {
  const n = (d: number) => `${d} day${d === 1 ? "" : "s"}`;
  if (s.longestDays === 0) return "same day";
  return s.shortestDays === s.longestDays ? `held ${n(s.longestDays)}` : `held ${s.shortestDays} to ${n(s.longestDays)}`;
}

/** Today in India, as YYYY-MM-DD (trades are dated in IST; the database refuses later dates). */
export function istToday(now = Date.now()): string {
  return new Date(now + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * The ledger's own errors in plain words, or null for any other message (then use friendlyDbError).
 *   SELL_EXCEEDS_HOLDING: INFY sold 15.0000 on 2026-03-05 but held 10
 *   TRADE_IN_FUTURE: 2026-12-01 is after today
 */
export function ledgerError(message: string | null | undefined): string | null {
  const m = message ?? "";
  const sell = m.match(/SELL_EXCEEDS_HOLDING: (\S+) sold ([\d.]+) on (\d{4}-\d{2}-\d{2}) but held ([\d.]+)/);
  if (sell) {
    const [, sym, sold, day, held] = sell;
    return `That would sell ${qty(Number(sold))} ${sym} on ${date(day)}, but you held ${qty(Number(held))} then. Record the earlier buy first, or check the date.`;
  }
  if (m.includes("SELL_EXCEEDS_HOLDING")) return "That sells more shares than you held at the time.";
  if (m.includes("TRADE_IN_FUTURE")) return "The date is after today.";
  return null;
}

export const KIND_LABEL: Record<TradeKind, string> = { opening: "Opening balance", buy: "Buy", sell: "Sell" };
export const SOURCE_LABEL: Record<TradeSource, string> = {
  manual: "by hand",
  tradebook: "tradebook",
  contract_note: "contract note",
  opening: "as you entered it",
};
