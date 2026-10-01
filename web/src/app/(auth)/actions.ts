"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { SITE_URL } from "@/lib/env";
import { safeNext } from "@/lib/safe-next";
import type { ActionState } from "@/lib/errors";
import { supabaseServer } from "@/lib/supabase/server";
import { claimThisDevice } from "@/server/device";


function welcomeUrl(next: FormDataEntryValue | null): string {
  const target = safeNext(next, "");
  return target ? `/app/welcome?next=${encodeURIComponent(target)}` : "/app/welcome";
}

const credentials = z.object({
  email: z.email("Enter a valid email address.").transform((s) => s.toLowerCase().trim()),
  password: z.string().min(8, "Use at least 8 characters."),
});

export async function signIn(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message, data: { email: String(form.get("email") ?? "") } };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    const msg = error?.message.includes("Email not confirmed")
      ? "Confirm your email first — we sent you a link when you signed up."
      : "That email and password don't match.";
    return { error: msg, data: { email: parsed.data.email } };
  }
  await claimThisDevice(data.user.id);
  redirect(safeNext(form.get("next")));
}

const signupSchema = credentials.extend({
  full_name: z.string().trim().min(1, "Tell us your name.").max(120),
  terms: z.literal("on", { message: "Please accept the Terms and Privacy Policy to continue." }),
});

export async function signUp(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = signupSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
    full_name: form.get("full_name"),
    terms: form.get("terms"),
  });
  const echo = { email: String(form.get("email") ?? ""), full_name: String(form.get("full_name") ?? "") };
  if (!parsed.success) return { error: parsed.error.issues[0].message, data: echo };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // New accounts always pass through onboarding (consents); `next` (e.g. an
      // invite link) is carried through it.
      emailRedirectTo: `${SITE_URL}/auth/confirm?next=${encodeURIComponent(welcomeUrl(form.get("next")))}`,
      data: { full_name: parsed.data.full_name, marketing: form.get("marketing") === "on" },
    },
  });
  if (error) return { error: error.message, data: echo };

  // Email confirmation disabled in the project: we're already signed in.
  if (data.session && data.user) {
    await claimThisDevice(data.user.id);
    redirect(welcomeUrl(form.get("next")));
  }
  return { ok: true, message: `Check ${parsed.data.email} for a confirmation link.`, data: echo };
}

export async function sendReset(_: ActionState, form: FormData): Promise<ActionState> {
  const email = z.email().safeParse(String(form.get("email") ?? "").trim().toLowerCase());
  if (!email.success) return { error: "Enter a valid email address." };
  const supabase = await supabaseServer();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${SITE_URL}/auth/confirm?next=/app/settings%3Ftab%3Dsecurity`,
  });
  // Same answer whether or not the account exists.
  return { ok: true, message: "If that address has an account, a reset link is on its way." };
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/");
}
