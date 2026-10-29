import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/lib/env";
import { extensionCors, isExtensionOrigin } from "@/lib/extension-cors";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Extension sign-in check. The extension's background worker calls this with the user's
 * QuantsPulse cookies (proxy.ts has already refreshed them), and gets back a current access
 * token to use as a Bearer on /api/extension/quote. The token is only ever returned to a
 * chrome-extension:// origin — a web page can't forge that header, and gets no CORS access.
 */
export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: extensionCors(req.headers.get("origin"), { anyOrigin: false }) });
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = extensionCors(origin, { anyOrigin: false });

  // 1. A Bearer token the extension already holds
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (bearerToken) {
    try {
      const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
      const { data: { user }, error } = await anon.auth.getUser(bearerToken);
      if (user && !error) {
        return NextResponse.json({ authenticated: true, user: { id: user.id, email: user.email } }, { headers });
      }
    } catch {}
  }

  // 2. The cookie session from the website
  try {
    const supabase = await supabaseServer();
    const { data: claimsData } = await supabase.auth.getClaims();
    const claims = claimsData?.claims;
    if (claims?.sub) {
      const body: Record<string, unknown> = {
        authenticated: true,
        user: { id: claims.sub, email: typeof claims.email === "string" ? claims.email : undefined },
      };
      if (isExtensionOrigin(origin)) {
        // getClaims() verified this session's JWT above, so its token is safe to hand over.
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          body.token = session.access_token;
          body.expiresAt = session.expires_at ?? null;
        }
      }
      return NextResponse.json(body, { headers });
    }
  } catch {}

  return NextResponse.json({ authenticated: false, user: null }, { headers });
}
