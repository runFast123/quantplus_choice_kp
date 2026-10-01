import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRightIcon } from "@phosphor-icons/react/ssr";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Delta, Sparkline, Stat } from "@/components/ui/data";
import { Empty, Panel, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { daysUntil, date, isoDaysAgo, longDate, pct, price, relative, rupeesCompact, strategyLabel } from "@/lib/format";
import { nseSession } from "@/lib/market";
import type { Holding, Quote, Signal, WatchlistItem } from "@/lib/types";
import { getQuotes, getSparks, positions, summarize } from "@/server/market-data";
import { can, displayName, requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Overview" };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function OverviewPage() {
  const s = await requireSession();
  const db = s.supabase;

  const { data: consents } = await db.from("user_consents").select("purpose").eq("purpose", "terms").is("withdrawn_at", null).limit(1);
  if (!consents?.length) redirect("/app/welcome");

  const since = isoDaysAgo(14);
  const [itemsRes, holdingsRes, allQuotes] = await Promise.all([
    db.from("watchlist_items").select("id, watchlist_id, symbol, exchange, added_at").order("added_at"),
    can(s, "portfolio") ? db.from("holdings").select("*") : Promise.resolve({ data: [] as Holding[] }),
    getQuotes(db),
  ]);

  const items = (itemsRes.data ?? []) as WatchlistItem[];
  const radarSymbols = [...new Set(items.map((i) => i.symbol))];
  const holdings = (holdingsRes.data ?? []) as Holding[];
  const tracked = [...new Set([...radarSymbols, ...holdings.map((h) => h.symbol)])];

  const [sparks, signalsRes] = await Promise.all([
    getSparks(db, radarSymbols, 45),
    tracked.length
      ? db.from("trading_signals").select("*").in("symbol", tracked).gte("generated_at", since).order("generated_at", { ascending: false }).limit(12)
      : Promise.resolve({ data: [] as Signal[] }),
  ]);
  const signals = (signalsRes.data ?? []) as Signal[];

  const ps = positions(holdings, allQuotes);
  const port = summarize(ps);
  const leader = [...ps].sort((a, b) => Math.abs(b.dayPnl) - Math.abs(a.dayPnl))[0];

  const quotes = [...allQuotes.values()].filter((q) => q.change_pct != null);
  const advancers = quotes.filter((q) => (q.change_pct ?? 0) > 0).length;
  const decliners = quotes.filter((q) => (q.change_pct ?? 0) < 0).length;
  const movers = [...quotes].sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0));
  const asOf = quotes[0]?.as_of;

  const ent = s.entitlements;
  const expiringIn = ent ? daysUntil(ent.current_period_end) : null;
  const session = nseSession();

  // The desk note: one plain sentence assembled from the numbers, not generated prose.
  const note =
    holdings.length && leader
      ? `Your portfolio closed ${port.dayPnl >= 0 ? "up" : "down"} ${pct(Math.abs(port.dayPct)).replace(/^[+−]/, "")} on the last session, ${
          leader.dayPnl >= 0 ? "led" : "dragged"
        } by ${leader.holding.symbol}. ${signals.length ? `${signals.length} signal${signals.length > 1 ? "s" : ""} fired on stocks you follow in the past fortnight.` : "No signals on your stocks this fortnight."}`
      : radarSymbols.length
        ? `${radarSymbols.length} stock${radarSymbols.length > 1 ? "s" : ""} on your radar; ${
            signals.length ? `${signals.length} signal${signals.length > 1 ? "s" : ""} fired on them in the past fortnight.` : "none of them has signalled in the past fortnight."
          } Breadth across the tape: ${advancers} up, ${decliners} down.`
        : `Breadth on the last session: ${advancers} advancing, ${decliners} declining. Add a few stocks to your Market Radar and this page starts working for you.`;

  return (
    <div className="flex flex-col gap-6">
      <header className="grid gap-6 border-b border-border pb-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <p className="eyebrow">
            {longDate(new Date())} · NSE {session.label.toLowerCase()}
            {asOf ? ` · last close ${date(asOf)}` : ""}
          </p>
          <h1 className="display mt-2 text-[34px] leading-[1.08] md:text-[44px]">
            {greeting()}, <em>{displayName(s).split(" ")[0]}</em>.
          </h1>
          <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-muted-foreground">{note}</p>
        </div>
        {ent && expiringIn != null && expiringIn <= 14 ? (
          <div className="panel flex items-center gap-4 border-coral/50 p-4">
            <div>
              <p className="text-[13px] font-medium">
                {ent.plan_name} {ent.status === "trialing" ? "trial" : "plan"} ends in {Math.max(expiringIn, 0)} day{expiringIn === 1 ? "" : "s"}
              </p>
              <p className="text-[12px] text-muted-foreground">Renew to keep your radar and alerts running.</p>
            </div>
            <ButtonLink href="/app/billing" size="sm" variant="coral">
              Renew
            </ButtonLink>
          </div>
        ) : null}
      </header>

      <section aria-label="Summary" className="panel grid grid-cols-2 divide-border md:grid-cols-4 md:divide-x">
        {can(s, "portfolio") ? (
          <>
            <Stat className="p-4" label="Portfolio value" value={rupeesCompact(port.value)} sub={`${holdings.length} holding${holdings.length === 1 ? "" : "s"}`} />
            <Stat className="p-4" label="Day's P&L" value={<Delta value={port.dayPnl} kind="abs" />} sub={<Delta value={port.dayPct} />} />
            <Stat className="p-4" label="Overall P&L" value={<Delta value={port.totalPnl} kind="abs" />} sub={<Delta value={port.totalPct} />} />
          </>
        ) : (
          <div className="col-span-2 flex flex-col justify-center gap-1 p-4 md:col-span-3">
            <span className="eyebrow">Portfolio</span>
            <p className="text-[13px] text-muted-foreground">
              Track holdings, day and overall P&amp;L on Pro.{" "}
              <Link href="/app/billing" className="text-foreground underline underline-offset-4">
                Compare plans
              </Link>
            </p>
          </div>
        )}
        <Stat
          className="p-4"
          label="Radar slots"
          value={
            <>
              {ent?.watchlist_symbols_used ?? radarSymbols.length}
              <span className="text-muted-foreground">/{ent?.max_watchlist_symbols ?? "∞"}</span>
            </>
          }
          sub={ent ? ent.plan_name : "—"}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel
          title="Market Radar"
          meta={radarSymbols.length ? `${radarSymbols.length} stocks · last 45 sessions` : undefined}
          actions={
            <Link href="/app/watchlist" className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
              Manage <ArrowUpRightIcon size={12} aria-hidden />
            </Link>
          }
        >
          {radarSymbols.length === 0 ? (
            <Empty title="Your radar is empty." action={<ButtonLink href="/app/markets" size="sm">Browse the market</ButtonLink>}>
              Add up to {ent?.max_watchlist_symbols ?? 10} stocks. We&apos;ll chart them here and flag every signal that fires.
            </Empty>
          ) : (
            <TableWrap>
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr>
                    <th className={th}>Symbol</th>
                    <th className={thNum}>Last</th>
                    <th className={thNum}>Chg</th>
                    <th className={th + " text-center"}>45 sessions</th>
                    <th className={thNum}>RSI 14</th>
                    <th className={th}>Last signal</th>
                  </tr>
                </thead>
                <tbody>
                  {radarSymbols.map((sym) => {
                    const q = allQuotes.get(sym);
                    return (
                      <tr key={sym} className={tr}>
                        <td className={td}>
                          <Link href={`/app/markets/${encodeURIComponent(sym)}`} className="group block">
                            <span className="num font-medium group-hover:underline">{sym}</span>
                            <span className="block max-w-[180px] truncate text-[11.5px] text-muted-foreground">{q?.name}</span>
                          </Link>
                        </td>
                        <td className={tdNum}>{price(q?.last_price)}</td>
                        <td className={tdNum}>
                          <Delta value={q?.change_pct} />
                        </td>
                        <td className={td + " text-center"}>
                          <Sparkline values={sparks.get(sym) ?? []} className="inline-block" />
                        </td>
                        <td className={tdNum}>
                          <RsiCell rsi={q?.rsi ?? null} />
                        </td>
                        <td className={td}>
                          {q?.last_signal ? (
                            <span className="inline-flex items-center gap-2">
                              <Badge tone={q.last_signal === "buy" ? "gain" : "loss"}>{q.last_signal === "buy" ? "BUY" : "EXIT"}</Badge>
                              <span className="text-[11.5px] text-muted-foreground">{relative(q.last_signal_at)}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title="Signals on your stocks" meta="14 days" bodyClassName="p-0">
            {signals.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-muted-foreground">Quiet fortnight. Signals for stocks on your radar or in your portfolio appear here.</p>
            ) : (
              <ol>
                {signals.map((sg) => (
                  <li key={sg.id} className="flex items-start gap-3 border-b border-border/70 px-4 py-3 last:border-0">
                    <Badge tone={sg.signal_type === "buy" ? "gain" : "loss"} className="mt-0.5 w-11 justify-center">
                      {sg.signal_type === "buy" ? "BUY" : "EXIT"}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <Link href={`/app/markets/${encodeURIComponent(sg.symbol)}`} className="num text-[13px] font-medium hover:underline">
                        {sg.symbol}
                      </Link>
                      <p className="text-[12px] text-muted-foreground">
                        {strategyLabel[sg.strategy] ?? sg.strategy} at <span className="num">{price(Number(sg.payload.close))}</span>
                      </p>
                    </div>
                    <span className="num shrink-0 text-[11px] text-muted-foreground">{relative(sg.generated_at)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="Breadth" meta={`${quotes.length} stocks tracked`}>
            <BreadthBar up={advancers} down={decliners} />
            <div className="mt-4 grid grid-cols-2 gap-4">
              <MoverList title="Leaders" rows={movers.slice(0, 4)} />
              <MoverList title="Laggards" rows={movers.slice(-4).reverse()} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function RsiCell({ rsi }: { rsi: number | null }) {
  if (rsi == null) return <span className="text-muted-foreground">—</span>;
  const zone = rsi >= 70 ? "overbought" : rsi <= 30 ? "oversold" : null;
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      {zone ? <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{zone === "overbought" ? "OB" : "OS"}</span> : null}
      <span className={zone ? "font-semibold" : undefined}>{rsi.toFixed(1)}</span>
    </span>
  );
}

function BreadthBar({ up, down }: { up: number; down: number }) {
  const total = up + down || 1;
  return (
    <div>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`${up} advancing, ${down} declining`}>
        <span className="h-full rounded-l-full bg-gain" style={{ width: `${(up / total) * 100}%` }} />
        <span className="h-full rounded-r-full bg-loss" style={{ width: `${(down / total) * 100}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-[12px]">
        <span className="num text-gain">▲ {up} advancing</span>
        <span className="num text-loss">{down} declining ▼</span>
      </div>
    </div>
  );
}

function MoverList({ title, rows }: { title: string; rows: Quote[] }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-1.5">{title}</p>
      <ul className="flex flex-col gap-1.5">
        {rows.map((q) => (
          <li key={q.symbol} className="flex items-baseline justify-between gap-2 text-[12.5px]">
            <Link href={`/app/markets/${encodeURIComponent(q.symbol)}`} className="num truncate hover:underline">
              {q.symbol}
            </Link>
            <Delta value={q.change_pct} showGlyph={false} className="text-[12px]" />
          </li>
        ))}
      </ul>
    </div>
  );
}
