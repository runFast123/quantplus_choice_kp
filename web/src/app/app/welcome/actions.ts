"use server";

import { redirect } from "next/navigation";
import { CONSENT_VERSION } from "@/lib/consents";
import { requireSession } from "@/server/session";

export async function completeOnboarding(form: FormData) {
  const s = await requireSession();
  if (form.get("terms") !== "on") redirect("/app/welcome");

  const fullName = String(form.get("full_name") ?? "").trim().slice(0, 120);
  const phone = String(form.get("phone") ?? "").replace(/[\s-]/g, "");
  await s.supabase
    .from("profiles")
    .update({ full_name: fullName || null, ...(/^\+?[0-9]{10,15}$/.test(phone) ? { phone } : {}) })
    .eq("user_id", s.userId);

  const purposes = ["terms", "privacy_policy"];
  for (const p of ["broker_data_access", "ai_processing", "marketing"]) if (form.get(p) === "on") purposes.push(p);
  await s.supabase.from("user_consents").insert(purposes.map((purpose) => ({ purpose, version: CONSENT_VERSION[purpose] })));

  await s.supabase.rpc("track_event", { p_event_type: "onboarding_completed" });
  redirect("/app");
}
