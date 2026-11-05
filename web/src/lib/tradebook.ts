/**
 * Broker tradebooks → dated buys and sells (portfolio plan, step C; ADR-047). Pure, so the browser reads the file
 * (it never leaves the device) and the tests run the same code.
 *
 * Brokers change their column names and order, and only Zerodha's tradebook columns are known for certain (date,
 * buy/sell, quantity, price, trade id in every version). So nothing here depends on column positions: the header row
 * is found by name (title rows above it are skipped), each column is matched against the names brokers use, and when a
 * needed column is not recognised the person picks it (the wizard remembers the choice per broker).
 */
import { cleanBrokerSymbol, detectDelimiter, parseNumeric, splitCsvRecords } from "./csv-parser";

export type Broker = "zerodha" | "groww" | "upstox" | "angelone" | "choice" | "other";

export const BROKERS: { key: Broker; name: string; known: boolean; guide: string }[] = [
  {
    key: "zerodha",
    name: "Zerodha",
    known: true,
    guide: "In Console, open Reports, then Tradebook. Choose Equity and a date range (up to 365 days at a time) and download it as CSV or XLSX.",
  },
  {
    key: "groww",
    name: "Groww",
    known: false,
    guide: "Download your stock order or trade history as Excel or CSV from Groww's reports. Choose the history of trades, not the profit and loss or holdings report.",
  },
  {
    key: "upstox",
    name: "Upstox",
    known: false,
    guide: "Download your trade book or trade history as CSV or Excel from Upstox's reports, for the equity segment.",
  },
  {
    key: "angelone",
    name: "Angel One",
    known: false,
    guide: "Download your trade history as CSV or Excel from Angel One's reports (trades and charges). Choose the equity segment.",
  },
  {
    key: "choice",
    name: "Choice",
    known: false,
    guide: "Download your trade book or trade history as CSV or Excel from Choice's reports, for the equity segment.",
  },
  {
    key: "other",
    name: "Another broker",
    known: false,
    guide: "Any file with one row per trade works: the date, the stock, buy or sell, the quantity and the price.",
  },
];

export type Field =
  | "date"
  | "time"
  | "symbol"
  | "name"
  | "isin"
  | "side"
  | "quantity"
  | "price"
  | "value"
  | "tradeId"
  | "exchange"
  | "segment"
  | "status";

export const FIELD_LABEL: Record<Field, string> = {
  date: "Trade date",
  time: "Trade time",
  symbol: "Symbol",
  name: "Stock name",
  isin: "ISIN",
  side: "Buy or sell",
  quantity: "Quantity",
  price: "Price per share",
  value: "Trade value",
  tradeId: "Trade id",
  exchange: "Exchange",
  segment: "Segment",
  status: "Order status",
};

/** The fields a person may be asked to match, in the order the wizard shows them. */
export const MAPPABLE: Field[] = ["date", "symbol", "name", "side", "quantity", "price", "value", "tradeId", "time", "isin", "exchange", "segment", "status"];

const ALIASES: Record<Field, string[]> = {
  date: ["trade date", "date", "execution date and time", "execution date", "trade date time", "trade datetime", "order date", "transaction date", "traded on", "date and time", "date time", "trade dt", "deal date"],
  time: ["order execution time", "trade time", "execution time", "time", "order time", "exchange time"],
  symbol: ["symbol", "tradingsymbol", "trading symbol", "scrip", "scrip symbol", "ticker", "stock symbol", "nse symbol", "security symbol", "instrument symbol", "trd symbol"],
  name: ["stock name", "scrip name", "company", "company name", "security name", "security", "name", "stock", "instrument", "instrument name", "script name", "scrip description"],
  isin: ["isin", "isin code", "isin no"],
  side: ["trade type", "buy sell", "buy/sell", "b/s", "side", "type", "transaction type", "txn type", "action", "buy or sell", "trans type", "bs"],
  quantity: ["quantity", "qty", "traded qty", "trade qty", "shares", "filled qty", "executed qty", "no of shares", "quantity traded", "trade quantity", "traded quantity", "units"],
  price: ["price", "trade price", "rate", "avg price", "average price", "avg. price", "execution price", "traded price", "price per share", "net rate", "market rate", "trade rate", "avg rate", "executed price"],
  value: ["value", "trade value", "amount", "net amount", "gross amount", "turnover", "total value", "traded value"],
  tradeId: ["trade id", "trade no", "trade no.", "trade number", "trade num", "trade ref", "trade ref no", "trade reference"],
  exchange: ["exchange", "exch", "exchange name"],
  segment: ["segment", "product", "instrument type", "product type", "market segment"],
  status: ["status", "order status", "trade status"],
};

/** Header text → the words it is compared by ("Trade_Date (₹)" → "trade date"). */
export const normHeader = (h: string) =>
  h
    .toLowerCase()
    .replace(/[₹]|\(rs\.?\)|\(inr\)|\(in rs\.?\)/g, "")
    .replace(/[_\s]+/g, " ")
    .replace(/[:.]+$/, "")
    .trim();

