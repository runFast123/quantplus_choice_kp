"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { friendlyDbError, type ActionState } from "@/lib/errors";
import { istToday, ledgerError } from "@/lib/ledger";
import { normName, type Broker } from "@/lib/tradebook";
import { can, requireSession } from "@/server/session";

// The tradebook import (ADR-047). The browser reads the file and sends its trade rows; here each stock is matched to
// our list (symbol, a broker's spelling of it, or the company name), the database does a dry run (preview_trades), and
// the import is saved in one go (import_trades). Nothing is trusted from the browser: the matching runs again on import.

const MAX_ROWS = 20_000;

const rowSchema = z.object({
  line: z.number().int().nonnegative(),
  file: z.string().max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().max(8).nullable(),
  symbol: z.string().max(40).nullable(),
  name: z.string().max(200).nullable(),
  isin: z.string().max(20).nullable(),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().positive().max(1e9),
  price: z.number().positive().max(1e9),
  ref: z.string().min(3).max(64),
});
export type IncomingRow = z.infer<typeof rowSchema>;

const inputSchema = z.object({
  portfolioId: z.uuid().nullable(),
  broker: z.enum(["zerodha", "groww", "upstox", "angelone", "choice", "other"]),
  rows: z.array(rowSchema).min(1, "No trades found in the file.").max(MAX_ROWS, `Up to ${MAX_ROWS.toLocaleString("en-IN")} trades at a time.`),
  /** Stocks whose opening balance the tradebook replaces. */
  replace: z.array(z.string().max(20)).max(5000).default([]),
  /** Stocks left out of this import. */
  exclude: z.array(z.string().max(20)).max(5000).default([]),
  /** The person's own match for a stock we could not place: file label → NSE symbol. */
  aliases: z.record(z.string().max(200), z.string().max(20)).default({}),
  skipped: z.number().int().nonnegative().default(0),
});
export type TradebookInput = z.input<typeof inputSchema>;

export interface StockReview {
  symbol: string;
  name: string | null;
  /** How the file named it, when that was not our symbol ("Tata Consultancy Services Ltd.", "TCS-EQ"). */
  fileLabels: string[];
  note: string | null;
  rows: number;
  buys: number;
  sells: number;
  from: string;
  to: string;
  ok: boolean;
  problem: string | null;
  added: number;
  duplicates: number;
  before: { quantity: number; avgPrice: number; openingOnly: boolean } | null;
  after: { quantity: number; avgPrice: number } | null;
  realized: number;
  sales: number;
  /** Trades you recorded by hand (or from a contract note) on the same day, side and quantity: maybe the same trade. */
  handMatches: number;
  /** Set when the file's prices are far from the market price on those days (a missing split, or a wrong file). */
  priceWarning: string | null;
  replaced: boolean;
  excluded: boolean;
}

export interface Review {
  portfolioId: string;
  stocks: StockReview[];
  unknown: { label: string; rows: number }[];
  /** Rows left out before the database saw them, by reason (indices, future dates). */
  leftOut: { reason: string; rows: number }[];
  planLimit: number | null;
  error?: string;
}

type Meta = { symbol: string; name: string; segment: string; is_active: boolean; successors: string[] | null };
type Db = Awaited<ReturnType<typeof requireSession>>["supabase"];

async function ensurePortfolio(db: Db, id: string | null): Promise<string | { error: string }> {
  if (id) return id;
  const { data } = await db.from("portfolios").select("id").order("created_at").limit(1);
  if (data?.length) return data[0].id as string;
  const { data: created, error } = await db.from("portfolios").insert({ name: "My Portfolio" }).select("id").single();
  return error || !created ? { error: friendlyDbError(error?.message) } : (created.id as string);
}

/** Our stock list, for the symbols in the file and (only when needed) every name. */
async function loadMeta(db: Db, symbols: string[], withNames: boolean): Promise<{ bySymbol: Map<string, Meta>; byName: Map<string, string | null> }> {
  const bySymbol = new Map<string, Meta>();
  const byName = new Map<string, string | null>();
  const cols = "symbol, name, segment, is_active, successors";
  for (let i = 0; i < symbols.length; i += 500) {
    const { data } = await db.from("market_symbols").select(cols).eq("exchange", "NSE").in("symbol", symbols.slice(i, i + 500));
    for (const m of (data ?? []) as Meta[]) bySymbol.set(m.symbol, m);
  }
  if (withNames) {
    // PostgREST returns at most 1,000 rows at a time (AGENTS.md §6): page through the list.
    for (let from = 0; ; from += 1000) {
      const { data } = await db
        .from("market_symbols")
        .select(cols)
        .eq("exchange", "NSE")
        .eq("is_active", true)
        .neq("segment", "index")
        .order("symbol")
        .range(from, from + 999);
      const page = (data ?? []) as Meta[];
      for (const m of page) {
        bySymbol.set(m.symbol, m);
        const k = normName(m.name ?? "");
        if (k) byName.set(k, byName.has(k) && byName.get(k) !== m.symbol ? null : m.symbol); // two companies, one name: ambiguous
      }
      if (page.length < 1000) break;
    }
  }
  return { bySymbol, byName };
}

