import type { Metadata } from "next";
import Link from "next/link";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ssr";
import { Delta, Stat } from "@/components/ui/data";
import { Empty, PageHeader, Panel, PlanGate, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { QuantumAudit } from "@/components/market/quantum-audit";
import { AiPortfolioDiagnostic } from "@/components/portfolio/ai-diagnostic";
import { ContractNoteModal } from "@/components/portfolio/contract-note-modal";
import { CsvImportModal } from "@/components/portfolio/csv-import";
import { date, isoDaysAgo, price, qty, rupees, rupeesCompact } from "@/lib/format";
import { groupSales, heldFor, type RealizedPart } from "@/lib/ledger";
import type { Holding, Portfolio } from "@/lib/types";
import { getQuotes, positions, summarize } from "@/server/market-data";
import { can, requireSession } from "@/server/session";
import { NewPortfolioForm, RecordTradeForm, RemoveHolding, UndoAdjustment } from "./forms";

export const metadata: Metadata = { title: "Portfolio" };

/** A stock's history page; the portfolio is named only when there are several. */
const historyHref = (symbol: string, portfolioId: string | null, portfolios: number) =>
  `/app/portfolio/${encodeURIComponent(symbol)}${portfolioId && portfolios > 1 ? `?p=${portfolioId}` : ""}`;

export default async function PortfolioPage({ searchParams }: PageProps<"/app/portfolio">) {
  const s = await requireSession();
  const sp = await searchParams;
  const sellSymbol = typeof sp.sell === "string" && /^[A-Z0-9&\-.]{1,20}$/.test(sp.sell) ? sp.sell : undefined;
  if (!can(s, "portfolio")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Holdings" title="Portfolio" description="Track what you own, your day and overall P&L, and how concentrated you are by sector." />
        <PlanGate feature="Portfolio tracking" />
      </div>
    );
  }

  const db = s.supabase;
  const [pfRes, hRes, aiKeysRes, aiConsentRes, adjRes, realizedRes] = await Promise.all([
    db.from("portfolios").select("id, name, source, created_at").order("created_at"),
    db.from("holdings").select("*"),
    can(s, "ai_byok")
      ? db.from("ai_provider_keys").select("id").eq("status", "active").neq("provider", "other").limit(1)
      : Promise.resolve({ data: [] }),
    db.from("user_consents").select("id").eq("purpose", "ai_processing").is("withdrawn_at", null).limit(1),
    // Split and bonus changes of the last 30 days that can still be undone (migration 50).
    db
      .from("holding_adjustments")
      .select("id, symbol, ex_date, factor, old_quantity, old_avg_price, new_quantity, new_avg_price")
      .is("undone_at", null)
      .gte("applied_at", isoDaysAgo(30))
      .order("applied_at", { ascending: false }),
    // Every sale, worked out by the ledger oldest shares first (migration 51).
    db
      .from("portfolio_realized")
      .select("sell_txn_id, symbol, buy_date, sell_date, quantity, buy_price, sell_price, cost, proceeds, gain, days_held")
      .order("sell_date", { ascending: false })
      .limit(5000),
  ]);
  const sales = groupSales((realizedRes.data ?? []) as RealizedPart[]);
  const realized = sales.reduce((a, x) => a + x.gain, 0);
  const realizedCost = sales.reduce((a, x) => a + x.cost, 0);
  const adjustments = (adjRes.data ?? []) as {
    id: string;
    symbol: string;
    ex_date: string;
    factor: number;
    old_quantity: number;
    old_avg_price: number;
    new_quantity: number;
    new_avg_price: number;
  }[];
  const portfolios = (pfRes.data ?? []) as Portfolio[];
  const holdings = (hRes.data ?? []) as Holding[];
  const quotes = await getQuotes(db, [...new Set(holdings.map((h) => h.symbol))]);
  const ps = positions(holdings, quotes).sort((a, b) => b.value - a.value);
  const sum = summarize(ps);

  const aiReason = !can(s, "ai_byok")
    ? "AI diagnostics with your own key are part of Pro."
    : !aiConsentRes.data?.length
      ? "Allow AI processing in Settings → Privacy, then add a key in"
      : !aiKeysRes.data?.length
        ? "Add an Anthropic, OpenAI or Gemini key in"
        : undefined;

  const bySector = new Map<string, number>();
  for (const p of ps) bySector.set(p.holding.sector ?? "Other", (bySector.get(p.holding.sector ?? "Other") ?? 0) + p.value);
  const sectors = [...bySector.entries()].sort((a, b) => b[1] - a[1]);
  const ent = s.entitlements;

  const quantumStocks = ps.map((p) => ({
    symbol: p.holding.symbol,
    entryBase: p.holding.avg_price,
    entryDate: date(p.holding.created_at),
    lastPrice: p.quote?.last_price ?? p.holding.avg_price,
    rsi: p.quote?.rsi,
    quantity: p.holding.quantity,
    source: "holding" as const,
  }));

  const diagnosticPositions = ps.map((p) => ({
    symbol: p.holding.symbol,
    quantity: p.holding.quantity,
    avgPrice: p.holding.avg_price,
    lastPrice: p.quote?.last_price ?? p.holding.avg_price,
    value: p.value,
    invested: p.invested,
    totalPnl: p.totalPnl,
    totalPct: p.totalPct,
    sector: p.holding.sector || p.quote?.sector || "Other",
    rsi: p.quote?.rsi,
    changePct: p.quote?.change_pct,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Holdings"
        title="Portfolio"
        description="Valued at the last close. Only you can see this — workspace admins can't, and neither can our support dashboard."
        actions={
          <div className="flex items-center gap-2.5">
            {ent?.max_portfolio_symbols != null ? (
              <span className="num text-[12px] text-muted-foreground mr-1">
                {ent.portfolio_symbols_used}/{ent.max_portfolio_symbols} symbols
              </span>
            ) : null}
            <CsvImportModal portfolios={portfolios} />
            <ContractNoteModal portfolios={portfolios} ready={!aiReason} reason={aiReason} />
          </div>
        }
      />

      <section className="panel grid grid-cols-2 md:grid-cols-5 md:divide-x md:divide-border" data-testid="portfolio-stats">
        <Stat className="p-4" label="Current value" value={rupeesCompact(sum.value)} sub={rupees(sum.value)} />
        <Stat className="p-4" label="Invested" value={rupeesCompact(sum.invested)} sub={`${ps.length} position${ps.length === 1 ? "" : "s"}`} />
        <Stat className="p-4" label="Day's P&L" value={<Delta value={sum.dayPnl} kind="inr" />} sub={<Delta value={sum.dayPct} />} />
        <Stat className="p-4" label="On shares you hold" value={<Delta value={sum.totalPnl} kind="inr" />} sub={<Delta value={sum.totalPct} />} />
        <Stat
          className="p-4"
          label="Realized gain"
          value={<Delta value={sales.length ? realized : null} kind="inr" />}
          sub={sales.length ? <Delta value={realizedCost ? (realized / realizedCost) * 100 : null} /> : "nothing sold yet"}
        />
      </section>

      {adjustments.length ? (
        <Panel title="Split and bonus changes" meta="last 30 days" id="adjustments">
          <p className="mb-3 max-w-2xl text-[13px] leading-5 text-muted-foreground">
            When a company splits its shares or gives bonus shares, we change your quantity and average price so your
            gain or loss stays right. The money you put in stays the same. If your broker shows other numbers, undo it.
          </p>
          <ul className="divide-y divide-border/60">
            {adjustments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[13px]">
                <span>
                  <Link href={`/app/markets/${encodeURIComponent(a.symbol)}`} className="font-medium hover:underline">
                    {a.symbol}
                  </Link>
                  <span className="text-muted-foreground"> · from {date(a.ex_date)}, each share became {qty(a.factor)} shares</span>
                  <span className="num mt-0.5 block text-[12px] text-muted-foreground">
                    {qty(a.old_quantity)} at {rupees(a.old_avg_price)} → {qty(a.new_quantity)} at {rupees(a.new_avg_price)}
                  </span>
                </span>
                <UndoAdjustment id={a.id} symbol={a.symbol} />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="Record a trade">
        <RecordTradeForm
          portfolios={portfolios}
          held={holdings.map((h) => ({ symbol: h.symbol, quantity: Number(h.quantity) }))}
          initial={sellSymbol ? { kind: "sell", symbol: sellSymbol } : undefined}
        />
      </Panel>

      {ps.length > 0 ? (
        <Panel
          title="Portfolio AI Diagnostic (BYOK)"
          meta="Concentration, HHI, sector balance & risk audit"
        >
          <AiPortfolioDiagnostic
            portfolioId={portfolios[0]?.id}
            ready={!aiReason}
            reason={aiReason}
            positions={diagnosticPositions}
          />
        </Panel>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Positions" meta={ps.length ? "sorted by value" : undefined}>
          {ps.length === 0 ? (
            <Empty title="No holdings yet.">
              Record your first buy above, or import what you hold from your broker. Prices are valued at the last close.
            </Empty>
          ) : (
            <TableWrap>
              <table className="w-full min-w-[900px]" data-testid="positions">
                <thead>
                  <tr>
                    <th className={th}>Symbol</th>
                    <th className={thNum}>Qty</th>
                    <th className={thNum}>Avg cost</th>
                    <th className={thNum}>LTP</th>
                    <th className={thNum}>Value</th>
                    <th className={thNum}>Day</th>
                    <th className={thNum}>P&amp;L</th>
                    <th className={thNum}>Weight</th>
                    <th className={th}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ps.map((p) => {
                    const pf = portfolios.find((x) => x.id === p.holding.portfolio_id);
                    return (
                      <tr key={p.holding.id} className={tr}>
                        <td className={td}>
                          <Link prefetch={false} href={`/app/markets/${encodeURIComponent(p.holding.symbol)}`} className="num font-medium hover:underline">
                            {p.holding.symbol}
                          </Link>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            {portfolios.length > 1 ? pf?.name : null}
                          </span>
                        </td>
                        <td className={tdNum}>{qty(p.holding.quantity)}</td>
                        <td className={tdNum}>{price(p.holding.avg_price)}</td>
                        <td className={tdNum}>{price(p.quote?.last_price)}</td>
                        <td className={tdNum}>{rupees(p.value)}</td>
                        <td className={tdNum}>
                          <Delta value={p.dayPnl} kind="abs" showGlyph={false} />
                        </td>
                        <td className={tdNum}>
                          <Delta value={p.totalPnl} kind="abs" showGlyph={false} />
                          <span className="block text-[11px]">
                            <Delta value={p.totalPct} />
                          </span>
                        </td>
                        <td className={tdNum + " text-muted-foreground"}>{sum.value ? ((p.value / sum.value) * 100).toFixed(1) : "0.0"}%</td>
                        <td className={td + " text-right"}>
                          <span className="inline-flex items-center gap-1">
                            <Link
                              prefetch={false}
                              href={historyHref(p.holding.symbol, p.holding.portfolio_id, portfolios.length)}
                              aria-label={`History of ${p.holding.symbol}`}
                              title={`Trades and gains for ${p.holding.symbol}`}
                              className="inline-grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                            >
                              <ClockCounterClockwiseIcon size={15} aria-hidden />
                            </Link>
                            <Link
                              prefetch={false}
                              href={`/app/portfolio?sell=${encodeURIComponent(p.holding.symbol)}#record`}
                              aria-label={`Sell ${p.holding.symbol}`}
                              className="inline-flex h-7 items-center rounded-md px-2 text-[12px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                            >
                              Sell
                            </Link>
                            <RemoveHolding id={p.holding.id} symbol={p.holding.symbol} />
                          </span>
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
          <Panel title="By sector">
            {sectors.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Allocation appears once you add holdings.</p>
            ) : (
              <ul className="flex flex-col gap-3" aria-label="Allocation by sector">
                {sectors.map(([name, value]) => {
                  const w = sum.value ? (value / sum.value) * 100 : 0;
                  return (
                    <li key={name}>
                      <div className="flex items-baseline justify-between text-[12.5px]">
                        <span>{name}</span>
                        <span className="num text-muted-foreground">{w.toFixed(1)}%</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-foreground/[0.07]">
                        <div className="bar-fill h-full rounded-full bg-primary" style={{ width: `${w}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {sectors[0] && sum.value && sectors[0][1] / sum.value > 0.4 ? (
              <p className="mt-4 border-t border-border pt-3 text-[12px] leading-5 text-muted-foreground">
                {sectors[0][0]} is {((sectors[0][1] / sum.value) * 100).toFixed(0)}% of your portfolio. Worth knowing before the next sector-wide move.
              </p>
            ) : null}
          </Panel>

          <Panel title="Portfolios" meta={`${portfolios.length}`}>
            <ul className="mb-4 flex flex-col gap-1.5 text-[13px]">
              {portfolios.map((p) => (
                <li key={p.id} className="flex items-center justify-between">
                  <span>{p.name}</span>
                  <span className="text-[11.5px] capitalize text-muted-foreground">{p.source}</span>
                </li>
              ))}
            </ul>
            <NewPortfolioForm />
          </Panel>
        </div>
      </div>

      <Panel title="What you've sold" meta={sales.length ? `${sales.length} sale${sales.length === 1 ? "" : "s"} · oldest shares sold first` : undefined} id="sales">
        {sales.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">When you record a sale, what it made after charges shows here.</p>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[760px]" data-testid="sales">
              <thead>
                <tr>
                  <th className={th}>Sold</th>
                  <th className={th}>Symbol</th>
                  <th className={thNum}>Qty</th>
                  <th className={thNum}>Bought at</th>
                  <th className={thNum}>Sold at</th>
                  <th className={thNum}>Gain after charges</th>
                  <th className={th}>Held</th>
                </tr>
              </thead>
              <tbody>
                {sales.slice(0, 25).map((x) => (
                  <tr key={x.sellTxnId} className={tr}>
                    <td className={td + " num text-muted-foreground"}>{date(x.sellDate)}</td>
                    <td className={td}>
                      <Link prefetch={false} href={historyHref(x.symbol, null, 1)} className="num font-medium hover:underline">
                        {x.symbol}
                      </Link>
                    </td>
                    <td className={tdNum}>{qty(x.quantity)}</td>
                    <td className={tdNum}>{price(x.avgBuyPrice)}</td>
                    <td className={tdNum}>{price(x.sellPrice)}</td>
                    <td className={tdNum}>
                      <Delta value={x.gain} kind="inr" />
                      <span className="block text-[11px]">
                        <Delta value={x.gainPct} />
                      </span>
                    </td>
                    <td className={td + " text-[12px] text-muted-foreground"}>{heldFor(x)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      {quantumStocks.length > 0 ? (
        <Panel
          title="How stretched are your stocks?"
          meta="RSI in plain words: which holdings ran up fast, which fell hard"
        >
          <QuantumAudit stocks={quantumStocks} defaultSource="holding" />
        </Panel>
      ) : null}
    </div>
  );
}
