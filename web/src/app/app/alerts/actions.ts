"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { friendlyDbError, type ActionState } from "@/lib/errors";
import { requireSession } from "@/server/session";

const alertSchema = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9&\-.]{1,20}$/, "That isn't a valid symbol."),
  exchange: z.enum(["NSE", "BSE"]).default("NSE"),
  condition: z.enum(["above", "below"]),
  trigger_price: z.coerce.number().positive("Enter a price above zero."),
});

export async function createAlert(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const parsed = alertSchema.safeParse({
    symbol: form.get("symbol"),
    exchange: form.get("exchange") || "NSE",
    condition: form.get("condition"),
    trigger_price: form.get("trigger_price"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { data: quote } = await s.supabase
    .from("market_snapshot")
    .select("last_price")
    .eq("symbol", parsed.data.symbol)
    .eq("exchange", parsed.data.exchange)
    .maybeSingle();
  if (!quote) return { error: `${parsed.data.symbol} isn't in our list.` };
  const last = Number(quote.last_price);
  const { condition, trigger_price } = parsed.data;
  if ((condition === "above" && trigger_price <= last) || (condition === "below" && trigger_price >= last)) {
    return {
      error: `It's already ${condition === "above" ? "above" : "below"} that — last close was ₹${last.toFixed(2)}.`,
    };
  }

  const { error } = await s.supabase.from("price_alerts").insert({ ...parsed.data, channels: ["in_app"] });
  if (error) return { error: friendlyDbError(error.message) };
  await s.supabase.rpc("track_event", { p_event_type: "alert_created" });
  revalidatePath("/app/alerts");
  return { ok: true, message: `Alert set: ${parsed.data.symbol} ${condition} ₹${trigger_price.toFixed(2)}.` };
}

export async function quickArmAlert(
  symbol: string,
  condition: "above" | "below",
  triggerPrice: number,
): Promise<ActionState> {
  const s = await requireSession();
  const parsed = alertSchema.safeParse({
    symbol,
    exchange: "NSE",
    condition,
    trigger_price: triggerPrice,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { data: quote } = await s.supabase
    .from("market_snapshot")
    .select("last_price")
    .eq("symbol", parsed.data.symbol)
    .maybeSingle();
  if (!quote) return { error: `${parsed.data.symbol} isn't in our market list.` };
  const last = Number(quote.last_price);
  const { trigger_price } = parsed.data;

  if (
    (condition === "above" && trigger_price <= last) ||
    (condition === "below" && trigger_price >= last)
  ) {
    return {
      error: `Already ${condition === "above" ? "above" : "below"} that level (LTP ₹${last.toFixed(2)}).`,
    };
  }

  const { error } = await s.supabase.from("price_alerts").insert({
    ...parsed.data,
    origin: "quant_signal",
    channels: ["in_app"],
  });
  if (error) return { error: friendlyDbError(error.message) };
  await s.supabase.rpc("track_event", { p_event_type: "alert_created" });
  revalidatePath("/app/alerts");
  revalidatePath(`/app/markets/${encodeURIComponent(symbol)}`);
  return {
    ok: true,
    message: `Alert armed: ${parsed.data.symbol} ${condition} ₹${trigger_price.toFixed(2)}.`,
  };
}

export async function setAlertStatus(id: string, status: "armed" | "disabled") {
  const s = await requireSession();
  await s.supabase.from("price_alerts").update({ status }).eq("id", id);
  revalidatePath("/app/alerts");
}

export async function deleteAlert(id: string) {
  const s = await requireSession();
  await s.supabase.from("price_alerts").delete().eq("id", id);
  revalidatePath("/app/alerts");
}
