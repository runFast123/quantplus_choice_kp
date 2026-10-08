"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseHoldingsCsv } from "@/lib/csv-parser";
import { friendlyDbError, type ActionState } from "@/lib/errors";
import { portfolioHealthReadWithMyKey } from "@/server/privileged/ai";
import { can, requireSession } from "@/server/session";

const holdingSchema = z.object({
  portfolio_id: z.uuid("Pick a portfolio."),
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9&\-.]{1,20}$/, "That isn't a valid symbol."),
  exchange: z.enum(["NSE", "BSE"]).default("NSE"),
  quantity: z.coerce.number().positive("Quantity must be more than zero."),
  avg_price: z.coerce.number().positive("Enter the price you paid."),
});

async function ensurePortfolio(): Promise<{ id?: string; error?: string }> {
  const s = await requireSession();
  const { data } = await s.supabase.from("portfolios").select("id").order("created_at").limit(1);
  if (data?.length) return { id: data[0].id };
  const { data: created, error } = await s.supabase.from("portfolios").insert({ name: "My Portfolio" }).select("id").single();
  if (error) return { error: friendlyDbError(error.message) };
  return { id: created.id };
}

/** Buying more of a symbol you hold merges into one row at the weighted average. */
export async function addHolding(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const portfolioId = String(form.get("portfolio_id") || "") || (await ensurePortfolio()).id;
  const parsed = holdingSchema.safeParse({
    portfolio_id: portfolioId,
    symbol: form.get("symbol"),
    exchange: form.get("exchange") || "NSE",
    quantity: form.get("quantity"),
    avg_price: form.get("avg_price"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const h = parsed.data;

  const { data: meta } = await s.supabase
    .from("market_symbols")
    .select("sector, segment, is_active, successors")
    .eq("symbol", h.symbol)
    .eq("exchange", h.exchange)
    .maybeSingle();
  if (!meta) return { error: `${h.symbol} isn't in our ${h.exchange} list yet.` };
  if (meta.segment === "index") return { error: `${h.symbol} is an index — it can't be bought directly. Try an ETF that tracks it.` };
  if (!meta.is_active) {
    const next = (meta.successors ?? []) as string[];
    return { error: `${h.symbol} no longer trades${next.length ? ` — try ${next.join(" or ")}` : ""}.` };
  }

  const { data: existing } = await s.supabase
    .from("holdings")
    .select("id, quantity, avg_price")
    .eq("portfolio_id", h.portfolio_id)
    .eq("symbol", h.symbol)
    .eq("exchange", h.exchange)
    .maybeSingle();

  if (existing) {
    const q0 = Number(existing.quantity);
    const qty = q0 + h.quantity;
    const avg = (q0 * Number(existing.avg_price) + h.quantity * h.avg_price) / qty;
    const { error } = await s.supabase.from("holdings").update({ quantity: qty, avg_price: Number(avg.toFixed(4)) }).eq("id", existing.id);
    if (error) return { error: friendlyDbError(error.message) };
  } else {
    const { error } = await s.supabase.from("holdings").insert({ ...h, sector: meta.sector, source: "manual" });
    if (error) return { error: friendlyDbError(error.message) };
  }
  await s.supabase.rpc("track_event", { p_event_type: "holding_added" });
  revalidatePath("/app", "layout");
  return { ok: true, message: existing ? `Added to your ${h.symbol} position.` : `${h.symbol} added.` };
}

export async function updateHolding(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const parsed = z
    .object({
      id: z.uuid(),
      quantity: z.coerce.number().positive("Quantity must be more than zero — remove the holding instead."),
      avg_price: z.coerce.number().positive("Enter the price you paid."),
    })
    .safeParse({ id: form.get("id"), quantity: form.get("quantity") || undefined, avg_price: form.get("avg_price") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { data: updated, error } = await s.supabase
    .from("holdings")
    .update({ quantity: parsed.data.quantity, avg_price: parsed.data.avg_price })
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return { error: friendlyDbError(error.message) };
  if (!updated?.length) return { error: "That holding isn't in this workspace." };
  revalidatePath("/app", "layout");
  return { ok: true };
}

export async function deleteHolding(id: string) {
  const s = await requireSession();
  await s.supabase.from("holdings").delete().eq("id", id);
  revalidatePath("/app", "layout");
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

export async function importHoldingsCsv(
  portfolioId: string,
  csvText: string,
): Promise<ImportResult> {
  const s = await requireSession();
  let pid = portfolioId;
  if (!pid) {
    const ensured = await ensurePortfolio();
    if (ensured.error || !ensured.id) return { error: ensured.error ?? "Failed to find or create portfolio." };
    pid = ensured.id;
  }

  const parsed = parseHoldingsCsv(csvText);
  if (!parsed.validRows.length) {
    return {
      error:
        "No valid holding rows found. Ensure the CSV contains columns for Symbol, Quantity, and Average Price.",
    };
  }

  const batch = parsed.validRows.slice(0, 250);
  const symbols = [...new Set(batch.map((r) => r.cleanSymbol))];

  const { data: metas } = await s.supabase
    .from("market_symbols")
    .select("symbol, exchange, sector, segment, is_active")
    .in("symbol", symbols)
    .eq("exchange", "NSE");

  const metaMap = new Map((metas ?? []).map((m) => [m.symbol, m]));

  const { data: existingHoldings } = await s.supabase
    .from("holdings")
    .select("id, symbol, exchange, quantity, avg_price")
    .eq("portfolio_id", pid);

  const existingMap = new Map((existingHoldings ?? []).map((h) => [h.symbol, h]));

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const details: string[] = [];

  for (const row of batch) {
    const meta = metaMap.get(row.cleanSymbol);
    if (!meta) {
      skipped++;
      details.push(`${row.cleanSymbol}: not found in market registry`);
      continue;
    }
    if (meta.segment === "index") {
      skipped++;
      details.push(`${row.cleanSymbol}: indices cannot be held directly`);
      continue;
    }
    if (!meta.is_active) {
      skipped++;
      details.push(`${row.cleanSymbol}: symbol no longer trades`);
      continue;
    }

    const existing = existingMap.get(row.cleanSymbol);
    if (existing) {
      const q0 = Number(existing.quantity);
      const qty = q0 + row.quantity;
      const avg = (q0 * Number(existing.avg_price) + row.quantity * row.avgPrice) / qty;
      const { error } = await s.supabase
        .from("holdings")
        .update({ quantity: qty, avg_price: Number(avg.toFixed(4)) })
        .eq("id", existing.id);
      if (error) {
        skipped++;
        details.push(`${row.cleanSymbol}: ${friendlyDbError(error.message)}`);
      } else {
        updated++;
        existing.quantity = qty;
        existing.avg_price = avg;
      }
    } else {
      const { error } = await s.supabase.from("holdings").insert({
        portfolio_id: pid,
        symbol: row.cleanSymbol,
        exchange: "NSE",
        quantity: row.quantity,
        avg_price: row.avgPrice,
        sector: meta.sector,
        source: "import",
      });
      if (error) {
        skipped++;
        details.push(`${row.cleanSymbol}: ${friendlyDbError(error.message)}`);
      } else {
        imported++;
      }
    }
  }

  await s.supabase.rpc("track_event", { p_event_type: "holdings_imported" });
  revalidatePath("/app", "layout");
  return {
    ok: true,
    imported,
    updated,
    skipped,
    details: details.slice(0, 10),
  };
}

export type PortfolioAiState = {
  text?: string;
  provider?: string;
  model?: string;
  error?: string;
};

export async function askPortfolioAi(portfolioId?: string): Promise<PortfolioAiState> {
  const s = await requireSession();
  if (!s.activeTenantId) return { error: "No active workspace." };
  if (!can(s, "ai_byok")) {
    return { error: "AI diagnostics are part of Pro and Pro Plus." };
  }
  try {
    const res = await portfolioHealthReadWithMyKey(s.userId, s.activeTenantId, portfolioId);
    return { text: res.text, provider: res.provider, model: res.model };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Couldn't generate portfolio diagnostic.";
    return { error: msg };
  }
}

