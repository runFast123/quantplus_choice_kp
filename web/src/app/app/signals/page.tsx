import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { CloudLightningIcon, CloudSunIcon, SunIcon } from "@phosphor-icons/react/ssr";
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
import { DIP_EXIT, dipStatus, dipTestedSentence, isDipRule } from "@/lib/dip-rules";
import { reviewDate, STRONG_TREND_TESTED as TESTED, strongTrendStatus, weatherView } from "@/lib/strong-trend";
import { evaluateSignalProgress, type RawChartMarker } from "@/lib/trade-plan";
import type { Signal } from "@/lib/types";
import { getQuotes } from "@/server/market-data";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Signals" };

type ScoreRow = {
  strategy: string;
  side: "long" | "short";
  graded_20: number;
  up_20_pct: number | null;
  beat_index_20_pct: number | null;
  vs_index_20_pts: number | null;
  stop_hit_20_pct: number | null;
  first_day: string | null;
};

type TradeRow = { strategy: string; side: "long" | "short"; trades: number; made_money_pct: number | null; avg_result_pct: number | null };

const STRATEGIES: { key: string; title: string; rule: string; reads: string; tested?: string }[] = [
  {
    key: "strong_trend",
    title: "Strong trend",
    rule: "Buy when a stock closes at a new 52-week high on at least twice its usual volume, above its 50-day average, while the market is sunny (rising and calm).",
    reads: `Follows strong stocks. Safety stop 4× the stock's normal daily move below the price; review after 60 trading sessions. No fixed target.`,
    tested: `Tested on past prices (${TESTED.period}, ${TESTED.trades.toLocaleString("en-IN")} trades): ${TESTED.madeMoneyPct} in 100 made money after costs, the average trade ${TESTED.avgTradePct > 0 ? "+" : ""}${TESTED.avgTradePct}% (winners about +${TESTED.avgWinPct}%, losers about ${TESTED.avgLossPct}%). ${TESTED.recent.period}: ${TESTED.recent.madeMoneyPct} in 100, +${TESTED.recent.avgTradePct}%.`,
  },
  {
    key: "rsi_dip",
    title: "RSI dip",
    rule: "When a stock above its 200-day average drops sharply for a day or two (2-day RSI under 10), buy the next day only if it dips one normal day's move lower.",
    reads: `Buys a short dip in a rising stock and ${DIP_EXIT.toLowerCase()}. Safety stop 5× the normal daily move under the buy price.`,
    tested: dipTestedSentence("rsi_dip"),
  },
  {
    key: "kk_dip",
    title: "KK dip",
    rule: "When a stock above its 200-day average pushes at least 1% under its 20-day low, buy the next day only if it dips one normal day's move lower.",
    reads: `Buys a deeper dip in a rising stock and ${DIP_EXIT.toLowerCase()}. Often fires with RSI dip on the same stock.`,
    tested: dipTestedSentence("kk_dip"),
  },
  {
    key: "sma_20_50_cross",
    title: "SMA 20/50 cross",
    rule: "Buy when the 20-day average price rises above the 50-day average; exit when it drops back below.",
    reads: "Follows trends. Late on purpose: it waits for a move to prove itself.",
  },
];
// Replaced by the dip rules (ADR-036): their signals stay listed and graded as history.
const OLD_RULES = ["rsi_reversal", "kk_breakout"];
const ORDER = [...STRATEGIES.map((x) => x.key), ...OLD_RULES];

const ACTION_LABEL: Record<SignalAction, string> = { buy: "BUY", exit: "EXIT", sell: "SHORT", cover: "COVER" };

/** An open buy of a rule with its own tested plan (a safety stop and a review or bounce exit), not price targets. */
type OwnPlan = {
  stop: number | null;
  stopTitle: string;
  status: { label: string; tone: "neutral" | "loss" };
  next: string;
  nextSub: string;
  nextTitle: string;
};

