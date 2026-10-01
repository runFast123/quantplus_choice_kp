import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safe-next";
import { supabaseServer } from "@/lib/supabase/server";
import { claimThisDevice } from "@/server/device";

/**
 * Handles email links (signup confirmation, password recovery, magic link).
 * Supports both the token_hash flow and the PKCE `code` flow.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNext(url.searchParams.get("next"));

  const supabase = await supabaseServer();
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");

  const { data, error } = tokenHash && type
    ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    : code
      ? await supabase.auth.exchangeCodeForSession(code)
      : { data: { user: null }, error: new Error("missing token") };

  if (error || !data.user) {
    return NextResponse.redirect(new URL("/login?error=link", url.origin));
  }
  await claimThisDevice(data.user.id);
  return NextResponse.redirect(new URL(next, url.origin));
}