const ALIAS_INDEX: Map<string, Field> = (() => {
  const m = new Map<string, Field>();
  for (const f of Object.keys(ALIASES) as Field[]) for (const a of ALIASES[f]) if (!m.has(normHeader(a))) m.set(normHeader(a), f);
  return m;
})();

export type Mapping = Partial<Record<Field, number>>;

export function mapHeader(cells: string[]): Mapping {
  const m: Mapping = {};
  cells.forEach((c, i) => {
    const f = ALIAS_INDEX.get(normHeader(c));
    if (f && m[f] == null) m[f] = i;
  });
  return m;
}

/** What is still needed before the rows can be read; empty when the mapping is complete. */
export function missingFields(m: Mapping): Field[] {
  const out: Field[] = [];
  if (m.date == null) out.push("date");
  if (m.symbol == null && m.name == null && m.isin == null) out.push("symbol");
  if (m.side == null) out.push("side");
  if (m.quantity == null) out.push("quantity");
  if (m.price == null && m.value == null) out.push("price");
  return out;
}

/** The header row (title rows above it skipped) and its columns. */
export function detectColumns(rows: string[][]): { headerRow: number; mapping: Mapping } {
  let best = { headerRow: 0, mapping: mapHeader(rows[0] ?? []), score: -1 };
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const mapping = mapHeader(rows[i]);
    const score = Object.keys(mapping).length - missingFields(mapping).length * 3;
    if (score > best.score) best = { headerRow: i, mapping, score };
  }
  return { headerRow: best.headerRow, mapping: best.mapping };
}

/** A CSV (comma, tab or semicolon) as rows of text. */
export function csvRows(text: string): string[][] {
  const t = text.replace(/^﻿/, "").trim();
  if (!t) return [];
  return splitCsvRecords(t, detectDelimiter(t.slice(0, 2000)), true);
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

function validDay(y: number, mo: number, d: number): string | null {
  if (y < 100) y += 2000;
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d || y < 1990) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

function clock(h?: string, mi?: string, s?: string, ap?: string): string | null {
  if (h == null || mi == null) return null;
  let hh = Number(h);
  if (ap) {
    const pm = ap.toLowerCase() === "pm";
    if (hh === 12) hh = pm ? 12 : 0;
    else if (pm) hh += 12;
  }
  return `${pad(hh)}:${pad(Number(mi))}:${pad(Number(s ?? 0))}`;
}

/**
 * A broker date → YYYY-MM-DD (and the time when there is one). Day first, as Indian brokers write it (05/11/2026 is
 * 5 November); ISO dates, "05-Nov-2026" and Excel serial numbers are read too.
 */
export function parseTradeDate(raw: string): { date: string; time: string | null } | null {
  const s = raw.trim();
  if (!s) return null;
  const TIME = String.raw`(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(am|pm)?)?`;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n < 25_000 || n > 80_000) return null;
    const ms = Date.UTC(1899, 11, 30) + Math.round(n * 86_400_000);
    const d = new Date(ms);
    const frac = n % 1;
    return { date: d.toISOString().slice(0, 10), time: frac ? d.toISOString().slice(11, 19) : null };
  }
  let m = new RegExp(String.raw`^(\d{4})-(\d{1,2})-(\d{1,2})` + TIME, "i").exec(s);
  if (m) {
    const date = validDay(Number(m[1]), Number(m[2]), Number(m[3]));
    return date ? { date, time: clock(m[4], m[5], m[6], m[7]) } : null;
  }
  m = new RegExp(String.raw`^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})` + TIME, "i").exec(s);
  if (m) {
    const date = validDay(Number(m[3]), Number(m[2]), Number(m[1]));
    return date ? { date, time: clock(m[4], m[5], m[6], m[7]) } : null;
  }
  m = new RegExp(String.raw`^(\d{1,2})[\s\-\/]([A-Za-z]{3,9})[\s\-\/,]+(\d{2,4})` + TIME, "i").exec(s);
  if (m) {
    const mo = MONTHS[m[2].slice(0, m[2].toLowerCase().startsWith("sept") ? 4 : 3).toLowerCase()];
    const date = mo ? validDay(Number(m[3]), mo, Number(m[1])) : null;
    return date ? { date, time: clock(m[4], m[5], m[6], m[7]) } : null;
  }
  return null;
}

export type Side = "buy" | "sell";
export function parseSide(raw: string): Side | null {
  const s = raw.trim().toLowerCase();
  if (/^(b|buy|bought|purchase|p|buy order)$/.test(s) || /^buy\b/.test(s)) return "buy";
  if (/^(s|sell|sold|sale|sell order)$/.test(s) || /^sell\b/.test(s)) return "sell";
  return null;
}

const NOT_EQUITY = /(^|[^a-z])(fo|f&o|fno|nfo|bfo|fut|futures?|opt|options?|deriv\w*|cds|currency|mcx|ncdex|commodit\w*|com)([^a-z]|$)/i;
const EXECUTED = /complete|executed|traded|filled|success|done|confirmed/i;

