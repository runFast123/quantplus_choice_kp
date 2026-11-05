"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseHoldingsCsv } from "@/lib/csv-parser";
import { friendlyDbError, type ActionState } from "@/lib/errors";
import { qty, rupees } from "@/lib/format";
import { istToday, ledgerError } from "@/lib/ledger";
import {
  parseContractNoteWithMyKey,
  portfolioHealthReadWithMyKey,
  type ParsedTrade,
  type PortfolioDiagnosticFocus,
} from "@/server/privileged/ai";
import { can, requireSession } from "@/server/session";

// Every write here goes to public.portfolio_transactions; the database works the holding, its lots and gains out
// from the trades (migration 51, ADR-046). Clients cannot write holdings directly (migration 52).

const SYMBOL = z.string().trim().toUpperCase().regex(/^[A-Z0-9&\-.]{1,20}$/, "That isn't a valid symbol.");
const DAY = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date of the trade.")
  .refine((d) => d <= istToday(), "The date is after today.");
const CHARGES = z.coerce.number().min(0, "Charges can't be negative.").max(1e9).default(0);

const tradeSchema = z.object({
  portfolio_id: z.uuid("Pick a portfolio."),
  kind: z.enum(["buy", "sell"], "Choose buy or sell."),
  symbol: SYMBOL,
  trade_date: DAY,
  quantity: z.coerce.number().positive("Quantity must be more than zero.").max(1e9),
  price: z.coerce.number().positive("Enter the price per share.").max(1e9),
  charges: CHARGES,
  note: z.string().trim().max(200, "Keep the note under 200 characters.").optional(),
  sip: z.boolean(),
});

const tradeEditSchema = z.object({
  id: z.uuid(),
  trade_date: DAY,
  quantity: z.coerce.number().positive("Quantity must be more than zero.").max(1e9),
  price: z.coerce.number().min(0, "The price can't be negative.").max(1e9),
  charges: CHARGES,
});

// Trades reach applyParsedTrades from the client after review, so they're re-validated here.
const tradesSchema = z
  .array(
    z.object({
      symbol: SYMBOL,
      exchange: z.enum(["NSE", "BSE"]),
      action: z.enum(["BUY", "SELL"]),
      quantity: z.number().finite().positive(),
      price: z.number().finite().positive(),
    }),
  )
  .min(1, "No trades provided to apply.")
  .max(250, "Too many trades in one note (250 max).");

const dbError = (m: string | undefined) => ledgerError(m) ?? friendlyDbError(m);

async function ensurePortfolio(): Promise<{ id?: string; error?: string }> {
  const s = await requireSession();
  const { data } = await s.supabase.from("portfolios").select("id").order("created_at").limit(1);
  if (data?.length) return { id: data[0].id };
  const { data: created, error } = await s.supabase.from("portfolios").insert({ name: "My Portfolio" }).select("id").single();
  if (error) return { error: friendlyDbError(error.message) };
  return { id: created.id };
}

type Db = Awaited<ReturnType<typeof requireSession>>["supabase"];

/** A stock that can be bought: in our NSE list, not an index, still trading. */
async function buyableError(db: Db, symbol: string): Promise<string | null> {
  const { data: meta } = await db.from("market_symbols").select("segment, is_active, successors").eq("symbol", symbol).eq("exchange", "NSE").maybeSingle();
  if (!meta) return `${symbol} isn't in our NSE list yet.`;
  if (meta.segment === "index") return `${symbol} is an index — it can't be bought directly. Try an ETF that tracks it.`;
  if (!meta.is_active) {
    const next = (meta.successors ?? []) as string[];
    return `${symbol} no longer trades${next.length ? ` — try ${next.join(" or ")}` : ""}.`;
  }
  return null;
}

