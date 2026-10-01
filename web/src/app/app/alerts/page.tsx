import type { Metadata } from "next";
import Link from "next/link";
import { TrashIcon } from "@phosphor-icons/react/ssr";
import { AlertForm } from "@/components/market/alert-form";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Badge } from "@/components/ui/data";
import { Empty, PageHeader, Panel, PlanGate, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { dateTime, pct, price, relative } from "@/lib/format";
import type { PriceAlert } from "@/lib/types";
import { getQuotes } from "@/server/market-data";
import { can, requireSession } from "@/server/session";
import { AlertStatusToggle } from "./status-toggle";
import { deleteAlert } from "./actions";

export const metadata: Metadata = { title: "Alerts" };

export default async function AlertsPage() {
  const s = await requireSession();
  if (!can(s, "alerts")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Price levels" title="Alerts" description="Get told when a stock crosses a level you care about." />
        <PlanGate feature="Price alerts" />
      </div>
    );
  }

  const { data } = await s.supabase.from("price_alerts").select("*").order("created_at", { ascending: false });
  const alerts = (data ?? []) as PriceAlert[];
  const quotes = await getQuotes(s.supabase, [...new Set(alerts.map((a) => a.symbol))]);
  const armed = alerts.filter((a) => a.status !== "triggered");
  const fired = alerts.filter((a) => a.status === "triggered");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Price levels"
        title="Alerts"
        description="Checked on our servers after every NSE close against the session's high and low, so they work with this tab shut. A triggered alert lands in your notifications."
      />

      <Panel title="New alert">
        <AlertForm />
      </Panel>

      <Panel title="Watching" meta={`${armed.length} alert${armed.length === 1 ? "" : "s"}`}>
        {armed.length === 0 ? (
          <Empty title="No alerts set.">Pick a level — a breakout above resistance, or a price you&apos;d be happy to buy at.</Empty>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <th className={th}>Symbol</th>
                  <th className={th}>Condition</th>
                  <th className={thNum}>Last</th>
                  <th className={thNum}>Distance</th>
                  <th className={th}>Source</th>
                  <th className={th}>Status</th>
                  <th className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {armed.map((a) => {
                  const last = quotes.get(a.symbol)?.last_price ?? null;
                  const trigger = Number(a.trigger_price);
                  const distance = last ? ((trigger - last) / last) * 100 : null;
                  return (
                    <tr key={a.id} className={tr}>
                      <td className={td}>
                        <Link href={`/app/markets/${encodeURIComponent(a.symbol)}`} className="num font-medium hover:underline">
                          {a.symbol}
                        </Link>
                      </td>
                      <td className={td}>
                        <span className="text-muted-foreground">{a.condition === "above" ? "Rises above" : "Falls below"}</span>{" "}
                        <span className="num">₹{price(trigger)}</span>
                      </td>
                      <td className={tdNum}>{price(last)}</td>
                      <td className={tdNum + " text-muted-foreground"}>{pct(distance)}</td>
                      <td className={td}>{a.origin === "quant_signal" ? <Badge tone="coral">From signal</Badge> : <Badge>Manual</Badge>}</td>
                      <td className={td}>
                        <AlertStatusToggle id={a.id} armed={a.status === "armed"} />
                      </td>
                      <td className={td + " text-right"}>
                        <ConfirmButton label={`Delete ${a.symbol} alert`} confirmLabel="Delete" onConfirm={deleteAlert.bind(null, a.id)}>
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

      {fired.length ? (
        <Panel title="Triggered" meta={`${fired.length}`}>
          <TableWrap>
            <table className="w-full min-w-[600px]">
              <thead>
                <tr>
                  <th className={th}>Symbol</th>
                  <th className={th}>Condition</th>
                  <th className={thNum}>Hit at</th>
                  <th className={th}>When</th>
                  <th className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {fired.map((a) => (
                  <tr key={a.id} className={tr}>
                    <td className={td + " num font-medium"}>{a.symbol}</td>
                    <td className={td + " text-muted-foreground"}>
                      {a.condition} ₹{price(Number(a.trigger_price))}
                    </td>
                    <td className={tdNum}>{price(a.triggered_price != null ? Number(a.triggered_price) : null)}</td>
                    <td className={td + " text-muted-foreground"} title={dateTime(a.triggered_at)}>
                      {relative(a.triggered_at)}
                    </td>
                    <td className={td + " text-right"}>
                      <ConfirmButton label={`Clear ${a.symbol} alert`} confirmLabel="Clear" onConfirm={deleteAlert.bind(null, a.id)}>
                        Clear
                      </ConfirmButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      ) : null}
    </div>
  );
}