type Resolved = { symbol: string; label: string; note: string | null } | { unknown: string } | { skip: string };

function resolve(r: IncomingRow, meta: Awaited<ReturnType<typeof loadMeta>>, aliases: Record<string, string>): Resolved {
  const label = r.symbol ?? r.name ?? r.isin ?? "";
  const alias = aliases[label]?.trim().toUpperCase();
  const tryFor = (sym: string | null | undefined, via: string | null): Resolved | null => {
    const m = sym ? meta.bySymbol.get(sym) : undefined;
    if (!m) return null;
    if (m.segment === "index") return { skip: "an index, which can't be held" };
    if (!m.is_active && (m.successors?.length ?? 0) === 1) return { symbol: m.successors![0], label, note: `${m.symbol} now trades as ${m.successors![0]}` };
    return { symbol: m.symbol, label, note: via };
  };
  return (
    tryFor(alias, alias ? `matched by you as ${alias}` : null) ??
    tryFor(r.symbol, null) ??
    tryFor(r.name ? meta.byName.get(normName(r.name)) : null, r.name ? `from the name "${r.name}"` : null) ?? { unknown: label }
  );
}

/** Match, filter and group the rows; shared by the preview and the import (which must not trust the browser). */
async function prepare(db: Db, input: z.output<typeof inputSchema>) {
  const symbols = [
    ...new Set(
      input.rows
        .flatMap((r) => [r.symbol, input.aliases[r.symbol ?? r.name ?? r.isin ?? ""]])
        .filter((x): x is string => !!x)
        .map((x) => x.toUpperCase()),
    ),
  ];
  const firstPass = await loadMeta(db, symbols, false);
  const needNames = input.rows.some((r) => !(r.symbol && firstPass.bySymbol.has(r.symbol)) && r.name);
  const meta = needNames ? await loadMeta(db, symbols, true) : firstPass;

  const today = istToday();
  const leftOut = new Map<string, number>();
  const unknown = new Map<string, number>();
  const labels = new Map<string, Set<string>>();
  const notes = new Map<string, string>();
  const kept: { row: IncomingRow; symbol: string }[] = [];
  for (const r of input.rows) {
    if (r.date > today) {
      leftOut.set("dated after today", (leftOut.get("dated after today") ?? 0) + 1);
      continue;
    }
    const res = resolve(r, meta, input.aliases);
    if ("skip" in res) {
      leftOut.set(res.skip, (leftOut.get(res.skip) ?? 0) + 1);
    } else if ("unknown" in res) {
      unknown.set(res.unknown, (unknown.get(res.unknown) ?? 0) + 1);
    } else {
      kept.push({ row: r, symbol: res.symbol });
      if (res.label !== res.symbol) {
        const set = labels.get(res.symbol) ?? new Set<string>();
        set.add(res.label);
        labels.set(res.symbol, set);
      }
      if (res.note) notes.set(res.symbol, res.note);
    }
  }
  return { kept, leftOut, unknown, labels, notes, names: new Map([...meta.bySymbol].map(([k, m]) => [k, m.name])) };
}

const toRpcRows = (kept: { row: IncomingRow; symbol: string }[]) =>
  kept.map(({ row, symbol }) => ({ symbol, kind: row.side, trade_date: row.date, quantity: row.quantity, price: row.price, broker_ref: row.ref }));

interface PreviewItem {
  symbol: string;
  ok: boolean;
  rows: number;
  added?: number;
  duplicates?: number;
  error?: string;
  before: { quantity: number; avg_price: number; opening_only: boolean } | null;
  after?: { quantity: number; avg_price: number } | null;
  realized?: number;
  sales?: number;
}

function problemText(e: string | undefined): string {
  const m = e ?? "";
  if (m.includes("PLAN_LIMIT_REACHED")) return "Your plan holds this many stocks at a time. Leave out a stock you no longer want to track, or upgrade.";
  if (m.includes("SELL_EXCEEDS_HOLDING")) {
    return `${ledgerError(m) ?? ""} The file probably starts after you first bought it: add an earlier tradebook, or record an opening balance for it first.`.trim();
  }
  return ledgerError(m) ?? friendlyDbError(m);
}

