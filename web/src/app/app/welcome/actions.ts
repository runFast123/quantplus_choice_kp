"use server";

import { redirect } from "next/navigation";
import { CONSENT_VERSION } from "@/lib/consents";
import { safeNext } from "@/lib/safe-next";
import { requireSession } from "@/server/session";

export async function completeOnboarding(form: FormData) {
  const s = await requireSession();
  if (form.get("terms") !== "on") redirect("/app/welcome");

  // A failed save comes back to this page with a fixed sentence (never text from the address), keeping `next`.
  const retry = () => {
    const q = new URLSearchParams({ error: "save" });
    const next = form.get("next");
    if (typeof next === "string" && next) q.set("next", next);
    redirect(`/app/welcome?${q}`);
  };

  const fullName = String(form.get("full_name") ?? "").trim().slice(0, 120);
  const phone = String(form.get("phone") ?? "").replace(/[\s-]/g, "");
  const { error: profileError } = await s.supabase
    .from("profiles")
    .update({ full_name: fullName || null, ...(/^\+?[0-9]{10,15}$/.test(phone) ? { phone } : {}) })
    .eq("user_id", s.userId);
  if (profileError) retry();

  const purposes = ["terms", "privacy_policy"];
  for (const p of ["ai_processing", "marketing"]) if (form.get(p) === "on") purposes.push(p);
  const { error: consentError } = await s.supabase
    .from("user_consents")
    .insert(purposes.map((purpose) => ({ purpose, version: CONSENT_VERSION[purpose] })));
  if (consentError) retry();

  await s.supabase.rpc("track_event", { p_event_type: "onboarding_completed" });
  redirect(safeNext(form.get("next")));
}
