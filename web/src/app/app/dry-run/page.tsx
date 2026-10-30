import type { Metadata } from "next";
import { DryRunStudio, type Candidate } from "@/components/dry-run/dry-run-studio";
import { PageHeader } from "@/components/ui/layout";
import { isoDaysAgo } from "@/lib/format";
import { getCandles } from "@/server/market-data";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Dry Run" };

/**
 * Dry Run (ADR-033): try a plan on past prices before putting money in. The list is today's rule
 * matches among the 500 largest companies; the user picks, the page does the arithmetic.
 */
export default async function DryRunPage() {
  const s = await requireSession();
  const db = s.supabase;

  const [matches, nifty] = await Promise.all([
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
    getCandles(db, "NIFTY"),
  ]);

  const candidates: Candidate[] = (matches.data ?? []).map((r) => ({
    symbol: r.symbol,
    name: r.name,
    sector: r.sector,
    price: Number(r.last_price),
    strategy: r.last_signal_strategy ?? "",
    matchedAt: r.last_signal_at ?? "",
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Practice before you invest"
        title="Dry Run"
        description="Try a plan on real past prices before you put in a rupee. Choose an amount and a few stocks, then see what the same money did, how bad the bad days got, and how the plan scores on the basics."
      />
      <DryRunStudio candidates={candidates} benchmark={nifty} />
    </div>
  );
}
