import type { Metadata } from "next";
import Link from "next/link";
import { TrashIcon } from "@phosphor-icons/react/ssr";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Delta, Stat } from "@/components/ui/data";
import { Empty, PageHeader, Panel, PlanGate, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { QuantumAudit } from "@/components/market/quantum-audit";
import { AiPortfolioDiagnostic } from "@/components/portfolio/ai-diagnostic";
import { ContractNoteModal } from "@/components/portfolio/contract-note-modal";
import { CsvImportModal } from "@/components/portfolio/csv-import";
import { date, price, qty, rupees, rupeesCompact } from "@/lib/format";
import type { Holding, Portfolio } from "@/lib/types";
import { getQuotes, positions, summarize } from "@/server/market-data";
import { can, requireSession } from "@/server/session";
import { deleteHolding } from "./actions";
import { AddHoldingForm, EditHolding, NewPortfolioForm } from "./forms";

export const metadata: Metadata = { title: "Portfolio" };

export default async function PortfolioPage() {
  const s = await requireSession();
  if (!can(s, "portfolio")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Holdings" title="Portfolio" description="Track what you own, your day and overall P&L, and how concentrated you are by sector." />
        <PlanGate feature="Portfolio tracking" />
      </div>
    );
  }

  const db = s.supabase;
  const [pfRes, hRes, aiKeysRes, aiConsentRes] = await Promise.all([
    db.from("portfolios").select("id, name, source, created_at").order("created_at"),
    db.from("holdings").select("*"),
    can(s, "ai_byok")
      ? db.from("ai_provider_keys").select("id").eq("status", "active").neq("provider", "other").limit(1)
      : Promise.resolve({ data: [] }),
    db.from("user_consents").select("id").eq("purpose", "ai_processing").is("withdrawn_at", null).limit(1),
  ]);
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

      <section className="panel grid grid-cols-2 md:grid-cols-4 md:divide-x md:divide-border">
        <Stat className="p-4" label="Current value" value={rupeesCompact(sum.value)} sub={rupees(sum.value)} />
        <Stat className="p-4" label="Invested" value={rupeesCompact(sum.invested)} sub={`${ps.length} position${ps.length === 1 ? "" : "s"}`} />
        <Stat className="p-4" label="Day's P&L" value={<Delta value={sum.dayPnl} kind="abs" />} sub={<Delta value={sum.dayPct} />} />
        <Stat className="p-4" label="Overall P&L" value={<Delta value={sum.totalPnl} kind="abs" />} sub={<Delta value={sum.totalPct} />} />
      </section>

      <Panel title="Add a holding">
        <AddHoldingForm portfolios={portfolios} />
      </Panel>

      {ps.length > 0 ? (
        <Panel
          title="Portfolio AI Diagnostic"
          meta="Concentration, HHI & sector balance"
        >
          <AiPortfolioDiagnostic
            portfolioId={portfolios[0]?.id}
            ready={!aiReason}
            reason={aiReason}
          />
        </Panel>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Positions" meta={ps.length ? "sorted by value" : undefined}>
          {ps.length === 0 ? (
            <Empty title="No holdings yet.">
              Add them by hand above. Prices are valued at the last close.
            </Empty>
          ) : (
            <TableWrap>
              <table className="w-full min-w-[900px]">
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
                          <Link href={`/app/markets/${encodeURIComponent(p.holding.symbol)}`} className="num font-medium hover:underline">
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
                            {p.holding.source === "manual" ? (
                              <EditHolding id={p.holding.id} quantity={p.holding.quantity} avgPrice={p.holding.avg_price} symbol={p.holding.symbol} />
                            ) : null}
                            <ConfirmButton label={`Remove ${p.holding.symbol}`} confirmLabel="Remove" onConfirm={deleteHolding.bind(null, p.holding.id)}>
                              <TrashIcon size={15} aria-hidden />
                            </ConfirmButton>
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
                        <div className="h-full rounded-full bg-primary" style={{ width: `${w}%` }} />
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

      {quantumStocks.length > 0 ? (
        <Panel
          title="Quantum Sentiment Audit"
          meta="Exhaustion nodes, base deltas & systematic action guidance"
        >
          <QuantumAudit stocks={quantumStocks} defaultSource="holding" />
        </Panel>
      ) : null}
    </div>
  );
}