const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}%`);

export default async function SignalsPage({
  searchParams,
}: PageProps<"/app/signals">) {
  const s = await requireSession();
  const sp = await searchParams;
  const scope = sp.scope === "all" ? "all" : "mine";
  const strategy =
    typeof sp.strategy === "string" && ORDER.includes(sp.strategy)
      ? sp.strategy
      : "";
  const statusFilter =
    typeof sp.status === "string" && ["targets", "progress", "exhaustion"].includes(sp.status)
      ? sp.status
      : "";

  const db = s.supabase;

  const [radarRes, holdRes, weatherRes, scoreRes, watchRes, tradeRes] = await Promise.all([
    db.from("watchlist_items").select("symbol"),
    db.from("holdings").select("symbol"),
    db
      .from("market_weather")
      .select("day, state, vix, nifty, nifty_sma50, nifty_sma200")
      .order("day", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("strategy_scorecard")
      .select("strategy, side, graded_20, up_20_pct, beat_index_20_pct, vs_index_20_pts, stop_hit_20_pct, first_day")
      .eq("period", "all"),
    db.from("signal_watch").select("symbol, strategy, signal_day, limit_price, stop, payload").order("symbol"),
    db.from("strategy_trade_results").select("strategy, side, trades, made_money_pct, avg_result_pct"),
  ]);
  const tradesBy = new Map(((tradeRes.data ?? []) as TradeRow[]).map((t) => [`${t.strategy}-${t.side}`, t]));
  const num = (x: unknown) => (x == null ? null : Number(x));
  const wx = weatherRes.data;
  const weather = weatherView({
    state: wx?.state,
    nifty: num(wx?.nifty),
    sma50: num(wx?.nifty_sma50),
    sma200: num(wx?.nifty_sma200),
    vix: num(wx?.vix),
  });
  const WeatherIcon = weather.state === "sunny" ? SunIcon : weather.state === "stormy" ? CloudLightningIcon : CloudSunIcon;
  const scores = ((scoreRes.data ?? []) as ScoreRow[]).sort(
    (a, b) =>
      ORDER.indexOf(a.strategy) - ORDER.indexOf(b.strategy) ||
      a.side.localeCompare(b.side),
  );
  const mine = [
    ...new Set([...(radarRes.data ?? []), ...(holdRes.data ?? [])].map((r) => r.symbol)),
  ];
  // Tomorrow's dip-buy levels (RSI dip / KK dip), for the stocks in scope.
  const watches = (watchRes.data ?? []).filter(
    (w) => (scope === "all" || mine.includes(w.symbol)) && (!strategy || w.strategy === strategy),
  );

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
    const base = { sg, at, last, since, quote, action, closed, result, own: null as OwnPlan | null };

    // Strong trend and the dip rules were tested with their own plan: a safety stop and a review date or a
    // bounce exit, not price targets.
    if (sg.strategy === "strong_trend" && action === "buy" && !closed) {
      const stop = Number(sg.payload.stop) || null;
      return {
        ...base,
        evaluation: null,
        own: {
          stop,
          stopTitle: "Safety stop: 4× the stock's normal daily move below the signal close",
          status: strongTrendStatus(stop, last),
          next: `Review ~${date(reviewDate(sg.generated_at).toISOString())}`,
          nextSub: "after 60 sessions",
          nextTitle: "Strong trend has no fixed target: review after 60 trading sessions (the exact day depends on holidays)",
        },
      };
    }
    if (isDipRule(sg.strategy) && action === "buy" && !closed) {
      const stop = Number(sg.payload.stop) || null;
      return {
        ...base,
        evaluation: null,
        own: {
          stop,
          stopTitle: "Safety stop: 5× the stock's normal daily move under the buy price",
          status: dipStatus(stop, last),
          next: "Sell on the bounce",
          nextSub: "within 10 sessions",
          nextTitle: DIP_EXIT,
        },
      };
    }

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
  const ownOpen = evaluatedSignals.filter((item) => item.own);
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
      return item.evaluation?.targetStatus === "in_progress" || Boolean(item.own);
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
        description="Every signal comes from one of the four simple rules below, so you can always see why it fired, and every one is graded afterwards. Signals are research prompts, not advice. Each open buy shows a stop (the price where the idea is wrong) and how it ends."
      />

      {/* Today's market weather: the condition Strong trend waits for */}
      <section className="panel flex items-start gap-3 p-4" aria-label="Market weather">
        <WeatherIcon size={22} weight="duotone" aria-hidden className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-[13px]">
            <span className="font-medium">Market weather: {weather.label}</span>
            {weatherRes.data?.day ? (
              <span className="text-muted-foreground"> · close of {date(weatherRes.data.day)}</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{weather.sentence}</p>
        </div>
      </section>

      {/* Summary strip */}
      <section className="panel grid grid-cols-2 sm:grid-cols-4">
        <Stat
          className="p-4 border-b border-r border-border sm:border-b-0"
          label="Open buy signals"
          value={buyItems.length + ownOpen.length}
          sub={`Out of ${evaluatedSignals.length} signals listed`}
        />
        <Stat
          className="p-4 border-b border-border sm:border-b-0 sm:border-r"
          label="Reached target 1"
          value={`${t1PlusHits.length} (${t1Rate.toFixed(0)}%)`}
          sub="Open buys with targets, at or above the first"
        />
        <Stat
          className="p-4 border-r border-border"
          label="Reached target 2"
          value={t2PlusHits.length}
          sub="Open buys with targets, at or above the second"
        />
        <Stat
          className="p-4"
          label="Running hot"
          value={exhaustionAlerts.length}
          sub="Open buys with RSI 70 or more: the price rose fast"
        />
      </section>

      {/* Strategy Selector Cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
            {st.tested ? (
              <p className="mt-2 border-t border-border pt-2 text-[12px] leading-5 text-muted-foreground">{st.tested}</p>
            ) : null}
          </Link>
        ))}
      </div>

      <p className="-mt-2 text-[12px] leading-5 text-muted-foreground">
        RSI dip and KK dip replace the old RSI reversal and KK breakout rules, which lost money after costs in testing.
        The old rules&apos; signals stay in the list and in the track record as history.
      </p>

      {/* Tomorrow's dip-buy levels: an RSI dip / KK dip signal is a price to buy at, valid for one session */}
      <Panel title="Dip-buy levels for the next session" meta={`${watches.length} ${watches.length === 1 ? "stock" : "stocks"}`}>
        {watches.length === 0 ? (
          <Empty title={scope === "mine" ? "No dip-buy levels on your stocks." : "No dip-buy levels for the next session."}>
            A level appears after a close when RSI dip or KK dip fires; it is good for the next session only.
          </Empty>
        ) : (
          <>
            <TableWrap>
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr>
                    <th className={th}>Stock</th>
                    <th className={th}>Rule</th>
                    <th className={thNum}>Close</th>
                    <th className={thNum}>Buy only at or under</th>
                    <th className={thNum}>Safety stop</th>
                    <th className={th}>Signal from</th>
                  </tr>
                </thead>
                <tbody>
                  {watches.map((w) => (
                    <tr key={`${w.symbol}-${w.strategy}`} className={tr}>
                      <td className={td}>
                        <Link href={`/app/markets/${encodeURIComponent(w.symbol)}`} className="num font-medium hover:underline">
                          {w.symbol}
                        </Link>
                      </td>
                      <td className={td + " text-muted-foreground"}>{strategyLabel[w.strategy] ?? w.strategy}</td>
                      <td className={tdNum}>₹{price(Number((w.payload as Record<string, unknown>)?.signal_close) || null)}</td>
                      <td className={tdNum + " font-medium"}>₹{price(Number(w.limit_price))}</td>
                      <td className={tdNum + " text-loss"}>₹{price(Number(w.stop))}</td>
                      <td className={td + " num text-muted-foreground"}>close of {date(w.signal_day)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <p className="mt-3 text-[12px] leading-5 text-muted-foreground">
              If the price trades down to this level in the next session the rule buys there; if it doesn&apos;t, the level
              expires and there is no trade. {DIP_EXIT}. Research, not advice.
            </p>
          </>
        )}
      </Panel>

      {/* Every entry signal, graded afterwards from stored prices */}
      <Panel title="Track record" meta="Every signal counted, winners and losers alike">
        {scores.length === 0 ? (
          <Empty title="No graded signals yet.">Signals are graded once 5, 20 and 60 sessions have passed.</Empty>
        ) : (
          <>
            <TableWrap>
              <table className="w-full min-w-[980px]">
                <thead>
                  <tr>
                    <th className={th} />
                    <th className={thNum + " border-b-0"} colSpan={3}>
                      By the rule&apos;s own plan
                    </th>
                    <th className={thNum + " border-b-0"} colSpan={4}>
                      20 trading sessions after each signal
                    </th>
                    <th className={th} />
                  </tr>
                  <tr>
                    <th className={th}>Rule</th>
                    <th className={thNum}>Trades closed</th>
                    <th className={thNum}>Made money</th>
                    <th className={thNum}>Average trade</th>
                    <th className={thNum}>Signals graded</th>
                    <th className={thNum}>Went the right way</th>
                    <th className={thNum}>Vs the Nifty 500 (points)</th>
                    <th className={thNum}>Stop hit</th>
                    <th className={thNum}>Since</th>
                  </tr>
                </thead>
                <tbody>
                  {scores.map((r) => {
                    const t = tradesBy.get(`${r.strategy}-${r.side}`);
                    return (
                      <tr key={`${r.strategy}-${r.side}`} className={tr}>
                        <td className={td}>
                          {strategyLabel[r.strategy] ?? r.strategy}
                          {r.strategy === "kk_breakout" ? (
                            <span className="text-muted-foreground"> · {r.side === "long" ? "buys" : "shorts"}</span>
                          ) : null}
                        </td>
                        <td className={tdNum}>{t ? Number(t.trades).toLocaleString("en-IN") : "—"}</td>
                        <td className={tdNum}>{t ? pct(t.made_money_pct) : "—"}</td>
                        <td className={tdNum}>{t ? <Delta value={t.avg_result_pct == null ? null : Number(t.avg_result_pct)} /> : "—"}</td>
                        <td className={tdNum}>{r.graded_20.toLocaleString("en-IN")}</td>
                        <td className={tdNum}>{pct(r.up_20_pct)}</td>
                        <td className={tdNum}>
                          <Delta value={r.vs_index_20_pts} kind="abs" />
                        </td>
                        <td className={tdNum}>{pct(r.stop_hit_20_pct)}</td>
                        <td className={tdNum + " text-muted-foreground"}>{r.first_day ? date(r.first_day) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
            <p className="mt-3 text-[12px] leading-5 text-muted-foreground">
              “By the rule&apos;s own plan” counts every closed trade the way the rule closed it (its stop, review, bounce
              or opposite signal). The dip rules sell within days, Strong trend after up to 60 sessions. RSI reversal has
              none: its exits only followed rallies, so pairing them would hide its losers. “20 sessions after” grades
              every buy (and KK short) the same way: higher (a short: lower) 20 sessions after the entry, and the
              difference from the Nifty 500 over those sessions. All before costs (about 0.5 % a round trip). Strong
              trend, RSI dip and KK dip are new: their earlier signals were worked out afterwards with the same rules on
              stored prices.
            </p>
          </>
        )}
      </Panel>

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
                  <th className={thNum}>Next target or review</th>
                  <th className={thNum}>Last close</th>
                  <th className={thNum}>Change since</th>
                  <th className={th}>Price mood</th>
                </tr>
              </thead>
              <tbody>
                {displayedSignals.map(({ sg, at, last, since, quote, evaluation, action, closed, result, own }) => {
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
                        ) : own ? (
                          <Badge tone={own.status.tone}>{own.status.label}</Badge>
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
                        ) : own?.stop && at ? (
                          <div className="flex flex-col items-end" title={own.stopTitle}>
                            <span className="num font-medium text-loss">₹{price(own.stop)}</span>
                            <span className="text-[10px] text-muted-foreground">
                              −{(((at - own.stop) / at) * 100).toFixed(1)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={tdNum}>
                        {own ? (
                          <div className="flex flex-col items-end" title={own.nextTitle}>
                            <span className="font-sans text-[12px]">{own.next}</span>
                            <span className="font-sans text-[10px] text-muted-foreground">{own.nextSub}</span>
                          </div>
                        ) : targets.length ? (
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
