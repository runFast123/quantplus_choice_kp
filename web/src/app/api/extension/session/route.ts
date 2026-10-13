import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  // 1. Check Bearer token in Authorization header
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (bearerToken) {
    try {
      const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
      const { data: { user }, error } = await supabaseAnon.auth.getUser(bearerToken);
      if (user && !error) {
        return NextResponse.json(
          {
            authenticated: true,
            user: {
              id: user.id,
              email: user.email,
            },
            token: bearerToken,
          },
          { status: 200, headers: corsHeaders }
        );
      }
    } catch {}
  }

  // 2. Check Cookie session from caller
  try {
    const supabase = await supabaseServer();
    const { data: claimsData } = await supabase.auth.getClaims();
    const sub = claimsData?.claims?.sub;
    if (sub) {
      const { data: { user } } = await supabase.auth.getUser();
      return NextResponse.json(
        {
          authenticated: true,
          user: {
            id: sub,
            email: user?.email,
          },
        },
        { status: 200, headers: corsHeaders }
      );
    }
  } catch {}

  // 3. Not authenticated
  return NextResponse.json(
    {
      authenticated: false,
      user: null,
    },
    { status: 200, headers: corsHeaders }
  );
}
