"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/errors";
import {
  activatePlan,
  isPlatformAdmin,
  triggerMarketAnalytics,
  triggerResearchRefresh,
  triggerEodNotifier,
  triggerEodSync,
} from "@/server/privileged/admin";
import { ingestNews } from "@/server/privileged/news";
import { PrivilegedError } from "@/server/privileged/guards";
import { requireSession } from "@/server/session";

const schema = z.object({
  userId: z.string().uuid(),
  tenantId: z.string().uuid(),
  plan: z.enum(["basic", "pro", "pro_plus"]),
  months: z.coerce.number().int().min(1).max(24),
  amountRupees: z.coerce.number().min(0),
  method: z.enum(["upi", "bank_transfer", "cash", "other"]),
  reference: z.string().trim().max(80).optional(),
});

export async function activatePlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    const sub = await activatePlan(s.userId, {
      userId: d.userId,
      tenantId: d.tenantId,
      plan: d.plan,
      months: d.months,
      amountPaise: Math.round(d.amountRupees * 100),
      method: d.method,
      reference: d.reference,
    });
    revalidatePath("/admin");
    return { ok: true, message: `Activated ${sub.plan_code} until ${new Date(sub.current_period_end).toLocaleDateString("en-IN")}.` };
  } catch (e) {
    const m = e instanceof PrivilegedError ? e.message : "";
    return { error: m.includes("NOT_AUTHORIZED") ? "Not a platform admin." : m.includes("USER_NOT_IN_TENANT") ? "User isn't in that workspace." : m.includes("INVALID_INPUT") ? "Months must be 1–24." : "Activation failed." };
  }
}

export async function fetchNewsNow(): Promise<ActionState> {
  const s = await requireSession();
  if (!(await isPlatformAdmin(s.userId))) return { error: "Not a platform admin." };
  try {
    const r = await ingestNews({ searchSymbols: 8 });
    revalidatePath("/admin");
    const failed = r.sources.filter((x) => x.status === "error").length;
    return { ok: true, message: `${r.inserted} new headlines, ${r.linked} stock links, ${r.researchRows ?? 0} notes rebuilt${failed ? `; ${failed} source(s) failed` : ""} (${Math.round(r.durationMs / 1000)}s).` };
  } catch (e) {
    return { error: `Ingestion failed: ${(e as Error).message}` };
  }
}

export async function refreshMarketAnalyticsAction(): Promise<ActionState> {
  const s = await requireSession();
  if (!(await isPlatformAdmin(s.userId))) return { error: "Not a platform admin." };
  try {
    const res = await triggerMarketAnalytics(s.userId, 10);
    revalidatePath("/admin");
    return {
      ok: true,
      message: `Analytics refreshed: ${res.quotes} quotes updated, ${res.signals} signals produced, ${res.rsi_events} RSI milestones calculated.`,
    };
  } catch (e) {
    return { error: `Analytics calculation failed: ${(e as Error).message}` };
  }
}

export async function refreshResearchNotesAction(): Promise<ActionState> {
  const s = await requireSession();
  if (!(await isPlatformAdmin(s.userId))) return { error: "Not a platform admin." };
  try {
    const res = await triggerResearchRefresh(s.userId);
    revalidatePath("/admin");
    return {
      ok: true,
      message: `Research notes rebuild complete: ${res.rows} symbols updated with multi-factor stances.`,
    };
  } catch (e) {
    return { error: `Research notes rebuild failed: ${(e as Error).message}` };
  }
}

export async function runEodNotifierAction(): Promise<ActionState> {
  const s = await requireSession();
  if (!(await isPlatformAdmin(s.userId))) return { error: "Not a platform admin." };
  try {
    const res = await triggerEodNotifier(s.userId);
    revalidatePath("/admin");
    return {
      ok: true,
      message: `EOD Notifier executed successfully: alerts, exit signals, and plan expiries dispatched (${JSON.stringify(res)}).`,
    };
  } catch (e) {
    return { error: `EOD Notifier execution failed: ${(e as Error).message}` };
  }
}

export async function syncEodMarketPricesAction(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  if (!(await isPlatformAdmin(s.userId))) return { error: "Not a platform admin." };

  const rawScope = form.get("scope")?.toString() || "active";
  const customSymbolsRaw = form.get("customSymbols")?.toString() || "";
  const daysRaw = Number(form.get("days")?.toString() || 10);
  const rawIncludeToday = form.get("includeToday")?.toString();
  const includeToday = rawIncludeToday === undefined || rawIncludeToday === "true" || rawIncludeToday === "on";

  const scope = rawScope === "top" || rawScope === "all" || rawScope === "custom" ? rawScope : "active";
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : 10;
  const symbols = scope === "custom" && customSymbolsRaw
    ? customSymbolsRaw.split(/[,;\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean)
    : undefined;

  try {
    const report = await triggerEodSync(s.userId, { scope, symbols, days, includeToday });
    revalidatePath("/admin");
    return {
      ok: true,
      message: `✓ EOD Ingestion Complete: ${report.symbolsUpdated}/${report.symbolsTargeted} symbols updated (${report.candlesUpserted} candles written). Analytics recalculated for ${Object.keys(report.analyticsTotals).length > 0 ? "active" : "0"} symbols. Finished in ${(report.durationMs / 1000).toFixed(1)}s.`,
    };
  } catch (e) {
    return { error: `EOD Ingestion failed: ${(e as Error).message}` };
  }
}

