import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { TrashIcon } from "@phosphor-icons/react/ssr";
import { AddSymbolForm } from "@/components/market/add-symbol-form";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Badge, Delta, Sparkline } from "@/components/ui/data";
import { Empty, PageHeader, Panel, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { date, price } from "@/lib/format";
import type { Watchlist, WatchlistItem } from "@/lib/types";
import { QuantumAudit } from "@/components/market/quantum-audit";
import { RetiredNote } from "@/components/market/retired-note";
import { getQuotes, getRetired, getSparks } from "@/server/market-data";
import { requireSession } from "@/server/session";
import { deleteWatchlist, removeFromRadar } from "./actions";
import { NewListForm } from "./new-list-form";

export const metadata: Metadata = { title: "Market Radar" };

export default async function WatchlistPage({ searchParams }: PageProps<"/app/watchlist">) {
  const s = await requireSession();
  const sp = await searchParams;
  const db = s.supabase;

  const [listsRes, itemsRes] = await Promise.all([
    db.from("watchlists").select("id, name, created_at").order("created_at"),
    db.from("watchlist_items").select("id, watchlist_id, symbol, exchange, added_at").order("added_at"),
  ]);
  const lists = (listsRes.data ?? []) as Watchlist[];
  const allItems = (itemsRes.data ?? []) as WatchlistItem[];
  const activeId = (typeof sp.list === "string" && lists.find((l) => l.id === sp.list)?.id) || lists[0]?.id;
  const items = allItems.filter((i) => i.watchlist_id === activeId);
  const symbols = items.map((i) => i.symbol);

  const [quotes, sparks] = await Promise.all([getQuotes(db, symbols), getSparks(db, symbols, 60)]);
  const retired = await getRetired(db, symbols.filter((sym) => !quotes.has(sym)));

  const ent = s.entitlements;
  const used = ent?.watchlist_symbols_used ?? new Set(allItems.map((i) => i.symbol)).size;
  const limit = ent?.max_watchlist_symbols ?? null;
  const full = limit != null && used >= limit;
  const expired = !ent?.features?.watchlist;

  const radarQuantumStocks = items
    .map((i) => {
      const q = quotes.get(i.symbol);
      if (!q?.last_price) return null;
      return {
        symbol: i.symbol,
        entryBase: q.last_price,
        entryDate: date(i.added_at),
        lastPrice: q.last_price,
        rsi: q.rsi,
        source: "radar" as const,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Watchlists"
        title="Market Radar"
        description="The stocks you're waiting on. Each one is checked against every rule after the close; when one fires, it shows up here and on your overview."
        actions={
          <div className="min-w-[220px]">
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="text-muted-foreground">Symbols used</span>
              <span className="num">
                {used}
                <span className="text-muted-foreground">/{limit ?? "∞"}</span>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/10" role="meter" aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit ?? used} aria-label="Radar symbols used">
              <div className={clsx("h-full rounded-full", full ? "bg-coral" : "bg-primary")} style={{ width: limit ? `${Math.min(100, (used / limit) * 100)}%` : "8%" }} />
            </div>
            {full ? (
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                Radar full.{" "}
                <Link href="/app/billing" className="text-foreground underline underline-offset-4">
                  Upgrade for more
                </Link>
              </p>
            ) : null}
          </div>
        }
      />

      {lists.length > 0 ? (
        <nav aria-label="Lists" className="-mb-2 flex flex-wrap items-center gap-1.5">
          {lists.map((l) => {
            const n = allItems.filter((i) => i.watchlist_id === l.id).length;
            const active = l.id === activeId;
            return (
              <Link
                key={l.id}
                href={`/app/watchlist?list=${l.id}`}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "inline-flex h-8 items-center gap-2 rounded-md border px-3 text-[13px] transition-colors",
                  active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-muted-foreground/50",
                )}
              >
                {l.name}
                <span className={clsx("num text-[11px]", active ? "opacity-70" : "text-muted-foreground")}>{n}</span>
              </Link>
            );
          })}
          <NewListForm />
        </nav>
      ) : null}

      <Panel
        title={lists.find((l) => l.id === activeId)?.name ?? "Market Radar"}
        meta={items.length ? `${items.length} stocks` : undefined}
        actions={
          lists.length > 1 && activeId ? (
            <ConfirmButton label="Delete this list" confirmLabel="Delete list" onConfirm={deleteWatchlist.bind(null, activeId)}>
              Delete list
            </ConfirmButton>
          ) : null
        }
      >
        <div className="mb-4 max-w-xl">
          <AddSymbolForm watchlistId={activeId} disabled={expired} />
          {expired ? <p className="mt-2 text-[12px] text-loss">Your plan has expired — renew to add symbols.</p> : null}
        </div>

        {items.length === 0 ? (
          <Empty title="Nothing on this list yet.">
            Start with names you already know. You can also add from{" "}
            <Link href="/app/markets?rsi=oversold" className="text-foreground underline underline-offset-4">
              oversold stocks
            </Link>{" "}
            in Markets.
          </Empty>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[760px]">
              <thead>
                <tr>
                  <th className={th}>Symbol</th>
                  <th className={thNum}>Last</th>
                  <th className={thNum}>Chg</th>
                  <th className={th + " text-center"}>60 sessions</th>
                  <th className={thNum}>RSI</th>
                  <th className={th}>Signal</th>
                  <th className={th}>Added</th>
                  <th className={th}>
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const q = quotes.get(i.symbol);
                  return (
                    <tr key={i.id} className={tr}>
                      <td className={td}>
                        <Link href={`/app/markets/${encodeURIComponent(i.symbol)}`} className="group block">
                          <span className="num font-medium group-hover:underline">{i.symbol}</span>
                          <span className="block max-w-[200px] truncate text-[11.5px] text-muted-foreground">{q?.name ?? retired.get(i.symbol)?.name}</span>
                        </Link>
                        {retired.get(i.symbol) ? <RetiredNote r={retired.get(i.symbol)!} /> : null}
                      </td>
                      <td className={tdNum}>{price(q?.last_price)}</td>
                      <td className={tdNum}>
                        <Delta value={q?.change_pct} />
                      </td>
                      <td className={td + " text-center"}>
                        <Sparkline values={sparks.get(i.symbol) ?? []} width={120} className="inline-block" />
                      </td>
                      <td className={tdNum}>{q?.rsi != null ? q.rsi.toFixed(1) : "—"}</td>
                      <td className={td}>
                        {q?.last_signal ? <Badge tone={q.last_signal === "buy" ? "gain" : "loss"}>{q.last_signal === "buy" ? "BUY" : "EXIT"}</Badge> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className={td + " num text-muted-foreground"}>{date(i.added_at)}</td>
                      <td className={td + " text-right"}>
                        <ConfirmButton label={`Remove ${i.symbol}`} confirmLabel="Remove" onConfirm={removeFromRadar.bind(null, i.id)}>
                          <TrashIcon size={15} aria-hidden />
                        </ConfirmButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      {radarQuantumStocks.length > 0 ? (
        <Panel
          title="Radar Sentiment Audit"
          meta="Systematic RSI exhaustion nodes & momentum analysis"
        >
          <QuantumAudit stocks={radarQuantumStocks} defaultSource="radar" />
        </Panel>
      ) : null}
    </div>
  );
}