/**
 * The file's prices against the market close on the same days, after the splits we know of: the median of
 * price ÷ (stored close × the split factors after that day), per stock. Yahoo sometimes records part of an event (Bajaj
 * Finance's June 2025 bonus with a split showed as ×2, not ×10), and a wrong file looks the same; either way the
 * holding would be wrong, so the review says so. Stored closes are split-adjusted; a stock without stored closes for
 * those days is not checked.
 */
async function priceRatios(db: Db, kept: { row: IncomingRow; symbol: string }[]): Promise<Map<string, number>> {
  const bySym = new Map<string, IncomingRow[]>();
  for (const k of kept) bySym.set(k.symbol, [...(bySym.get(k.symbol) ?? []), k.row]);
  const syms = [...bySym.keys()].sort((a, b) => bySym.get(b)!.length - bySym.get(a)!.length).slice(0, 150);
  const out = new Map<string, number>();
  if (!syms.length) return out;
  const { data: ca } = await db.from("corporate_actions").select("symbol, ex_date, factor").eq("exchange", "NSE").in("symbol", syms);
  for (let i = 0; i < syms.length; i += 10) {
    await Promise.all(
      syms.slice(i, i + 10).map(async (sym) => {
        const rows = bySym.get(sym)!;
        const days = rows.map((r) => r.date).sort();
        const { data } = await db
          .from("market_candles")
          .select("ts, close")
          .eq("symbol", sym)
          .eq("exchange", "NSE")
          .eq("interval", "1d")
          .gte("ts", `${days[0]}T00:00:00Z`)
          .lte("ts", `${days[days.length - 1]}T23:59:59Z`)
          .limit(5000);
        const close = new Map((data ?? []).map((c) => [String(c.ts).slice(0, 10), Number(c.close)]));
        const splits = (ca ?? []).filter((c) => c.symbol === sym);
        const ratios = rows
          .filter((r) => (close.get(r.date) ?? 0) > 0)
          .map((r) => r.price / (close.get(r.date)! * splits.filter((c) => c.ex_date > r.date).reduce((a, c) => a * Number(c.factor), 1)))
          .sort((a, b) => a - b);
        if (ratios.length) out.set(sym, ratios[Math.floor(ratios.length / 2)]);
      }),
    );
  }
  return out;
}

function priceWarning(ratio: number | undefined): string | null {
  if (ratio == null || (ratio >= 0.7 && ratio <= 1.43)) return null;
  const times = ratio > 1 ? `about ${ratio.toFixed(1)} times the` : `about ${(1 / ratio).toFixed(1)} times below the`;
  return `The prices in the file are ${times} market price on those days, after the splits we know of. A split or bonus may be missing from our records, or the file may be wrong, so the holding could be off. Check it after importing, or leave it out.`;
}

