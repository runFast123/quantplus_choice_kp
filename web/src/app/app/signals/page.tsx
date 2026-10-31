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
import { markerFromSignal, signalAction, tradeFor, type SignalAction } from "@/lib/signal-trade";
import { evaluateSignalProgress, type RawChartMarker } from "@/lib/trade-plan";
import type { Signal } from "@/lib/types";
import { getQuotes } from "@/server/market-data";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Signals" };

const STRATEGIES = [
  {
    key: "sma_20_50_cross",
    title: "SMA 20/50 cross",
    rule: "Buy when the 20-day average price rises above the 50-day average; exit when it drops back below.",
    reads: "Follows trends. Late on purpose: it waits for a move to prove itself.",
  },
  {
    key: "rsi_reversal",
    title: "RSI reversal",
    rule: "Buy when RSI (a 0–100 gauge of recent moves) climbs back above 30 after a hard fall; exit when it drops back below 70 after a fast rise.",
    reads: "Bets that sharp moves calm down. Early on purpose.",
  },
  {
    key: "kk_breakout",
    title: "KK 20d Breakout",
    rule: "Buy when the price dips at least 1% under its 20-day low, then climbs back above that day's high within 5 sessions.",
    reads: "Catches a quick rebound. Takes profit in two steps and closes after 5 sessions either way.",
  },
];

