"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { friendlyDbError, type ActionState } from "@/lib/errors";
import { requireSession } from "@/server/session";

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

  const { data: meta } = await s.supabase.from("market_symbols").select("sector").eq("symbol", h.symbol).eq("exchange", h.exchange).maybeSingle();
  if (!meta) return { error: `${h.symbol} isn't in our ${h.exchange} list yet.` };

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
  const id = String(form.get("id") ?? "");
  const quantity = Number(form.get("quantity"));
  const avg = Number(form.get("avg_price"));
  if (!(quantity >= 0) || !(avg >= 0)) return { error: "Enter valid numbers." };
  const { error } = await s.supabase.from("holdings").update({ quantity, avg_price: avg }).eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };
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
