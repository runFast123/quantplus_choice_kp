import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/market/filter-bar";
import { SectorPulse } from "@/components/market/sector-pulse";
import { RadarToggle } from "@/components/market/radar-toggle";
import { SetupBadges } from "@/components/market/setup-badges";
import { Badge, Delta, RangeBar } from "@/components/ui/data";
import { Empty, PageHeader, Panel, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { date, price, volume } from "@/lib/format";
import { PRICE_SOURCE } from "@/lib/market";
import { isSetupKey, SETUPS } from "@/lib/setups";
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
  const setup = isSetupKey(str("setup")) ? str("setup") : "";
  const sort = SORTS[str("sort")] ? str("sort") : "size";
  const segment = (["sme", "etf", "index", "all"] as const).find((x) => x === str("segment")) ?? "equity";
  const page = pageParam(sp.page);

  let q = s.supabase.from("market_snapshot").select("*", { count: "exact" });
  if (segment !== "all") q = q.eq("segment", segment);
  if (sector) q = q.eq("sector", sector);
  if (signal === "buy" || signal === "exit") q = q.eq("last_signal", signal);
  if (rsi === "oversold") q = q.lte("rsi", 30);
  if (rsi === "overbought") q = q.gte("rsi", 70);
  if (setup) q = q.contains("setups", [setup]);
  q = q
    .order(SORTS[sort].col, { ascending: SORTS[sort].asc, nullsFirst: false })
    .order("symbol")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const [{ data, count }, radarRes] = await Promise.all([q, s.supabase.from("watchlist_items").select("symbol")]);
  const rows = ((data ?? []) as Quote[]).map(normalizeQuote);
  const total = count ?? rows.length;
  const params = Object.fromEntries(["sector", "signal", "rsi", "setup", "sort", "segment"].filter((k) => str(k)).map((k) => [k, str(k)]));
  const onRadar = new Set((radarRes.data ?? []).map((r) => r.symbol));
  const asOf = rows.find((r) => r.as_of)?.as_of;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={asOf ? `End of day · ${date(asOf)} · ${PRICE_SOURCE}` : `End of day · ${PRICE_SOURCE}`}
        title="Markets"
        description="Every NSE-listed stock, SME issue, major ETF and NSE index, with the last session's move, where it sits in its 52-week range, momentum, the most recent rule-based signal, and the chart setups its last close matched."
      />

      <SectorPulse />

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
            name: "setup",
            label: "Setup today",
            options: [{ value: "", label: "Any" }, ...SETUPS.map((x) => ({ value: x.key, label: x.label }))],
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

      {setup ? (
        <p className="-mt-3 text-[12.5px] text-muted-foreground" data-testid="setup-rule">
          <span className="font-medium text-foreground">{SETUPS.find((x) => x.key === setup)?.label}:</span>{" "}
          {SETUPS.find((x) => x.key === setup)?.rule} Tagged on each stock&apos;s last close. A setup is a rule match on a chart, not a recommendation.
        </p>
      ) : null}

      <Panel title={`${total.toLocaleString("en-IN")} ${segment === "index" ? "indices" : segment === "etf" ? "ETFs" : "symbols"}`} meta={sector || undefined}>
        {rows.length === 0 ? (
          <Empty title="Nothing matches.">Loosen a filter — oversold stocks in a single sector can be rare on any given day.</Empty>
        ) : (
          <>
          <details className="group mb-3 rounded-md border border-border bg-background/60 px-3 py-2 text-[12.5px]">
            <summary className="text-muted-foreground transition-colors hover:text-foreground">What do these columns mean?</summary>
            <dl className="mt-2 grid gap-x-6 gap-y-1.5 leading-5 sm:grid-cols-2">
              {[
                ["Last · Chg", "The last closing price, and how much it moved on that day."],
                ["Volume", "How many shares changed hands that day (L = lakh, Cr = crore)."],
                ["52-week range", "The lowest and highest close of the past year; the dot is where the price sits now."],
                ["RSI", "A 0–100 gauge of recent moves: 70 or more means it rose fast, 30 or less means it fell hard."],
                ["Signal", "The last time one of our rules fired on this stock: Buy or Exit. Research, not advice."],
                ["Setups", "Chart patterns the last close matched, such as a new 20-day high."],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="inline font-medium text-foreground">{k}: </dt>
                  <dd className="inline text-muted-foreground">{v}</dd>
                </div>
              ))}
            </dl>
          </details>
          <TableWrap>
            <table className="w-full min-w-[1040px]">
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
                  <th className={th}>Setups</th>
                  <th className={th + " w-10"}>
                    <span className="sr-only">Radar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.exchange + r.symbol} className={tr}>
                    <td className={td}>
                      <Link prefetch={false} href={`/app/markets/${encodeURIComponent(r.symbol)}`} className="group block">
                        <span className="num font-medium group-hover:underline">{r.symbol}</span>
                        <span className="block max-w-[200px] truncate text-[11.5px] text-muted-foreground">{r.name}</span>
                      </Link>
                    </td>
                    <td className={td + " max-w-[150px] truncate text-muted-foreground"} title={r.sector ?? undefined}>{r.sector ?? "—"}</td>
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
                    <td className={td}>
                      {r.setups?.length ? <SetupBadges tags={r.setups} /> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className={td + " text-right"}>
                      <RadarToggle symbol={r.symbol} exchange={r.exchange} onRadar={onRadar.has(r.symbol)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          </>
        )}
        <Pager path="/app/markets" params={params} page={page} pageSize={PAGE_SIZE} total={total} />
      </Panel>
    </div>
  );
}
