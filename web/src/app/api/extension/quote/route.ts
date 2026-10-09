import { NextResponse, type NextRequest } from "next/server";
import { getExtensionQuote } from "@/server/privileged/extension";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
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
