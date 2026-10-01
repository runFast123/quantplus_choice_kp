"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/errors";
import { PrivilegedError } from "@/server/privileged/guards";
import { connectBroker, saveAiKey } from "@/server/privileged/secrets";
import { requireSession } from "@/server/session";

const fail = (e: unknown): ActionState => ({
  error: e instanceof PrivilegedError ? (e.message === "NOT_AUTHORIZED" ? "You don't have permission to do that." : e.message) : "Something went wrong.",
});

const brokerSchema = z.object({
  broker: z.enum(["choice", "zerodha", "angelone", "upstox", "dhan", "fyers", "other"]),
  clientId: z.string().trim().min(3, "Enter your broker client ID.").max(40),
  accessToken: z.string().trim().min(10, "Paste the full access token."),
});

export async function connectBrokerAction(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  if (!s.activeTenantId) return { error: "No active workspace." };
  const parsed = brokerSchema.safeParse({
    broker: form.get("broker"),
    clientId: form.get("client_id"),
    accessToken: form.get("access_token"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await connectBroker(s.userId, s.activeTenantId, parsed.data);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/app/integrations");
  return { ok: true, message: "Connected. The token is encrypted; we only ever show its status here." };
}

/** RLS delete policy on broker_connections; credentials cascade. */
export async function disconnectBroker(id: string) {
  const s = await requireSession();
  await s.supabase.from("broker_connections").delete().eq("id", id);
  revalidatePath("/app/integrations");
}

const aiSchema = z.object({
  provider: z.enum(["gemini", "openai", "anthropic", "other"]),
  label: z.string().trim().max(40).default("default"),
  apiKey: z.string().trim().min(12, "That key looks too short."),
  defaultModel: z.string().trim().max(80).optional(),
});

export async function saveAiKeyAction(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  if (!s.activeTenantId) return { error: "No active workspace." };
  const parsed = aiSchema.safeParse({
    provider: form.get("provider"),
    label: form.get("label") || "default",
    apiKey: form.get("api_key"),
    defaultModel: form.get("default_model") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await saveAiKey(s.userId, s.activeTenantId, parsed.data);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/app/integrations");
  return { ok: true, message: `Saved. We'll show it as ••••${parsed.data.apiKey.slice(-4)} from now on.` };
}

export async function deleteAiKey(id: string) {
  const s = await requireSession();
  await s.supabase.from("ai_provider_keys").delete().eq("id", id);
  revalidatePath("/app/integrations");
}
