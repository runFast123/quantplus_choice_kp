import { NextResponse, type NextRequest } from "next/server";
import { markerFromSignal } from "@/lib/signal-trade";
import type { Quote, Signal } from "@/lib/types";
import { getCandles, normalizeQuote } from "@/server/market-data";
import { getSession } from "@/server/session";

/**
 * One stock for Dry Run, fetched when the user adds it to a plan: GET /api/dry-run/stock?symbol=TCS
 * Two years of daily candles (replay, odds, traded value) and its stored rule signals.
 * Signed-in members only; RLS applies. Market data only — nothing about the user.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s || !s.deviceActive) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9&_.-]{1,24}$/.test(symbol)) return NextResponse.json({ error: "bad symbol" }, { status: 400 });

  const db = s.supabase;
  const [quoteRes, candles, signalsRes] = await Promise.all([
    db.from("market_snapshot").select("*").eq("symbol", symbol).eq("exchange", "NSE").maybeSingle(),
    getCandles(db, symbol),
    db.from("trading_signals").select("*").eq("symbol", symbol).order("generated_at", { ascending: false }).limit(200),
  ]);
  if (!quoteRes.data) return NextResponse.json({ error: "not found" }, { status: 404 });
  const q = normalizeQuote(quoteRes.data as Quote);

  return NextResponse.json(
    {
      symbol: q.symbol,
      name: q.name,
      sector: q.sector,
      segment: q.segment ?? null,
      lastPrice: q.last_price,
      asOf: q.as_of,
      candles,
      markers: ((signalsRes.data ?? []) as Signal[]).map(markerFromSignal),
    },
    { headers: { "cache-control": "private, max-age=300" } },
  );
}
