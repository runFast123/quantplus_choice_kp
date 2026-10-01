"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CONSENT_VERSION } from "@/lib/consents";
import { friendlyDbError, type ActionState } from "@/lib/errors";
import { applyConsentWithdrawal, deleteAccount } from "@/server/privileged/account";
import { PrivilegedError } from "@/server/privileged/guards";
import { requireSession } from "@/server/session";

export async function updateProfile(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const full_name = String(form.get("full_name") ?? "").trim().slice(0, 120) || null;
  const rawPhone = String(form.get("phone") ?? "").replace(/[\s-]/g, "");
  if (rawPhone && !/^\+?[0-9]{10,15}$/.test(rawPhone)) return { error: "Phone should be 10–15 digits, optionally starting with +." };
  const { error } = await s.supabase.from("profiles").update({ full_name, phone: rawPhone || null }).eq("user_id", s.userId);
  if (error) return { error: friendlyDbError(error.message) };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Profile saved." };
}

export async function changePassword(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const password = String(form.get("password") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (password !== form.get("confirm")) return { error: "The two passwords don't match." };
  const { error } = await s.supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  return { ok: true, message: "Password updated." };
}

/**
 * Grant or withdraw a consent. Withdrawing has consequences the spec requires:
 * ai_processing → AI keys removed.
 */
export async function setConsent(purpose: string, granted: boolean): Promise<ActionState> {
  const s = await requireSession();
  if (!(purpose in CONSENT_VERSION)) return { error: "Unknown consent." };
  if (!granted && (purpose === "terms" || purpose === "privacy_policy")) {
    return { error: "These are required to use QuantsPulse. To withdraw them, delete your account." };
  }
  if (granted) {
    const { error } = await s.supabase.from("user_consents").insert({ purpose, version: CONSENT_VERSION[purpose] });
    if (error) return { error: friendlyDbError(error.message) };
  } else {
    await s.supabase.from("user_consents").update({ withdrawn_at: new Date().toISOString() }).eq("purpose", purpose).is("withdrawn_at", null);
    await applyConsentWithdrawal(s.userId, purpose);
  }
  revalidatePath("/app/settings");
  revalidatePath("/app/integrations");
  return { ok: true };
}

export async function deleteMyAccount(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  if (form.get("confirm") !== "DELETE") return { error: "Type DELETE to confirm." };
  try {
    await deleteAccount(s.userId);
  } catch (e) {
    return { error: e instanceof PrivilegedError ? e.message : "We couldn't delete the account. Nothing was removed from your workspace data." };
  }
  await s.supabase.auth.signOut();
  redirect("/?deleted=1");
}
