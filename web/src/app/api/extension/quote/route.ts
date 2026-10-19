import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";
import { getExtensionQuote } from "@/server/privileged/extension";

export const dynamic = "force-dynamic";

function getCorsHeaders(req: NextRequest) {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Cache-Control": "private, no-cache, no-store, must-revalidate",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(req) });
}

export async function GET(req: NextRequest) {
  const corsHeaders = getCorsHeaders(req);
  // 1. Enforce Authentication Guard — Active QuantsPulse account required
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  let authenticated = false;

  if (bearerToken) {
    try {
      const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
      const { data: { user }, error } = await supabaseAnon.auth.getUser(bearerToken);
      if (user && !error) {
        authenticated = true;
      }
    } catch {}
  } else {
    try {
      const supabase = await supabaseServer();
      const { data: claimsData } = await supabase.auth.getClaims();
      if (claimsData?.claims?.sub) {
        authenticated = true;
      }
    } catch {}
  }

  if (!authenticated) {
    return NextResponse.json(
      {
        error: "account_required",
        message: "An active QuantsPulse account is required to use this extension. Please sign in or create an account at https://quantplus-ten.vercel.app",
        login_url: "https://quantplus-ten.vercel.app/login",
        signup_url: "https://quantplus-ten.vercel.app/signup",
      },
      { status: 401, headers: corsHeaders }
    );
  }

  // 2. Query Parameters
  const symbol = req.nextUrl.searchParams.get("symbol");
  const exchange = req.nextUrl.searchParams.get("exchange") || "NSE";

  if (!symbol) {
    return NextResponse.json({ error: "symbol parameter required" }, { status: 400, headers: corsHeaders });
  }

  try {
    const data = await getExtensionQuote(symbol, exchange);
    if (!data) {
      return NextResponse.json({ error: `Symbol not found: ${symbol}` }, { status: 404, headers: corsHeaders });
    }

    return NextResponse.json(data, { status: 200, headers: corsHeaders });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Internal server error" },
      { status: 500, headers: corsHeaders },
    );
  }
}
