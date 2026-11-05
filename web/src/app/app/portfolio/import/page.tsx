import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import { PageHeader, Panel, PlanGate } from "@/components/ui/layout";
import { TradebookImport, UndoImport } from "@/components/portfolio/tradebook-import";
import { date, dateTime } from "@/lib/format";
import { BROKERS } from "@/lib/tradebook";
import { can, requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Import trades" };

const brokerName = (key: string) => (key === "contract_note" ? "Contract note" : (BROKERS.find((b) => b.key === key)?.name ?? key));

/** Import a broker's tradebook (ADR-047), and every earlier import with Undo. */
export default async function ImportTradesPage() {
  const s = await requireSession();
  const header = (
    <>
      <Link href="/app/portfolio" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon size={14} aria-hidden /> Portfolio
      </Link>
      <PageHeader
        eyebrow="Portfolio"
        title="Import your trades"
        description="Bring in every buy and sell from your broker's tradebook, so your portfolio knows what you paid, when, and what each sale made."
      />
    </>
  );
  if (!can(s, "portfolio")) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <PlanGate feature="Portfolio tracking" />
      </div>
    );
  }

  const [pfRes, impRes] = await Promise.all([
    s.supabase.from("portfolios").select("id, name").order("created_at"),
    s.supabase
      .from("portfolio_imports")
      .select("id, portfolio_id, broker, trades_added, duplicates, skipped, date_from, date_to, created_at, replaced_openings")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const portfolios = pfRes.data ?? [];
  const imports = impRes.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      {header}
      <Panel>
        <TradebookImport portfolios={portfolios} holdingsUsed={s.entitlements?.portfolio_symbols_used ?? 0} />
      </Panel>

      <Panel title="Your imports" meta={imports.length ? `${imports.length}` : undefined} id="imports">
        {imports.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nothing imported yet. Each import is listed here and can be undone as a whole.</p>
        ) : (
          <ul className="divide-y divide-border/60" data-testid="imports">
            {imports.map((i) => {
              const replaced = Array.isArray(i.replaced_openings) ? i.replaced_openings.length : 0;
              const label = `${brokerName(i.broker)} import of ${dateTime(i.created_at)}`;
              return (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[13px]">
                  <span>
                    <span className="font-medium">{brokerName(i.broker)}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {i.trades_added} trade{i.trades_added === 1 ? "" : "s"}
                      {i.date_from ? `, ${date(i.date_from)}${i.date_to && i.date_to !== i.date_from ? ` to ${date(i.date_to)}` : ""}` : ""}
                    </span>
                    <span className="block text-[12px] text-muted-foreground">
                      Imported {dateTime(i.created_at)}
                      {i.duplicates ? ` · ${i.duplicates} already there` : ""}
                      {i.skipped ? ` · ${i.skipped} rows left out` : ""}
                      {replaced ? ` · replaced ${replaced} opening balance${replaced === 1 ? "" : "s"} (undo puts ${replaced === 1 ? "it" : "them"} back)` : ""}
                      {portfolios.length > 1 ? ` · ${portfolios.find((p) => p.id === i.portfolio_id)?.name ?? ""}` : ""}
                    </span>
                  </span>
                  <UndoImport id={i.id} label={label} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