/** Check a tradebook without saving anything: each stock's result, or what stops it. */
export async function previewTradebook(raw: TradebookInput): Promise<Review> {
  const s = await requireSession();
  const empty: Review = { portfolioId: "", stocks: [], unknown: [], leftOut: [], planLimit: null };
  if (!can(s, "portfolio")) return { ...empty, error: "Importing trades is part of portfolio tracking (Pro)." };
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ...empty, error: parsed.error.issues[0].message };
  const input = parsed.data;
  const pid = await ensurePortfolio(s.supabase, input.portfolioId);
  if (typeof pid !== "string") return { ...empty, error: pid.error };

  const p = await prepare(s.supabase, input);
  const included = p.kept.filter((k) => !input.exclude.includes(k.symbol));
  let items: PreviewItem[] = [];
  if (included.length) {
    const { data, error } = await s.supabase.rpc("preview_trades", { p_portfolio: pid, p_rows: toRpcRows(included), p_replace: input.replace });
    if (error) return { ...empty, portfolioId: pid, error: friendlyDbError(error.message) };
    items = (data ?? []) as PreviewItem[];
  }
  const bySym = new Map(items.map((i) => [i.symbol, i]));

  const ratios = await priceRatios(s.supabase, p.kept);
  // Same day, side and quantity as a trade you entered yourself: possibly the same trade twice.
  const allSymbols = [...new Set(p.kept.map((k) => k.symbol))];
  const { data: hand } = allSymbols.length
    ? await s.supabase
        .from("portfolio_transactions")
        .select("symbol, kind, trade_date, quantity")
        .eq("portfolio_id", pid)
        .in("source", ["manual", "contract_note"])
        .in("symbol", allSymbols)
    : { data: [] };
  const handKeys = new Set((hand ?? []).map((h) => `${h.symbol}|${h.kind}|${h.trade_date}|${Number(h.quantity)}`));

  const stocks: StockReview[] = allSymbols.map((sym) => {
    const rows = p.kept.filter((k) => k.symbol === sym);
    const it = bySym.get(sym);
    const excluded = input.exclude.includes(sym);
    return {
      symbol: sym,
      name: p.names.get(sym) ?? null,
      fileLabels: [...(p.labels.get(sym) ?? [])].slice(0, 3),
      note: p.notes.get(sym) ?? null,
      rows: rows.length,
      buys: rows.filter((k) => k.row.side === "buy").length,
      sells: rows.filter((k) => k.row.side === "sell").length,
      from: rows.reduce((a, k) => (k.row.date < a ? k.row.date : a), rows[0].row.date),
      to: rows.reduce((a, k) => (k.row.date > a ? k.row.date : a), rows[0].row.date),
      ok: excluded ? true : !!it?.ok,
      problem: excluded || !it || it.ok ? null : problemText(it.error),
      added: it?.added ?? 0,
      duplicates: it?.duplicates ?? 0,
      before: it?.before ? { quantity: Number(it.before.quantity), avgPrice: Number(it.before.avg_price), openingOnly: !!it.before.opening_only } : null,
      after: it?.after ? { quantity: Number(it.after.quantity), avgPrice: Number(it.after.avg_price) } : null,
      realized: Number(it?.realized ?? 0),
      sales: Number(it?.sales ?? 0),
      handMatches: rows.filter((k) => handKeys.has(`${sym}|${k.row.side}|${k.row.date}|${k.row.quantity}`)).length,
      priceWarning: priceWarning(ratios.get(sym)),
      replaced: input.replace.includes(sym),
      excluded,
    };
  });
  return {
    portfolioId: pid,
    stocks,
    unknown: [...p.unknown].map(([label, rows]) => ({ label, rows })).sort((a, b) => b.rows - a.rows),
    leftOut: [...p.leftOut].map(([reason, rows]) => ({ reason, rows })),
    planLimit: s.entitlements?.max_portfolio_symbols ?? null,
  };
}

export type ImportOutcome = { ok?: boolean; error?: string; importId?: string | null; added?: number; duplicates?: number; replaced?: number };

/** Save the tradebook as one import (all or nothing). */
export async function importTradebook(raw: TradebookInput): Promise<ImportOutcome> {
  const s = await requireSession();
  if (!can(s, "portfolio")) return { error: "Importing trades is part of portfolio tracking (Pro)." };
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const input = parsed.data;
  const pid = await ensurePortfolio(s.supabase, input.portfolioId);
  if (typeof pid !== "string") return { error: pid.error };

  const p = await prepare(s.supabase, input);
  const included = p.kept.filter((k) => !input.exclude.includes(k.symbol));
  if (!included.length) return { error: "No trades are left to import." };
  const leftOut = input.skipped + [...p.leftOut.values(), ...p.unknown.values()].reduce((a, n) => a + n, 0) + (p.kept.length - included.length);
  const broker: Broker = input.broker;
  const { data, error } = await s.supabase.rpc("import_trades", {
    p_portfolio: pid,
    p_broker: broker,
    p_rows: toRpcRows(included),
    p_replace: input.replace,
    p_skipped: leftOut,
  });
  if (error) return { error: `Nothing was saved. ${problemText(error.message)}` };
  const r = data as { import_id: string | null; added: number; duplicates: number; replaced: number };
  await s.supabase.rpc("track_event", { p_event_type: "tradebook_imported" });
  revalidatePath("/app", "layout");
  return { ok: true, importId: r.import_id, added: r.added, duplicates: r.duplicates, replaced: r.replaced };
}

/** Undo a whole import: its trades go and any opening balance it replaced comes back. */
export async function undoImport(id: string): Promise<ActionState> {
  const s = await requireSession();
  if (!z.uuid().safeParse(id).success) return { error: "We couldn't find that import." };
  const { error } = await s.supabase.rpc("undo_import", { p_id: id });
  if (error) {
    if (error.message.includes("SELL_EXCEEDS_HOLDING")) return { error: "A sale you recorded later needs shares from this import, so it can't be undone. Delete that sale first." };
    if (error.message.includes("not found")) return { error: "This import was already undone." };
    return { error: friendlyDbError(error.message) };
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: "Import undone." };
}
