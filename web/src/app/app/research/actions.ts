"use server";

import { PrivilegedError } from "@/server/privileged/guards";
import { researchReadWithMyKey, symbolResearchChatWithMyKey } from "@/server/privileged/ai";
import { requireSession } from "@/server/session";

export type AiReadState = { text?: string; model?: string; error?: string } | undefined;

/** Runs the user's own AI key over the research facts. Nothing is stored. */
export async function askMyAi(_: AiReadState, form: FormData): Promise<AiReadState> {
  const s = await requireSession();
  if (!s.activeTenantId) return { error: "No active workspace." };
  const symbol = String(form.get("symbol") ?? "").toUpperCase();
  try {
    const r = await researchReadWithMyKey(s.userId, s.activeTenantId, symbol);
    await s.supabase.rpc("track_event", { p_event_type: "ai_research_read" });
    return { text: r.text, model: r.model };
  } catch (e) {
    return { error: e instanceof PrivilegedError ? e.message : "Something went wrong reaching your AI provider." };
  }
}

export type SymbolChatState = {
  reply?: string;
  model?: string;
  error?: string;
};

export async function askSymbolAiChat(
  symbol: string,
  question: string,
): Promise<SymbolChatState> {
  const s = await requireSession();
  if (!s.activeTenantId) return { error: "No active workspace." };
  try {
    const r = await symbolResearchChatWithMyKey(s.userId, s.activeTenantId, symbol, question);
    await s.supabase.rpc("track_event", { p_event_type: "ai_research_chat" });
    return { reply: r.text, model: r.model };
  } catch (e) {
    return {
      error:
        e instanceof PrivilegedError
          ? e.message
          : "Something went wrong reaching your AI provider.",
    };
  }
}

