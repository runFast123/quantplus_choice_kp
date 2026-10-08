import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/market/filter-bar";
import { RadarToggle } from "@/components/market/radar-toggle";
import { Badge, Delta, RangeBar } from "@/components/ui/data";
import { Empty, PageHeader, Panel, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { date, price, volume } from "@/lib/format";
import { PRICE_SOURCE, SECTORS } from "@/lib/market";
import { Pager, pageParam } from "@/components/ui/pager";
import type { Quote } from "@/lib/types";
import { normalizeQuote } from "@/server/market-data";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Markets" };

const PAGE_SIZE = 100;

const SORTS: Record<string, { col: string; asc: boolean; label: string }> = {
  size: { col: "mcap_rank", asc: true, label: "Largest first" },
  movers: { col: "change_pct", asc: false, label: "Top gainers" },
  laggards: { col: "change_pct", asc: true, label: "Top losers" },
  volume: { col: "volume", asc: false, label: "Volume" },
  rsi_low: { col: "rsi", asc: true, label: "RSI, low → high" },
  rsi_high: { col: "rsi", asc: false, label: "RSI, high → low" },
  symbol: { col: "symbol", asc: true, label: "Symbol A–Z" },
};

export default async function MarketsPage({ searchParams }: PageProps<"/app/markets">) {
  const s = await requireSession();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const sector = str("sector");
  const signal = str("signal");
  const rsi = str("rsi");
  const sort = SORTS[str("sort")] ? str("sort") : "size";
  const segment = (["sme", "etf", "index", "all"] as const).find((x) => x === str("segment")) ?? "equity";
  const page = pageParam(sp.page);

  let q = s.supabase.from("market_snapshot").select("*", { count: "exact" });
  if (segment !== "all") q = q.eq("segment", segment);
  if (sector) q = q.eq("sector", sector);
  if (signal === "buy" || signal === "exit") q = q.eq("last_signal", signal);
  if (rsi === "oversold") q = q.lte("rsi", 30);
  if (rsi === "overbought") q = q.gte("rsi", 70);
  q = q
    .order(SORTS[sort].col, { ascending: SORTS[sort].asc, nullsFirst: false })
    .order("symbol")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const [{ data, count }, radarRes] = await Promise.all([q, s.supabase.from("watchlist_items").select("symbol")]);
  const rows = ((data ?? []) as Quote[]).map(normalizeQuote);
  const total = count ?? rows.length;
  const params = Object.fromEntries(["sector", "signal", "rsi", "sort", "segment"].filter((k) => str(k)).map((k) => [k, str(k)]));
  const onRadar = new Set((radarRes.data ?? []).map((r) => r.symbol));
  const asOf = rows.find((r) => r.as_of)?.as_of;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={asOf ? `End of day · ${date(asOf)} · ${PRICE_SOURCE}` : `End of day · ${PRICE_SOURCE}`}
        title="Markets"
        description="Every NSE-listed stock, SME issue, major ETF and NSE index, with the last session's move, where it sits in its 52-week range, momentum, and the most recent rule-based signal."
      />

      <FilterBar
        filters={[
          {
            name: "segment",
            label: "Segment",
            options: [
              { value: "", label: "Stocks (main board)" },
              { value: "sme", label: "SME (Emerge)" },
              { value: "etf", label: "ETFs" },
              { value: "index", label: "Indices" },
              { value: "all", label: "Everything" },
            ],
          },
          { name: "sector", label: "Sector", options: [{ value: "", label: "All sectors" }, ...SECTORS.map((x) => ({ value: x, label: x }))] },
          {
            name: "signal",
            label: "Last signal",
            options: [
              { value: "", label: "Any" },
              { value: "buy", label: "Buy" },
              { value: "exit", label: "Exit" },
            ],
          },
          {
            name: "rsi",
            label: "RSI 14",
            options: [
              { value: "", label: "Any" },
              { value: "oversold", label: "Oversold (≤ 30)" },
              { value: "overbought", label: "Overbought (≥ 70)" },
            ],
          },
          { name: "sort", label: "Sort", options: Object.entries(SORTS).map(([value, v]) => ({ value: value === "size" ? "" : value, label: v.label })) },
        ]}
      />

      <Panel title={`${total.toLocaleString("en-IN")} ${segment === "index" ? "indices" : segment === "etf" ? "ETFs" : "symbols"}`} meta={sector || undefined}>
        {rows.length === 0 ? (
          <Empty title="Nothing matches.">Loosen a filter — oversold stocks in a single sector can be rare on any given day.</Empty>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[920px]">
              <thead>
                <tr>
                  <th className={th}>Symbol</th>
                  <th className={th}>Sector</th>
                  <th className={thNum}>Last</th>
                  <th className={thNum}>Chg</th>
                  <th className={thNum}>Volume</th>
                  <th className={th + " w-[150px]"}>52-week range</th>
                  <th className={thNum}>RSI</th>
                  <th className={th}>Signal</th>
                  <th className={th + " w-10"}>
                    <span className="sr-only">Radar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.exchange + r.symbol} className={tr}>
                    <td className={td}>
                      <Link href={`/app/markets/${encodeURIComponent(r.symbol)}`} className="group block">
                        <span className="num font-medium group-hover:underline">{r.symbol}</span>
                        <span className="block max-w-[200px] truncate text-[11.5px] text-muted-foreground">{r.name}</span>
                      </Link>
                    </td>
                    <td className={td + " text-muted-foreground"}>{r.sector ?? "—"}</td>
                    <td className={tdNum}>{price(r.last_price)}</td>
                    <td className={tdNum}>
                      <Delta value={r.change_pct} />
                    </td>
                    <td className={tdNum + " text-muted-foreground"}>{r.segment === "index" ? "—" : volume(r.volume)}</td>
                    <td className={td}>
                      <RangeBar low={r.low_52w} high={r.high_52w} value={r.last_price} />
                      <span className="num mt-1 flex justify-between text-[10.5px] text-muted-foreground">
                        <span>{price(r.low_52w)}</span>
                        <span>{price(r.high_52w)}</span>
                      </span>
                    </td>
                    <td className={tdNum}>{r.rsi != null ? r.rsi.toFixed(1) : "—"}</td>
                    <td className={td}>
                      {r.last_signal ? (
                        <Badge tone={r.last_signal === "buy" ? "gain" : "loss"}>{r.last_signal === "buy" ? "BUY" : "EXIT"}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className={td + " text-right"}>
                      <RadarToggle symbol={r.symbol} exchange={r.exchange} onRadar={onRadar.has(r.symbol)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pager path="/app/markets" params={params} page={page} pageSize={PAGE_SIZE} total={total} />
      </Panel>
    </div>
  );
}