/** 53-bit string hash (cyrb53): stable trade references for files without trade ids. */
export function hash53(str: string): string {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export interface TradebookRow {
  /** Row number in the file (1 = the first line), for "row 14: …" messages. */
  line: number;
  file: string;
  date: string;
  time: string | null;
  symbol: string | null;
  name: string | null;
  isin: string | null;
  side: Side;
  quantity: number;
  price: number;
  tradeId: string | null;
  exchange: string | null;
  /**
   * The broker's trade id ("t:NSE:12345"), or a hash of the row ("h:…:0") when the file has none, with a running count
   * for identical rows (two equal fills stay two). The same file imported again gives the same references, so the
   * database skips every row it already has.
   */
  ref: string;
}

export interface SkippedRow {
  line: number;
  file: string;
  reason: string;
}

export type SkipReason = "not_equity" | "not_executed" | "unreadable" | "repeated";

const cell = (r: string[], i: number | undefined) => (i == null ? "" : (r[i] ?? "").trim());

/** Read the trade rows under the header row with a complete mapping. */
export function parseTradebook(rows: string[][], headerRow: number, mapping: Mapping, file = "file"): { trades: TradebookRow[]; skipped: SkippedRow[] } {
  const trades: TradebookRow[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Map<string, number>();
  const refs = new Set<string>();
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    if (!r.some((c) => c && c.trim())) continue;
    const skip = (reason: string) => skipped.push({ line, file, reason });

    const segment = `${cell(r, mapping.segment)} ${cell(r, mapping.exchange)}`;
    if (NOT_EQUITY.test(segment)) {
      skip("futures, options or another non-equity segment");
      continue;
    }
    const status = cell(r, mapping.status);
    if (mapping.status != null && status && !EXECUTED.test(status)) {
      skip(`not executed (${status.toLowerCase()})`);
      continue;
    }
    const d = parseTradeDate(cell(r, mapping.date));
    if (!d) {
      // A totals or footer line has no date: not a trade, and not worth a warning when it has no quantity either.
      if (!cell(r, mapping.quantity)) continue;
      skip(`the date "${cell(r, mapping.date)}" could not be read`);
      continue;
    }
    const time = d.time ?? (mapping.time != null ? (parseTradeDate(`2000-01-01 ${cell(r, mapping.time).replace(/^.*?(\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?).*$/i, "$1")}`)?.time ?? null) : null);
    const side = parseSide(cell(r, mapping.side));
    if (!side) {
      skip(`"${cell(r, mapping.side)}" is not buy or sell`);
      continue;
    }
    const quantity = Math.abs(parseNumeric(cell(r, mapping.quantity).replace(/[()]/g, "")));
    if (!(quantity > 0)) {
      skip("no quantity");
      continue;
    }
    let price = Math.abs(parseNumeric(cell(r, mapping.price).replace(/[()]/g, "")));
    if (!(price > 0) && mapping.value != null) price = Math.abs(parseNumeric(cell(r, mapping.value).replace(/[()]/g, ""))) / quantity;
    if (!(price > 0)) {
      skip("no price");
      continue;
    }
    price = Math.round(price * 10_000) / 10_000;
    const rawSymbol = cell(r, mapping.symbol);
    const symbol = rawSymbol ? cleanBrokerSymbol(rawSymbol) || null : null;
    const name = cell(r, mapping.name) || null;
    const isin = cell(r, mapping.isin).toUpperCase() || null;
    if (!symbol && !name && !isin) {
      skip("no stock named");
      continue;
    }
    const tradeId = cell(r, mapping.tradeId) || null;
    const exchange = cell(r, mapping.exchange).toUpperCase() || null;

    let ref: string;
    if (tradeId) {
      ref = `t:${(exchange ?? "").slice(0, 5)}:${tradeId}`.slice(0, 64);
    } else {
      const key = `${d.date}|${time ?? ""}|${symbol ?? isin ?? name}|${side}|${quantity}|${price}`;
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      ref = `h:${hash53(key)}:${n}`;
    }
    if (refs.has(ref)) {
      skip("the same trade appears twice in the file");
      continue;
    }
    refs.add(ref);
    trades.push({ line, file, date: d.date, time, symbol, name, isin, side, quantity, price, tradeId, exchange, ref });
  }
  return { trades, skipped };
}

/** Trades from several files, each trade once (overlapping date ranges are common). */
export function mergeTrades(lists: TradebookRow[][]): { trades: TradebookRow[]; repeated: number } {
  const seen = new Set<string>();
  const trades: TradebookRow[] = [];
  let repeated = 0;
  for (const t of lists.flat()) {
    if (seen.has(t.ref)) {
      repeated++;
      continue;
    }
    seen.add(t.ref);
    trades.push(t);
  }
  trades.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.time ?? "") < (b.time ?? "") ? -1 : (a.time ?? "") > (b.time ?? "") ? 1 : 0));
  return { trades, repeated };
}

/** Company name → the words it is matched by ("Tata Consultancy Services Ltd." → "tata consultancy services"). */
export const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(limited|ltd|the|co|company|corp|corporation|inc|plc|india|eq|equity|shares?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
