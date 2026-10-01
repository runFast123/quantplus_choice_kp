import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/market/filter-bar";
import { RadarToggle } from "@/components/market/radar-toggle";
import { Badge, Delta, RangeBar } from "@/components/ui/data";
import { Empty, PageHeader, Panel, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { date, price, volume } from "@/lib/format";
import type { Quote } from "@/lib/types";
import { normalizeQuote } from "@/server/market-data";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Markets" };

const SORTS: Record<string, { col: string; asc: boolean; label: string }> = {
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
  const sort = SORTS[str("sort")] ? str("sort") : "movers";

  let q = s.supabase.from("market_snapshot").select("*");
  if (sector) q = q.eq("sector", sector);
  if (signal === "buy" || signal === "exit") q = q.eq("last_signal", signal);
  if (rsi === "oversold") q = q.lte("rsi", 30);
  if (rsi === "overbought") q = q.gte("rsi", 70);
  q = q.order(SORTS[sort].col, { ascending: SORTS[sort].asc, nullsFirst: false }).limit(300);

  const [{ data }, sectorsRes, radarRes] = await Promise.all([
    q,
    s.supabase.from("market_symbols").select("sector").eq("is_active", true),
    s.supabase.from("watchlist_items").select("symbol"),
  ]);
  const rows = ((data ?? []) as Quote[]).map(normalizeQuote);
  const sectors = [...new Set((sectorsRes.data ?? []).map((r) => r.sector).filter(Boolean) as string[])].sort();
  const onRadar = new Set((radarRes.data ?? []).map((r) => r.symbol));
  const asOf = rows.find((r) => r.as_of)?.as_of;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={asOf ? `End of day · ${date(asOf)}` : "End of day"}
        title="Markets"
        description="Every listed stock we cover, with the last session's move, where it sits in its 52-week range, momentum, and the most recent rule-based signal."
      />

      <FilterBar
        filters={[
          { name: "sector", label: "Sector", options: [{ value: "", label: "All sectors" }, ...sectors.map((x) => ({ value: x, label: x }))] },
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
          { name: "sort", label: "Sort", options: Object.entries(SORTS).map(([value, v]) => ({ value: value === "movers" ? "" : value, label: v.label })) },
        ]}
      />

      <Panel title={`${rows.length} stock${rows.length === 1 ? "" : "s"}`} meta={sector || undefined}>
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
                    <td className={tdNum + " text-muted-foreground"}>{volume(r.volume)}</td>
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
      </Panel>
    </div>
  );
}
