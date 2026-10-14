"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/errors";
import { PrivilegedError } from "@/server/privileged/guards";
import { saveAiKey } from "@/server/privileged/secrets";
import { requireSession } from "@/server/session";

const fail = (e: unknown): ActionState => ({
  error: e instanceof PrivilegedError ? (e.message === "NOT_AUTHORIZED" ? "You don't have permission to do that." : e.message) : "Something went wrong.",
});

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

export type DetectedModel = { id: string; label: string };

export async function fetchProviderModelsAction(
  provider: string,
  apiKey: string,
): Promise<{ ok: boolean; models?: DetectedModel[]; error?: string }> {
  await requireSession();
  const key = apiKey.trim();
  if (!key || key.length < 12) {
    return { ok: false, error: "Please enter a valid API key (at least 12 characters)." };
  }

  try {
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401) return { ok: false, error: "Your Anthropic API key was rejected." };
      if (!res.ok) return { ok: false, error: `Anthropic API returned error ${res.status}.` };
      const data = await res.json();
      const list = Array.isArray(data.data) ? data.data : [];
      const models: DetectedModel[] = list.map((m: { id: string; display_name?: string }) => ({
        id: m.id,
        label: m.display_name ? `${m.display_name} (${m.id})` : m.id,
      }));
      // Sort models: sonnet/haiku/opus first
      models.sort((a, b) => {
        const aScore = a.id.includes("3-7") ? 1 : a.id.includes("3-5") ? 2 : 3;
        const bScore = b.id.includes("3-7") ? 1 : b.id.includes("3-5") ? 2 : 3;
        if (aScore !== bScore) return aScore - bScore;
        return a.id.localeCompare(b.id);
      });
      return { ok: true, models };
    }

    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: {
          authorization: `Bearer ${key}`,
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401) return { ok: false, error: "Your OpenAI API key was rejected." };
      if (!res.ok) return { ok: false, error: `OpenAI API returned error ${res.status}.` };
      const data = await res.json();
      const list = Array.isArray(data.data) ? data.data : [];
      const models: DetectedModel[] = list
        .filter((m: { id?: string }) => {
          const id = m.id?.toLowerCase() ?? "";
          return (
            (id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("chatgpt-")) &&
            !id.includes("realtime") &&
            !id.includes("audio") &&
            !id.includes("transcribe") &&
            !id.includes("vision-preview") &&
            !id.includes("tts") &&
            !id.includes("whisper") &&
            !id.includes("dall-e")
          );
        })
        .map((m: { id: string }) => ({
          id: m.id,
          label: m.id,
        }));
      // Sort: gpt-4o and o3/o1 at the top
      models.sort((a, b) => {
        const aScore = a.id.startsWith("gpt-4o") ? 1 : a.id.startsWith("o3") ? 2 : a.id.startsWith("o1") ? 3 : 4;
        const bScore = b.id.startsWith("gpt-4o") ? 1 : b.id.startsWith("o3") ? 2 : b.id.startsWith("o1") ? 3 : 4;
        if (aScore !== bScore) return aScore - bScore;
        return a.id.localeCompare(b.id);
      });
      return { ok: true, models };
    }

    if (provider === "gemini") {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 400 || res.status === 403) {
        return { ok: false, error: "Your Google Gemini API key was rejected." };
      }
      if (!res.ok) return { ok: false, error: `Google Gemini API returned error ${res.status}.` };
      const data = await res.json();
      const list = Array.isArray(data.models) ? data.models : [];
      const models: DetectedModel[] = list
        .filter((m: { supportedGenerationMethods?: string[] }) =>
          m.supportedGenerationMethods?.includes("generateContent")
        )
        .map((m: { name: string; displayName?: string }) => {
          const cleanId = m.name.replace(/^models\//, "");
          return {
            id: cleanId,
            label: m.displayName ? `${m.displayName} (${cleanId})` : cleanId,
          };
        });
      // Sort: gemini-2.0 models first
      models.sort((a, b) => {
        const aScore = a.id.includes("2.0") ? 1 : a.id.includes("1.5-pro") ? 2 : 3;
        const bScore = b.id.includes("2.0") ? 1 : b.id.includes("1.5-pro") ? 2 : 3;
        if (aScore !== bScore) return aScore - bScore;
        return a.id.localeCompare(b.id);
      });
      return { ok: true, models };
    }

    return { ok: false, error: "Automatic model detection is not available for 'Other'. Enter a custom model name." };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to reach AI provider.";
    return { ok: false, error: msg.includes("timeout") ? "Network timeout reaching provider." : msg };
  }
}

