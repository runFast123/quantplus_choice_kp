import type { Metadata } from "next";
import { DryRunStudio, type Candidate } from "@/components/dry-run/dry-run-studio";
import { PageHeader } from "@/components/ui/layout";
import { isoDaysAgo } from "@/lib/format";
import { checkKey, daysAgoIST, isCheckRule, signalDayOf } from "@/lib/signal-checks";
import type { Signal } from "@/lib/types";
import { getCandles, getRuleHealth, getSparks } from "@/server/market-data";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Dry Run" };

/**
 * Dry Run (ADR-033): try a plan on past prices before putting money in. The list is today's rule
 * matches among the 500 largest companies, plus the stocks on the user's Market Radar; the user picks, the page does
 * the arithmetic. Each match carries its safety stop, its signal check tag and how its rule has done lately.
 */
export default async function DryRunPage() {
  const s = await requireSession();
  const db = s.supabase;

  const radarP = db
    .from("watchlist_items")
    .select("symbol")
    .limit(200)
    .then(async ({ data }) => {
      const symbols = [...new Set((data ?? []).map((r) => r.symbol))];
      if (!symbols.length) return [];
      const { data: snap } = await db
        .from("market_snapshot")
        .select("symbol, name, sector, last_price, segment")
        .in("symbol", symbols)
        .eq("exchange", "NSE")
        .neq("segment", "index")
        .not("last_price", "is", null);
      return snap ?? [];
    });

  const [matches, radar, nifty, health, buysRes, tagRes] = await Promise.all([
    db
      .from("market_snapshot")
      .select("symbol, name, sector, last_price, last_signal_strategy, last_signal_at, mcap_rank")
      .eq("segment", "equity")
      .eq("last_signal", "buy")
      .gte("last_signal_at", isoDaysAgo(21))
      .not("mcap_rank", "is", null)
      .lte("mcap_rank", 500)
      .not("last_price", "is", null)
      .order("last_signal_at", { ascending: false })
      .order("mcap_rank", { ascending: true })
      .limit(150),
    radarP,
    getCandles(db, "NIFTY"),
    getRuleHealth(db),
    db
      .from("trading_signals")
      .select("symbol, strategy, generated_at, payload")
      .eq("signal_type", "buy")
      .gte("generated_at", isoDaysAgo(22))
      .order("generated_at", { ascending: false })
      .limit(1000),
    db.from("signal_checks").select("strategy, symbol, signal_day").eq("tagged", true).gte("signal_day", daysAgoIST(30)).limit(1000),
  ]);

  // The newest buy per stock and rule: its safety stop and the close it fired on.
  const buys = new Map<string, Pick<Signal, "generated_at" | "payload">>();
  for (const b of (buysRes.data ?? []) as Pick<Signal, "symbol" | "strategy" | "generated_at" | "payload">[]) {
    const k = `${b.strategy}|${b.symbol}`;
    if (!buys.has(k)) buys.set(k, b);
  }
  const tags = new Set((tagRes.data ?? []).map((t) => checkKey(t.strategy, t.symbol, t.signal_day)));
  const radarSet = new Set(radar.map((r) => r.symbol));

  const fromMatches: Candidate[] = (matches.data ?? []).map((r) => {
    const strategy = r.last_signal_strategy ?? "";
    const buy = buys.get(`${strategy}|${r.symbol}`);
    const stop = buy?.payload?.stop != null ? Number(buy.payload.stop) : null;
    return {
      symbol: r.symbol,
      name: r.name,
      sector: r.sector,
      price: Number(r.last_price),
      strategy,
      matchedAt: r.last_signal_at ?? "",
      stop: stop != null && Number.isFinite(stop) && stop > 0 && stop < Number(r.last_price) ? stop : null,
      tagged: Boolean(buy && isCheckRule(strategy) && tags.has(checkKey(strategy, r.symbol, signalDayOf(buy)))),
      onRadar: radarSet.has(r.symbol),
      spark: [],
    };
  });
  const listed = new Set(fromMatches.map((c) => c.symbol));
  const fromRadar: Candidate[] = radar
    .filter((r) => !listed.has(r.symbol))
    .map((r) => ({
      symbol: r.symbol,
      name: r.name,
      sector: r.sector,
      price: Number(r.last_price),
      strategy: "",
      matchedAt: "",
      stop: null,
      tagged: false,
      onRadar: true,
      spark: [],
    }));
  const candidates = [...fromMatches, ...fromRadar];
  const sparks = await getSparks(db, candidates.map((c) => c.symbol), 45);
  for (const c of candidates) c.spark = sparks.get(c.symbol) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Practice before you invest"
        title="Dry Run"
        description="Try a plan on real past prices before you put in a rupee. Pick a few stocks, choose an amount, and see what the same money did and how bad the bad days got."
      />
      <DryRunStudio candidates={candidates} benchmark={nifty} health={Object.fromEntries(health.latest)} />
    </div>
  );
}
