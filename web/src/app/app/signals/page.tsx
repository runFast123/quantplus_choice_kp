import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { Badge, Delta } from "@/components/ui/data";
import { Empty, PageHeader, Panel, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { date, price, strategyLabel } from "@/lib/format";
import type { Signal } from "@/lib/types";
import { getQuotes } from "@/server/market-data";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Signals" };

const STRATEGIES = [
  {
    key: "sma_20_50_cross",
    title: "SMA 20/50 cross",
    rule: "BUY when the 20-day average closes above the 50-day; EXIT when it closes back below.",
    reads: "Trend-following. Late by design — it waits for a move to prove itself.",
  },
  {
    key: "rsi_reversal",
    title: "RSI reversal",
    rule: "BUY when 14-day RSI climbs back above 30; EXIT when it falls back below 70.",
    reads: "Mean-reversion. Early by design — it bets stretched moves relax.",
  },
];

export default async function SignalsPage({ searchParams }: PageProps<"/app/signals">) {
  const s = await requireSession();
  const sp = await searchParams;
  const scope = sp.scope === "all" ? "all" : "mine";
  const strategy = typeof sp.strategy === "string" && STRATEGIES.some((x) => x.key === sp.strategy) ? sp.strategy : "";
  const db = s.supabase;

  const [radarRes, holdRes] = await Promise.all([
    db.from("watchlist_items").select("symbol"),
    db.from("holdings").select("symbol"),
  ]);
  const mine = [...new Set([...(radarRes.data ?? []), ...(holdRes.data ?? [])].map((r) => r.symbol))];

  let q = db.from("trading_signals").select("*").order("generated_at", { ascending: false }).limit(150);
  if (scope === "mine") q = q.in("symbol", mine.length ? mine : ["__none__"]);
  if (strategy) q = q.eq("strategy", strategy);
  const { data } = await q;
  const signals = (data ?? []) as Signal[];
  const quotes = await getQuotes(db, [...new Set(signals.map((x) => x.symbol))]);

  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ scope, ...(strategy ? { strategy } : {}), ...patch });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/app/signals?${p.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Rule-based"
        title="Signals"
        description="Every signal comes from a rule you can read below — no black box. They're research prompts, not recommendations; size and timing are your call."
      />

      <div className="grid gap-4 md:grid-cols-2">
        {STRATEGIES.map((st) => (
          <Link
            key={st.key}
            href={link({ strategy: strategy === st.key ? "" : st.key })}
            aria-current={strategy === st.key ? "true" : undefined}
            className={clsx("panel block p-4 transition-colors hover:border-muted-foreground/50", strategy === st.key && "border-foreground")}
          >
            <p className="display text-[20px]">{st.title}</p>
            <p className="mt-1.5 text-[13px] leading-5">{st.rule}</p>
            <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">{st.reads}</p>
          </Link>
        ))}
      </div>

      <Panel
        title={scope === "mine" ? "On your radar and portfolio" : "All stocks"}
        meta={`${signals.length} signals`}
        actions={
          <div role="tablist" className="flex rounded-md border border-border p-0.5 text-[12px]">
            {(["mine", "all"] as const).map((k) => (
              <Link
                key={k}
                role="tab"
                aria-selected={scope === k}
                href={link({ scope: k })}
                className={clsx("rounded-[5px] px-2.5 py-1", scope === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {k === "mine" ? "My stocks" : "Everything"}
              </Link>
            ))}
          </div>
        }
      >
        {signals.length === 0 ? (
          <Empty title={scope === "mine" ? "No signals on your stocks." : "No signals."}>
            {scope === "mine" ? (
              <>
                Signals only show for stocks on your radar or in your portfolio.{" "}
                <Link href={link({ scope: "all" })} className="text-foreground underline underline-offset-4">
                  See everything
                </Link>
                .
              </>
            ) : null}
          </Empty>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[780px]">
              <thead>
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Symbol</th>
                  <th className={th}>Signal</th>
                  <th className={th}>Rule</th>
                  <th className={thNum}>At</th>
                  <th className={thNum}>Stop / target</th>
                  <th className={thNum}>Since</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((sg) => {
                  const at = Number(sg.payload.close);
                  const last = quotes.get(sg.symbol)?.last_price;
                  const since = last && at ? ((last - at) / at) * 100 : null;
                  return (
                    <tr key={sg.id} className={tr}>
                      <td className={td + " num text-muted-foreground"}>{date(sg.generated_at)}</td>
                      <td className={td}>
                        <Link href={`/app/markets/${encodeURIComponent(sg.symbol)}`} className="num font-medium hover:underline">
                          {sg.symbol}
                        </Link>
                      </td>
                      <td className={td}>
                        <Badge tone={sg.signal_type === "buy" ? "gain" : "loss"}>{sg.signal_type === "buy" ? "BUY" : "EXIT"}</Badge>
                      </td>
                      <td className={td + " text-muted-foreground"}>{strategyLabel[sg.strategy] ?? sg.strategy}</td>
                      <td className={tdNum}>{price(at)}</td>
                      <td className={tdNum + " text-muted-foreground"}>
                        {sg.payload.stop ? `${price(Number(sg.payload.stop))} / ${price(Number(sg.payload.target))}` : "—"}
                      </td>
                      <td className={tdNum}>
                        <Delta value={since} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}
