import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { TrashIcon } from "@phosphor-icons/react/ssr";
import { AlertForm } from "@/components/market/alert-form";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Badge } from "@/components/ui/data";
import { Empty, PageHeader, Panel, PlanGate, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { dateTime, pct, price, relative } from "@/lib/format";
import { evaluateSentiment } from "@/lib/trade-plan";
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

  const [alertsRes, radarRes, holdRes] = await Promise.all([
    s.supabase.from("price_alerts").select("*").order("created_at", { ascending: false }),
    s.supabase.from("watchlist_items").select("symbol"),
    s.supabase.from("holdings").select("symbol"),
  ]);
  const alerts = (alertsRes.data ?? []) as PriceAlert[];
  const userSymbols = [
    ...new Set([...(radarRes.data ?? []), ...(holdRes.data ?? [])].map((r) => r.symbol)),
  ];
  const allSymbols = [...new Set([...alerts.map((a) => a.symbol), ...userSymbols])];
  const quotes = await getQuotes(s.supabase, allSymbols);
  const armed = alerts.filter((a) => a.status !== "triggered");
  const fired = alerts.filter((a) => a.status === "triggered");

  const sentimentAlerts = userSymbols
    .map((sym) => {
      const q = quotes.get(sym);
      if (!q || q.rsi == null) return null;
      const sentiment = evaluateSentiment(q.rsi);
      if (
        sentiment &&
        (sentiment.zone === "sentiment_peak" ||
          sentiment.zone === "overbought" ||
          sentiment.zone === "oversold")
      ) {
        return { symbol: sym, quote: q, sentiment };
      }
      return null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

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

      {sentimentAlerts.length > 0 && (
        <Panel
          title="Automated Sentiment Alerts"
          meta={`${sentimentAlerts.length} position${sentimentAlerts.length === 1 ? "" : "s"} at critical exhaustion nodes`}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sentimentAlerts.map(({ symbol, quote, sentiment }) => (
              <div
                key={symbol}
                className={clsx(
                  "rounded-md border bg-card p-3.5 transition-colors",
                  sentiment.zone === "sentiment_peak" || sentiment.zone === "overbought"
                    ? "border-loss/40"
                    : "border-border",
                )}
              >
                <div className="flex items-start justify-between">
                  <Link
                    href={`/app/markets/${encodeURIComponent(symbol)}`}
                    className="num text-[15px] font-bold text-foreground hover:underline"
                  >
                    {symbol}
                  </Link>
                  <span
                    className={clsx(
                      "rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase",
                      sentiment.tone === "loss"
                        ? "bg-loss-soft text-loss border border-loss/20"
                        : "bg-gain-soft text-gain",
                    )}
                  >
                    {sentiment.label}
                  </span>
                </div>
                <div className="mt-2 flex items-baseline justify-between text-[12px]">
                  <span className="text-muted-foreground">LTP: ₹{price(quote.last_price)}</span>
                  <span className="num text-muted-foreground">
                    RSI 14: <strong className="text-foreground">{quote.rsi?.toFixed(1)}</strong>
                  </span>
                </div>
                <p className="mt-1.5 text-[11.5px] text-muted-foreground leading-snug">
                  {sentiment.sub}
                </p>
                <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-[11px]">
                  <Link
                    href={`/app/markets/${encodeURIComponent(symbol)}`}
                    className="text-foreground underline underline-offset-4"
                  >
                    View Trade Plan &amp; Sizing →
                  </Link>
                  <span className="text-muted-foreground">
                    {sentiment.zone === "oversold" ? "Accumulation setup" : "Scale-out watch"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

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