const ACTION_LABEL: Record<SignalAction, string> = { buy: "BUY", exit: "EXIT", sell: "SHORT", cover: "COVER" };

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

  // Each signal's round trip: a buy is closed by the next exit of the same rule (a short sell by
  // its cover). Rows are newest first, so a closing signal is always on the same page as its entry.
  const markers = new Map(signals.map((sg) => [sg.id, markerFromSignal(sg)]));
  const bySymbol = new Map<string, RawChartMarker[]>();
  for (const sg of signals) bySymbol.set(sg.symbol, [...(bySymbol.get(sg.symbol) ?? []), markers.get(sg.id)!]);

  const evaluatedSignals = signals.map((sg) => {
    const at = Number(sg.payload.close) || 0;
    const quote = quotes.get(sg.symbol);
    const last = quote?.last_price ?? null;
    const marker = markers.get(sg.id)!;
    const action = signalAction(marker);
    const trade = tradeFor(marker, bySymbol.get(sg.symbol) ?? []);
    // The finished trade's result, on the entry that has closed and on the exit that closed it.
    const exitPrice = trade?.exit?.price ?? null;
    const result =
      trade && exitPrice
        ? (trade.exit?.pnlPct ??
          ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100 * (trade.direction === "long" ? 1 : -1))
        : null;
    const closed = action === "exit" || action === "cover" || Boolean(trade?.exit);
    const since = !closed && action === "buy" && last && at ? ((last - at) / at) * 100 : null;
    const base = { sg, at, last, since, quote, action, closed, result };

    if (action === "buy" && !closed) {
      const payloadStop = sg.payload.stop ? Number(sg.payload.stop) : null;
      const payloadSma20 = sg.payload.sma20 ? Number(sg.payload.sma20) : null;
      const defaultStop =
        payloadStop && payloadStop < at
          ? payloadStop
          : payloadSma20 && payloadSma20 < at
            ? payloadSma20
            : Number((at * 0.95).toFixed(2));

      const evaluation = evaluateSignalProgress(at, defaultStop, last, quote?.rsi);
      return { ...base, evaluation };
    }

    return { ...base, evaluation: null };
  });

  // Open buys only: a buy its rule has already exited is history, not a trade to track.
  const buyItems = evaluatedSignals.filter((item) => item.evaluation?.plan.isValid);
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
        description="Every signal comes from one of the three simple rules below, so you can always see why it fired. Signals are research prompts, not advice. Each open buy shows a stop (the price where the idea is wrong) and three price targets."
      />

      {/* Summary strip */}
      <section className="panel grid grid-cols-2 sm:grid-cols-4">
        <Stat
          className="p-4 border-b border-r border-border sm:border-b-0"
          label="Open buy signals"
          value={buyItems.length}
          sub={`Out of ${evaluatedSignals.length} signals listed`}
        />
        <Stat
          className="p-4 border-b border-border sm:border-b-0 sm:border-r"
          label="Reached target 1"
          value={`${t1PlusHits.length} (${t1Rate.toFixed(0)}%)`}
          sub="Open buys at or above their first target"
        />
        <Stat
          className="p-4 border-r border-border"
          label="Reached target 2"
          value={t2PlusHits.length}
          sub="Open buys at or above their second target"
        />
        <Stat
          className="p-4"
          label="Running hot"
          value={exhaustionAlerts.length}
          sub="Open buys with RSI 70 or more: the price rose fast"
        />
      </section>

      {/* Strategy Selector Cards */}
      <div className="grid gap-4 md:grid-cols-3">
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
          <div className="flex max-w-full flex-wrap items-center gap-2">
            {/* Status Filter */}
            <div
              role="tablist"
              aria-label="Show"
              className="flex max-w-full flex-wrap rounded-md border border-border p-0.5 text-[11px]"
            >
              {[
                { key: "", label: "All" },
                { key: "targets", label: "Hit a target" },
                { key: "progress", label: "Still open" },
                { key: "exhaustion", label: "Running hot" },
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
              aria-label="Stocks"
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
                Show all signals
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
                  <th className={th}>Stock</th>
                  <th className={th}>Signal</th>
                  <th className={th}>Status</th>
                  <th className={th}>Rule</th>
                  <th className={thNum}>Price then</th>
                  <th className={thNum}>Stop</th>
                  <th className={thNum}>Next target</th>
                  <th className={thNum}>Last close</th>
                  <th className={thNum}>Change since</th>
                  <th className={th}>Price mood</th>
                </tr>
              </thead>
              <tbody>
                {displayedSignals.map(({ sg, at, last, since, quote, evaluation, action, closed, result }) => {
                  const plan = evaluation?.plan;
                  const sentiment = evaluation?.sentiment;
                  const targets = plan && plan.isValid ? [plan.t1, plan.t2, plan.t3] : [];
                  const next = targets.findIndex((t) => !last || last < t);

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
                        <Badge tone={action === "buy" || action === "cover" ? "gain" : "loss"}>
                          {ACTION_LABEL[action]}
                        </Badge>
                      </td>
                      <td className={td}>
                        {evaluation ? (
                          <Badge tone={evaluation.statusTone}>{evaluation.statusLabel}</Badge>
                        ) : closed ? (
                          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                            Closed
                            {result != null ? <Delta value={result} /> : null}
                          </span>
                        ) : (
                          <span className="text-[12px] text-muted-foreground">Open</span>
                        )}
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
                      <td className={tdNum}>
                        {targets.length ? (
                          <div
                            className="flex flex-col items-end"
                            title={`Targets: ${targets.map((t, i) => `${i + 1}) ₹${price(t)}`).join("  ")}`}
                          >
                            {next === -1 ? (
                              <span className="font-sans text-[12px] font-medium text-gain">All 3 reached</span>
                            ) : (
                              <>
                                <span className="num">₹{price(targets[next])}</span>
                                <span className="font-sans text-[10px] text-muted-foreground">
                                  target {next + 1} of 3
                                </span>
                              </>
                            )}
                          </div>
                        ) : (
                          <span className="font-sans text-[12px] text-muted-foreground">
                            {action === "exit"
                              ? "Closed the buy"
                              : action === "cover"
                                ? "Closed the short"
                                : closed
                                  ? "Trade closed"
                                  : action === "sell"
                                    ? "Short trade"
                                    : "—"}
                          </span>
                        )}
                      </td>
                      <td className={tdNum}>{last ? `₹${price(last)}` : "—"}</td>
                      <td className={tdNum}>
                        <Delta value={since} />
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
                                    : "bg-muted text-foreground",
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
