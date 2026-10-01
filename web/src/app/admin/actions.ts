"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/errors";
import { activatePlan, isPlatformAdmin } from "@/server/privileged/admin";
import { ingestNews } from "@/server/privileged/news";
import { PrivilegedError } from "@/server/privileged/guards";
import { requireSession } from "@/server/session";

const schema = z.object({
  userId: z.uuid(),
  tenantId: z.uuid(),
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
