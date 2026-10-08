import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { Badge, Delta, Stat } from "@/components/ui/data";
import {
  Empty,
  PageHeader,
  Panel,
  TableWrap,
  td,
  tdNum,
  th,
  thNum,
  tr,
} from "@/components/ui/layout";
import { date, price, strategyLabel } from "@/lib/format";
import { evaluateSignalProgress } from "@/lib/trade-plan";
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

export default async function SignalsPage({
  searchParams,
}: PageProps<"/app/signals">) {
  const s = await requireSession();
  const sp = await searchParams;
  const scope = sp.scope === "all" ? "all" : "mine";
  const strategy =
    typeof sp.strategy === "string" && STRATEGIES.some((x) => x.key === sp.strategy)
      ? sp.strategy
      : "";
  const statusFilter =
    typeof sp.status === "string" && ["targets", "progress", "exhaustion"].includes(sp.status)
      ? sp.status
      : "";

  const db = s.supabase;

  const [radarRes, holdRes] = await Promise.all([
    db.from("watchlist_items").select("symbol"),
    db.from("holdings").select("symbol"),
  ]);
  const mine = [
    ...new Set([...(radarRes.data ?? []), ...(holdRes.data ?? [])].map((r) => r.symbol)),
  ];

  let q = db
    .from("trading_signals")
    .select("*")
    .order("generated_at", { ascending: false })
    .limit(200);

  if (scope === "mine") q = q.in("symbol", mine.length ? mine : ["__none__"]);
  if (strategy) q = q.eq("strategy", strategy);
  const { data } = await q;
  const signals = (data ?? []) as Signal[];
  const quotes = await getQuotes(db, [...new Set(signals.map((x) => x.symbol))]);

  // Evaluate signals with asymmetric trade plan and sentiment exhaustion
  const evaluatedSignals = signals.map((sg) => {
    const at = Number(sg.payload.close) || 0;
    const quote = quotes.get(sg.symbol);
    const last = quote?.last_price ?? null;
    const since = last && at ? ((last - at) / at) * 100 : null;

    if (sg.signal_type === "buy") {
      const payloadStop = sg.payload.stop ? Number(sg.payload.stop) : null;
      const payloadSma20 = sg.payload.sma20 ? Number(sg.payload.sma20) : null;
      const defaultStop =
        payloadStop && payloadStop < at
          ? payloadStop
          : payloadSma20 && payloadSma20 < at
            ? payloadSma20
            : Number((at * 0.95).toFixed(2));

      const evaluation = evaluateSignalProgress(at, defaultStop, last, quote?.rsi);
      return { sg, at, last, since, quote, evaluation, isBuy: true };
    }

    return { sg, at, last, since, quote, evaluation: null, isBuy: false };
  });

  // Calculate quantitative desk overview metrics
  const buyItems = evaluatedSignals.filter(
    (item) => item.isBuy && item.evaluation?.plan.isValid,
  );
  const t1PlusHits = buyItems.filter((item) =>
    ["t1_hit", "t2_hit", "t3_hit"].includes(item.evaluation?.targetStatus ?? ""),
  );
  const t2PlusHits = buyItems.filter((item) =>
    ["t2_hit", "t3_hit"].includes(item.evaluation?.targetStatus ?? ""),
  );
  const exhaustionAlerts = buyItems.filter((item) =>
    ["sentiment_peak", "overbought"].includes(item.evaluation?.sentiment?.zone ?? ""),
  );

  const t1Rate =
    buyItems.length > 0 ? (t1PlusHits.length / buyItems.length) * 100 : 0;

  // Apply optional status filter
  const displayedSignals = evaluatedSignals.filter((item) => {
    if (!statusFilter) return true;
    if (statusFilter === "targets") {
      return ["t1_hit", "t2_hit", "t3_hit"].includes(
        item.evaluation?.targetStatus ?? "",
      );
    }
    if (statusFilter === "progress") {
      return item.evaluation?.targetStatus === "in_progress";
    }
    if (statusFilter === "exhaustion") {
      return ["sentiment_peak", "overbought"].includes(
        item.evaluation?.sentiment?.zone ?? "",
      );
    }
    return true;
  });

  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams({
      scope,
      ...(strategy ? { strategy } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...patch,
    });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/app/signals?${p.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Rule-based"
        title="Signals"
        description="Every signal comes from a rule you can read below — no black box. Signals are research prompts, not recommendations; asymmetric trade plan targets (0.75R · 2.0R · 3.0R) track systematic execution."
      />

      {/* Quantitative Desk Overview Strip */}
      <section className="panel grid grid-cols-2 divide-y divide-border sm:divide-y-0 sm:grid-cols-4 sm:divide-x">
        <Stat
          className="p-4"
          label="Active BUY Signals"
          value={buyItems.length}
          sub={`${evaluatedSignals.length} total signals in scope`}
        />
        <Stat
          className="p-4"
          label="T1+ De-risked"
          value={`${t1PlusHits.length} (${t1Rate.toFixed(0)}%)`}
          sub="Achieved ≥ +0.75R milestone"
        />
        <Stat
          className="p-4"
          label="T2+ Core Hits"
          value={t2PlusHits.length}
          sub="Achieved ≥ +2.0R systematic target"
        />
        <Stat
          className="p-4"
          label="Sentiment Warnings"
          value={exhaustionAlerts.length}
          sub="Node 2 / 3 overbought exhaustion (RSI ≥ 70)"
        />
      </section>

      {/* Strategy Selector Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {STRATEGIES.map((st) => (
          <Link
            key={st.key}
            href={link({ strategy: strategy === st.key ? "" : st.key })}
            aria-current={strategy === st.key ? "true" : undefined}
            className={clsx(
              "panel block p-4 transition-colors hover:border-muted-foreground/50",
              strategy === st.key && "border-foreground",
            )}
          >
            <p className="display text-[20px]">{st.title}</p>
            <p className="mt-1.5 text-[13px] leading-5">{st.rule}</p>
            <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">{st.reads}</p>
          </Link>
        ))}
      </div>

      {/* Signals Table Panel */}
      <Panel
        title={scope === "mine" ? "On your radar and portfolio" : "All stocks"}
        meta={`${displayedSignals.length} signals displayed`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter */}
            <div
              role="tablist"
              aria-label="Milestone filter"
              className="flex rounded-md border border-border p-0.5 text-[11px]"
            >
              {[
                { key: "", label: "All" },
                { key: "targets", label: "T1+ Targets" },
                { key: "progress", label: "In Progress" },
                { key: "exhaustion", label: "Exhaustion" },
              ].map((f) => (
                <Link
                  key={f.key}
                  role="tab"
                  aria-selected={statusFilter === f.key}
                  href={link({ status: f.key })}
                  className={clsx(
                    "rounded-[5px] px-2 py-0.5 transition-colors",
                    statusFilter === f.key
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.label}
                </Link>
              ))}
            </div>

            {/* Scope Switcher */}
            <div
              role="tablist"
              aria-label="Scope selector"
              className="flex rounded-md border border-border p-0.5 text-[12px]"
            >
              {(["mine", "all"] as const).map((k) => (
                <Link
                  key={k}
                  role="tab"
                  aria-selected={scope === k}
                  href={link({ scope: k })}
                  className={clsx(
                    "rounded-[5px] px-2.5 py-1 transition-colors",
                    scope === k
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {k === "mine" ? "My stocks" : "Everything"}
                </Link>
              ))}
            </div>
          </div>
        }
      >
        {displayedSignals.length === 0 ? (
          <Empty
            title={
              statusFilter
                ? "No signals match the selected filter."
                : scope === "mine"
                  ? "No signals on your stocks."
                  : "No signals."
            }
          >
            {statusFilter ? (
              <Link
                href={link({ status: "" })}
                className="text-foreground underline underline-offset-4"
              >
                Reset milestone filter
              </Link>
            ) : scope === "mine" ? (
              <>
                Signals only show for stocks on your radar or in your portfolio.{" "}
                <Link
                  href={link({ scope: "all" })}
                  className="text-foreground underline underline-offset-4"
                >
                  See everything
                </Link>
                .
              </>
            ) : null}
          </Empty>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[960px]">
              <thead>
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Symbol</th>
                  <th className={th}>Signal</th>
                  <th className={th}>Strategy</th>
                  <th className={thNum}>Entry</th>
                  <th className={thNum}>Stop (1R)</th>
                  <th className={th}>Targets (0.75R · 2.0R · 3.0R)</th>
                  <th className={thNum}>LTP</th>
                  <th className={thNum}>Since</th>
                  <th className={th}>Status</th>
                  <th className={th}>Sentiment node</th>
                </tr>
              </thead>
              <tbody>
                {displayedSignals.map(({ sg, at, last, since, quote, evaluation, isBuy }) => {
                  const plan = evaluation?.plan;
                  const sentiment = evaluation?.sentiment;

                  return (
                    <tr key={sg.id} className={tr}>
                      <td className={td + " num text-muted-foreground"}>
                        {date(sg.generated_at)}
                      </td>
                      <td className={td}>
                        <Link
                          href={`/app/markets/${encodeURIComponent(sg.symbol)}`}
                          className="num font-medium hover:underline"
                        >
                          {sg.symbol}
                        </Link>
                      </td>
                      <td className={td}>
                        <Badge tone={isBuy ? "gain" : "loss"}>
                          {isBuy ? "BUY" : "EXIT"}
                        </Badge>
                      </td>
                      <td className={td + " text-muted-foreground"}>
                        {strategyLabel[sg.strategy] ?? sg.strategy}
                      </td>
                      <td className={tdNum}>₹{price(at)}</td>
                      <td className={tdNum}>
                        {plan && plan.isValid ? (
                          <div className="flex flex-col items-end">
                            <span className="num font-medium text-loss">
                              ₹{price(plan.stop)}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              −{plan.riskPercent.toFixed(1)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={td}>
                        {plan && plan.isValid ? (
                          <div className="flex items-center gap-1.5 text-[11.5px] font-mono">
                            <span
                              className={clsx(
                                "rounded px-1 py-0.5",
                                last && last >= plan.t1
                                  ? "bg-gain-soft text-gain font-semibold"
                                  : "bg-muted/50 text-muted-foreground",
                              )}
                              title="Target 1: +0.75R de-risking node"
                            >
                              T1: ₹{price(plan.t1)}
                            </span>
                            <span className="text-muted-foreground/40">·</span>
                            <span
                              className={clsx(
                                "rounded px-1 py-0.5",
                                last && last >= plan.t2
                                  ? "bg-gain-soft text-gain font-semibold"
                                  : "bg-muted/50 text-muted-foreground",
                              )}
                              title="Target 2: +2.0R primary objective"
                            >
                              T2: ₹{price(plan.t2)}
                            </span>
                            <span className="text-muted-foreground/40">·</span>
                            <span
                              className={clsx(
                                "rounded px-1 py-0.5",
                                last && last >= plan.t3
                                  ? "bg-gain-soft text-gain font-semibold"
                                  : "bg-muted/50 text-muted-foreground",
                              )}
                              title="Target 3: +3.0R trend runner"
                            >
                              T3: ₹{price(plan.t3)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-[12px] italic">
                            {isBuy ? "Calculating" : "Position exited"}
                          </span>
                        )}
                      </td>
                      <td className={tdNum}>{last ? `₹${price(last)}` : "—"}</td>
                      <td className={tdNum}>
                        <Delta value={since} />
                      </td>
                      <td className={td}>
                        {evaluation ? (
                          <div className="flex items-center gap-1.5">
                            <Badge tone={evaluation.statusTone}>
                              {evaluation.statusLabel}
                            </Badge>
                          </div>
                        ) : (
                          <span className="text-[11.5px] text-muted-foreground">
                            Exited
                          </span>
                        )}
                      </td>
                      <td className={td}>
                        {sentiment ? (
                          <div className="flex items-center gap-1.5">
                            <span
                              className={clsx(
                                "rounded px-1.5 py-0.5 text-[10.5px] font-medium uppercase",
                                sentiment.tone === "gain"
                                  ? "bg-gain-soft text-gain"
                                  : sentiment.tone === "loss"
                                    ? "bg-loss-soft text-loss"
                                    : "bg-muted text-muted-foreground",
                              )}
                              title={sentiment.sub}
                            >
                              {sentiment.label}
                            </span>
                            {quote?.rsi != null && (
                              <span className="num text-[11px] text-muted-foreground">
                                {quote.rsi.toFixed(0)}
                              </span>
                            )}
                          </div>
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
    </div>
  );
}
