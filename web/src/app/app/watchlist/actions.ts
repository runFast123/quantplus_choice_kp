"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { friendlyDbError, type ActionState } from "@/lib/errors";
import { requireSession } from "@/server/session";

const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9&\-.]{1,20}$/, "That isn't a valid NSE/BSE symbol.");

async function defaultWatchlistId(): Promise<{ id?: string; error?: string }> {
  const s = await requireSession();
  const { data } = await s.supabase.from("watchlists").select("id").order("created_at").limit(1);
  if (data?.length) return { id: data[0].id };
  const { data: created, error } = await s.supabase.from("watchlists").insert({ name: "Market Radar" }).select("id").single();
  if (error) return { error: friendlyDbError(error.message) };
  return { id: created.id };
}

export async function addToRadar(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const parsed = symbolSchema.safeParse(form.get("symbol"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const exchange = form.get("exchange") === "BSE" ? "BSE" : "NSE";

  const { data: known } = await s.supabase
    .from("market_symbols")
    .select("symbol, is_active, successors")
    .eq("symbol", parsed.data)
    .eq("exchange", exchange)
    .maybeSingle();
  if (!known) return { error: `${parsed.data} isn't in our ${exchange} list yet.` };
  if (!known.is_active) {
    const next = (known.successors ?? []) as string[];
    return { error: `${parsed.data} no longer trades${next.length ? ` — try ${next.join(" or ")}` : ""}.` };
  }

  const listId = String(form.get("watchlist_id") ?? "") || (await defaultWatchlistId()).id;
  if (!listId) return { error: "Couldn't create your radar. Check your plan." };

  const { error } = await s.supabase.from("watchlist_items").insert({ watchlist_id: listId, symbol: parsed.data, exchange });
  if (error) return { error: friendlyDbError(error.message) };

  await s.supabase.rpc("track_event", { p_event_type: "radar_symbol_added" });
  revalidatePath("/app", "layout");
  return { ok: true, message: `${parsed.data} added to your radar.` };
}

// RLS limits these deletes to the caller's own lists; zero rows back means "not yours, or already gone" (rule 11).
export async function removeFromRadar(itemId: string): Promise<ActionState> {
  const s = await requireSession();
  if (!z.uuid().safeParse(itemId).success) return { error: "That stock couldn't be found on your radar." };
  const { data, error } = await s.supabase.from("watchlist_items").delete().eq("id", itemId).select("id");
  revalidatePath("/app", "layout");
  if (error) return { error: friendlyDbError(error.message) };
  if (!data?.length) return { error: "That stock was already removed. Refresh the page." };
  return { ok: true };
}

export async function removeSymbolFromRadar(symbol: string): Promise<ActionState> {
  const s = await requireSession();
  const parsed = symbolSchema.safeParse(symbol);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { error } = await s.supabase.from("watchlist_items").delete().eq("symbol", parsed.data).select("id");
  revalidatePath("/app", "layout");
  if (error) return { error: friendlyDbError(error.message) };
  return { ok: true };
}

export async function createWatchlist(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { error: "Give the list a name." };
  const { error } = await s.supabase.from("watchlists").insert({ name });
  if (error) return { error: friendlyDbError(error.message) };
  revalidatePath("/app/watchlist");
  return { ok: true, message: `Created “${name}”.` };
}

export async function deleteWatchlist(id: string): Promise<ActionState> {
  const s = await requireSession();
  if (!z.uuid().safeParse(id).success) return { error: "That list couldn't be found." };
  const { data, error } = await s.supabase.from("watchlists").delete().eq("id", id).select("id");
  revalidatePath("/app", "layout");
  if (error) return { error: friendlyDbError(error.message) };
  if (!data?.length) return { error: "That list was already deleted. Refresh the page." };
  return { ok: true };
}