/** Record one buy or sell. A sell reports what it made after charges, oldest shares first. */
export async function recordTrade(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const ensured = String(form.get("portfolio_id") || "") ? null : await ensurePortfolio();
  if (ensured?.error) return { error: ensured.error };
  const parsed = tradeSchema.safeParse({
    portfolio_id: String(form.get("portfolio_id") || "") || ensured?.id,
    kind: form.get("kind"),
    symbol: form.get("symbol"),
    trade_date: form.get("trade_date"),
    quantity: form.get("quantity"),
    price: form.get("price"),
    charges: form.get("charges") || 0,
    note: String(form.get("note") ?? "") || undefined,
    sip: form.get("sip") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const t = parsed.data;

  if (t.kind === "buy") {
    const bad = await buyableError(s.supabase, t.symbol);
    if (bad) return { error: bad };
  }
  const { data, error } = await s.supabase
    .from("portfolio_transactions")
    .insert({
      portfolio_id: t.portfolio_id,
      symbol: t.symbol,
      exchange: "NSE",
      kind: t.kind,
      trade_date: t.trade_date,
      quantity: t.quantity,
      price: t.price,
      charges: t.charges,
      note: t.note ?? null,
      sip: t.sip,
      source: "manual",
    })
    .select("id")
    .single();
  if (error || !data) return { error: dbError(error?.message) };
  await s.supabase.rpc("track_event", { p_event_type: t.kind === "buy" ? "trade_buy_recorded" : "trade_sell_recorded" });
  revalidatePath("/app", "layout");

  if (t.kind === "sell") {
    const { data: parts } = await s.supabase.from("portfolio_realized").select("gain").eq("sell_txn_id", data.id);
    const gain = (parts ?? []).reduce((a, p) => a + Number(p.gain), 0);
    return {
      ok: true,
      message: `Sold ${qty(t.quantity)} ${t.symbol}: ${gain >= 0 ? "you made" : "you lost"} ${rupees(Math.abs(gain))} after charges.`,
    };
  }
  return { ok: true, message: `Recorded: bought ${qty(t.quantity)} ${t.symbol} at ${rupees(t.price)}.` };
}

/** Correct a stored trade (date, quantity, price, charges). The stock and side never change: delete and record again. */
export async function updateTrade(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const parsed = tradeEditSchema.safeParse({
    id: form.get("id"),
    trade_date: form.get("trade_date"),
    quantity: form.get("quantity"),
    price: form.get("price"),
    charges: form.get("charges") || 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { id, ...fields } = parsed.data;
  const { data, error } = await s.supabase.from("portfolio_transactions").update(fields).eq("id", id).select("id");
  if (error) return { error: dbError(error.message) };
  if (!data?.length) return { error: "That trade isn't in this workspace." };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Saved. Your holding and gains are worked out again." };
}

export async function deleteTrade(id: string): Promise<ActionState> {
  const s = await requireSession();
  if (!z.uuid().safeParse(id).success) return { error: "We couldn't find that trade." };
  const { data, error } = await s.supabase.from("portfolio_transactions").delete().eq("id", id).select("id");
  if (error) return { error: dbError(error.message) };
  if (!data?.length) return { error: "That trade isn't in this workspace." };
  revalidatePath("/app", "layout");
  return { ok: true };
}

/** Remove a stock from a portfolio: all of its trades go, so its gains go too. */
export async function deleteHolding(id: string): Promise<ActionState> {
  const s = await requireSession();
  if (!z.uuid().safeParse(id).success) return { error: "We couldn't find that holding." };
  const { data: h } = await s.supabase.from("holdings").select("portfolio_id, symbol, exchange").eq("id", id).maybeSingle();
  if (!h) return { error: "That holding isn't in this workspace." };
  const { error } = await s.supabase
    .from("portfolio_transactions")
    .delete()
    .eq("portfolio_id", h.portfolio_id)
    .eq("symbol", h.symbol)
    .eq("exchange", h.exchange);
  if (error) return { error: dbError(error.message) };
  revalidatePath("/app", "layout");
  return { ok: true };
}

/** Undo a split or bonus adjustment (migration 51: the split is left out and the position worked out again). */
export async function undoHoldingAdjustment(id: string): Promise<ActionState> {
  const s = await requireSession();
  if (!z.uuid().safeParse(id).success) return { error: "We couldn't find that change." };
  const { error } = await s.supabase.rpc("undo_holding_adjustment", { p_id: id });
  if (error) {
    if (error.message.includes("SELL_EXCEEDS_HOLDING")) {
      return { error: "A sale you recorded after the split needs its extra shares, so it can't be undone. Edit that sale first." };
    }
    if (error.message.includes("not found")) return { error: "This change was already undone." };
    return { error: dbError(error.message) };
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: "Undone. Your holding is back as you entered it." };
}

export async function createPortfolio(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { error: "Name it something." };
  const { error } = await s.supabase.from("portfolios").insert({ name });
  if (error) return { error: friendlyDbError(error.message) };
  revalidatePath("/app/portfolio");
  return { ok: true, message: `Created “${name}”.` };
}

export type ImportResult = {
  ok?: boolean;
  error?: string;
  imported?: number;
  updated?: number;
  skipped?: number;
  details?: string[];
};

/**
 * A broker's holdings file (what you hold today): each stock not yet in the portfolio becomes an opening balance
 * dated today. A stock already there is left alone and listed (its trades are its history; edit them instead).
 * All rows are saved together or not at all.
 */
export async function importHoldingsCsv(portfolioId: string, csvText: string): Promise<ImportResult> {
  const s = await requireSession();
  let pid = portfolioId;
  if (!pid) {
    const ensured = await ensurePortfolio();
    if (ensured.error || !ensured.id) return { error: ensured.error ?? "Failed to find or create portfolio." };
    pid = ensured.id;
  }

  const parsed = parseHoldingsCsv(csvText);
  if (!parsed.validRows.length) {
    return { error: "No valid holding rows found. Ensure the CSV contains columns for Symbol, Quantity, and Average Price." };
  }

  const batch = parsed.validRows.slice(0, 250);
  const symbols = [...new Set(batch.map((r) => r.cleanSymbol))];
  const [{ data: metas }, { data: held }] = await Promise.all([
    s.supabase.from("market_symbols").select("symbol, segment, is_active").in("symbol", symbols).eq("exchange", "NSE"),
    s.supabase.from("holdings").select("symbol").eq("portfolio_id", pid),
  ]);
  const metaMap = new Map((metas ?? []).map((m) => [m.symbol, m]));
  const heldSet = new Set((held ?? []).map((h) => h.symbol));

  const today = istToday();
  const rows: { portfolio_id: string; symbol: string; exchange: "NSE"; kind: "opening"; trade_date: string; quantity: number; price: number; source: "opening" }[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  const details: string[] = [];
  for (const row of batch) {
    const sym = row.cleanSymbol;
    const meta = metaMap.get(sym);
    const why = !meta
      ? "not found in our NSE list"
      : meta.segment === "index"
        ? "indices cannot be held directly"
        : !meta.is_active
          ? "no longer trades"
          : heldSet.has(sym)
            ? "already in this portfolio (open its history to change it)"
            : seen.has(sym)
              ? "listed twice in the file"
              : null;
    if (why) {
      skipped++;
      details.push(`${sym}: ${why}`);
      continue;
    }
    seen.add(sym);
    rows.push({ portfolio_id: pid, symbol: sym, exchange: "NSE", kind: "opening", trade_date: today, quantity: row.quantity, price: row.avgPrice, source: "opening" });
  }

  if (rows.length) {
    const { error } = await s.supabase.from("portfolio_transactions").insert(rows);
    if (error) return { error: `Nothing was saved: ${dbError(error.message)}` };
  }
  await s.supabase.rpc("track_event", { p_event_type: "holdings_imported" });
  revalidatePath("/app", "layout");
  return { ok: true, imported: rows.length, updated: 0, skipped, details: details.slice(0, 10) };
}

export type PortfolioAiState = {
  text?: string;
  provider?: string;
  model?: string;
  error?: string;
  focus?: PortfolioDiagnosticFocus;
};

export async function askPortfolioAi(
  portfolioId?: string,
  focus: PortfolioDiagnosticFocus = "comprehensive",
): Promise<PortfolioAiState> {
  const s = await requireSession();
  if (!s.activeTenantId) return { error: "No active workspace." };
  if (!can(s, "ai_byok")) {
    return { error: "AI diagnostics are part of Pro and Pro Plus." };
  }
  try {
    const res = await portfolioHealthReadWithMyKey(s.userId, s.activeTenantId, portfolioId, focus);
    return { text: res.text, provider: res.provider, model: res.model, focus };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Couldn't generate portfolio diagnostic.";
    return { error: msg, focus };
  }
}

export type ContractNoteParseState = {
  trades?: ParsedTrade[];
  tradeDate?: string;
  provider?: string;
  model?: string;
  error?: string;
};

export async function parseContractNoteAi(noteText: string): Promise<ContractNoteParseState> {
  const s = await requireSession();
  if (!s.activeTenantId) return { error: "No active workspace." };
  if (!can(s, "ai_byok")) return { error: "Contract note AI parsing requires a Pro plan." };

  try {
    const res = await parseContractNoteWithMyKey(s.userId, s.activeTenantId, noteText);
    return { trades: res.trades, tradeDate: res.tradeDate, provider: res.provider, model: res.model };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to parse contract note.";
    return { error: msg };
  }
}

/**
 * A contract note's trades, dated the note's trade date, saved as one import (all or nothing). Stocks we don't cover
 * are left out and listed; a sale of shares you didn't hold stops the whole note with the reason.
 */
export async function applyParsedTrades(portfolioId: string, trades: ParsedTrade[], tradeDate: string): Promise<ImportResult> {
  const s = await requireSession();
  let pid = portfolioId;
  if (!pid) {
    const ensured = await ensurePortfolio();
    if (ensured.error || !ensured.id) return { error: ensured.error ?? "Failed to find or create portfolio." };
    pid = ensured.id;
  }
  const day = DAY.safeParse(tradeDate);
  if (!day.success) return { error: day.error.issues[0].message };
  const checked = tradesSchema.safeParse(trades);
  if (!checked.success) return { error: checked.error.issues[0].message };

  const symbols = [...new Set(checked.data.map((t) => t.symbol))];
  const { data: metas } = await s.supabase.from("market_symbols").select("symbol, segment, is_active").in("symbol", symbols).eq("exchange", "NSE");
  const metaMap = new Map((metas ?? []).map((m) => [m.symbol, m]));

  let skipped = 0;
  const details: string[] = [];
  const keep = checked.data.filter((t) => {
    const meta = metaMap.get(t.symbol);
    const why = !meta ? "not found in our NSE list" : meta.segment === "index" ? "an index can't be held" : t.action === "BUY" && !meta.is_active ? "no longer trades" : null;
    if (why) {
      skipped++;
      details.push(`${t.symbol}: ${why}`);
    }
    return !why;
  });
  if (!keep.length) return { error: "None of these trades are in stocks we cover.", skipped, details };

  const { data: imp, error: impErr } = await s.supabase
    .from("portfolio_imports")
    .insert({ portfolio_id: pid, broker: "contract_note", trades_added: keep.length, skipped, date_from: day.data, date_to: day.data })
    .select("id")
    .single();
  if (impErr || !imp) return { error: friendlyDbError(impErr?.message) };

  // Coverage, quotes and the lookups above are NSE-only; a BSE row would never price.
  const { error } = await s.supabase.from("portfolio_transactions").insert(
    keep.map((t) => ({
      portfolio_id: pid,
      symbol: t.symbol,
      exchange: "NSE" as const,
      kind: t.action === "BUY" ? ("buy" as const) : ("sell" as const),
      trade_date: day.data,
      quantity: t.quantity,
      price: t.price,
      source: "contract_note" as const,
      import_id: imp.id,
    })),
  );
  if (error) {
    await s.supabase.from("portfolio_imports").delete().eq("id", imp.id);
    return { error: `Nothing was saved: ${dbError(error.message)}`, skipped, details };
  }

  await s.supabase.rpc("track_event", { p_event_type: "contract_note_applied" });
  revalidatePath("/app", "layout");
  return {
    ok: true,
    imported: keep.filter((t) => t.action === "BUY").length,
    updated: keep.filter((t) => t.action === "SELL").length,
    skipped,
    details: details.slice(0, 10),
  };
}
