import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/server/session";

/**
 * Symbol search for the header box and add-symbol forms: GET /api/symbols?q=tata
 * Ranked in the database (search_symbols): exact ticker, ticker prefix, name,
 * then size. Signed-in members only; RLS applies.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s || !s.deviceActive) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 40);
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 8, 1), 20);
  if (!q) return NextResponse.json([]);
  const { data, error } = await s.supabase.rpc("search_symbols", { p_q: q, p_limit: limit });
  if (error) return NextResponse.json({ error: "search failed" }, { status: 500 });
  return NextResponse.json(data ?? [], { headers: { "cache-control": "private, max-age=60" } });
}
