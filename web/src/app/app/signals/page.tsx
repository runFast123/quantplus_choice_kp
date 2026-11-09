import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { CloudLightningIcon, CloudSunIcon, SunIcon } from "@phosphor-icons/react/ssr";
import { Badge, Delta } from "@/components/ui/data";
import { CheckTag } from "@/components/market/check-tag";
import { HealthChip, RuleHealthCard } from "@/components/market/rule-health";
import { SectionTabs } from "@/components/ui/section-tabs";
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
import { date, isoDaysAgo, price, strategyLabel } from "@/lib/format";
import { markerFromSignal, signalAction, tradeFor, type SignalAction } from "@/lib/signal-trade";
import { DIP_EXIT, dipStatus, dipTestedSentence, isDipRule } from "@/lib/dip-rules";
import {
  isTrendRule,
  MA200_TREND_TESTED as MA200,
  SECULAR_TREND_TESTED as SEC,
  reviewDate,
  SMA_TREND_TESTED as SMA,
  STRONG_TREND_TESTED as TESTED,
  strongTrendStatus,
  weatherView,
} from "@/lib/strong-trend";
import {
  CHECK_TESTED,
  checkKey,
  daysAgoIST,
  isCheckRule,
  liveYears,
  periodsSentence,
  quarterStartIST,
  signalDayOf,
  standingLine,
  total,
  type CheckRule,
  type RecordRow,
} from "@/lib/signal-checks";
import { evaluateSignalProgress, type RawChartMarker } from "@/lib/trade-plan";
import type { Signal } from "@/lib/types";
import { getQuotes, getRuleHealth } from "@/server/market-data";
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
    key: "sma_trend",
    title: "SMA 20/50 trend",
    rule: "Buy when the 20-day average price rises above the 50-day average in a market leader: a stock whose 6-month return is in the top 30% of the 500 largest companies.",
    reads: "Follows a turn up in a strong stock. Safety stop 4× the stock's normal daily move below the price; review after 60 trading sessions.",
    tested: `Tested on past prices (${SMA.period}, ${SMA.trades.toLocaleString("en-IN")} trades): ${SMA.madeMoneyPct} in 100 made money after costs, the average trade +${SMA.avgTradePct}% (winners about +${SMA.avgWinPct}%, losers about ${SMA.avgLossPct}%). ${SMA.recent.period}: ${SMA.recent.madeMoneyPct} in 100, +${SMA.recent.avgTradePct}%. The old cross-in, cross-out rule: ${SMA.before.madeMoneyPct} in 100 (${SMA.before.recentMadeMoneyPct} in 2024–26).`,
  },
  {
    key: "ma200_trend",
    title: "200-day trend",
    rule: "Buy when a stock is above its 200-day average, that average is flat or rising (measured with a straight regression line through its last 100 days), and the price has climbed fairly steadily over the last 100 days.",
    reads: "Follows a stock whose long-term trend has turned up. Safety stop 4× the stock's normal daily move below the price; review after 60 trading sessions.",
    tested: `Tested on past prices (${MA200.period}, ${MA200.trades.toLocaleString("en-IN")} trades): ${MA200.madeMoneyPct} in 100 made money after costs, the average trade +${MA200.avgTradePct}% (winners about +${MA200.avgWinPct}%, losers about ${MA200.avgLossPct}%). ${MA200.recent.period}: ${MA200.recent.madeMoneyPct} in 100, +${MA200.recent.avgTradePct}%; buying on a random day above the 200-day average: ${MA200.random.recentMadeMoneyPct} in 100, +${MA200.random.recentAvgTradePct}%.`,
  },
  {
    key: "secular_trend",
    title: "Secular trend",
    rule: "Buy when Secular trend (Pring's Special K: twelve smoothed price changes from two weeks to two years) crosses above its signal line (its 50-day average, averaged again over 50 days) while it is flat or rising and still below −150: a deep, long slump starting to turn up.",
    reads: "Few signals: it waits for a long fall. Safety stop 4× the stock's normal daily move below the price; review after 60 trading sessions.",
    tested: `Tested on past prices (${SEC.period}, ${SEC.trades} trades, most of them in the 2020 rebound): ${SEC.madeMoneyPct} in 100 made money after costs, the average trade +${SEC.avgTradePct}% (winners about +${SEC.avgWinPct}%, losers about ${SEC.avgLossPct}%). ${SEC.recent.period}: ${SEC.recent.trades} trades, ${SEC.recent.madeMoneyPct} in 100, +${SEC.recent.avgTradePct}%; buying on a random day below −150: ${SEC.random.recentMadeMoneyPct} in 100, ${SEC.random.recentAvgTradePct}%.`,
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
];
// How many rules are in use, in words for headings ("five").
const COUNT = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"][STRATEGIES.length] ?? String(STRATEGIES.length);
const Count = COUNT[0].toUpperCase() + COUNT.slice(1);
// The rule cards fill whole rows on wide screens: rows of three, and a short last row shares its row.
const ruleSpan = (i: number, n: number) => {
  const lastRow = n % 3;
  const inLast = i >= n - lastRow;
  return clsx(
    i === n - 1 && n % 2 === 1 && "md:col-span-2",
    inLast && lastRow === 2 ? "xl:col-span-3" : inLast && lastRow === 1 ? "xl:col-span-6" : "xl:col-span-2",
  );
};
// Replaced by the dip rules and the SMA trend rule (ADR-036, ADR-037): their signals stay listed as history.
const OLD_RULES = ["sma_20_50_cross", "rsi_reversal", "kk_breakout"];
const ORDER = [...STRATEGIES.map((x) => x.key), ...OLD_RULES];

const ACTION_LABEL: Record<SignalAction, string> = { buy: "BUY", exit: "EXIT", sell: "SHORT", cover: "COVER" };

// The two signal checks (ADR-038), in the order the panel shows them.
const CHECKS: { rule: CheckRule; title: string; what: string }[] = [
  {
    rule: "rsi_dip",
    title: "RSI dip check",
    what: "Scores each RSI dip on 25 numbers known at its close (the stock's trend, swings and volume, and the market) against how past dips like it turned out, and tags those that score like the best third of past dips.",
  },
  {
    rule: "strong_trend",
    title: "Strong trend check",
    what: "Tags a Strong trend buy when the rule's last 30 finished trades in the same market weather lost money over their first 20 sessions.",
  },
];

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
// Rows in the signal list before "Show all".
const ROWS = 60;

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
  const statusFilter = typeof sp.status === "string" && ["open", "closed"].includes(sp.status) ? sp.status : "";
  // Which rules the list shows: the ones in use (default), the old ones they replaced, or both.
  const rules = typeof sp.rules === "string" && ["old", "all"].includes(sp.rules) ? sp.rules : "";
  const more = sp.more === "1";

  const db = s.supabase;

  // Two independent chains run together, so the summary tables never hold up the signal list:
  // the stocks in scope → their newest signals → those stocks' quotes, alongside weather, track record and levels.
  const mineP = Promise.all([db.from("watchlist_items").select("symbol"), db.from("holdings").select("symbol")]).then(
    ([radarRes, holdRes]) => [...new Set([...(radarRes.data ?? []), ...(holdRes.data ?? [])].map((r) => r.symbol))],
  );
  const signalsP = (async () => {
    let q = db.from("trading_signals").select("*").order("generated_at", { ascending: false }).limit(200);
    if (scope === "mine") {
      const mine = await mineP;
      q = q.in("symbol", mine.length ? mine : ["__none__"]);
    }
    if (strategy) q = q.eq("strategy", strategy);
    else if (rules === "old") q = q.in("strategy", OLD_RULES);
    else if (rules !== "all") q = q.in("strategy", STRATEGIES.map((x) => x.key));
    const { data } = await q;
    const rows = (data ?? []) as Signal[];
    // The signal checks' tags for these signals and for the next session's dip-buy levels (newer than any of them).
    const days = rows.filter((x) => isCheckRule(x.strategy)).map(signalDayOf).sort();
    const since = days[0] ?? daysAgoIST(14);
    const [quotes, tagRes] = await Promise.all([
      getQuotes(db, [...new Set(rows.map((x) => x.symbol))]),
      db
        .from("signal_checks")
        .select("strategy, symbol, signal_day")
        .eq("tagged", true)
        .gte("signal_day", since)
        .limit(1000),
    ]);
    const tags = new Set((tagRes.data ?? []).map((t) => checkKey(t.strategy, t.symbol, t.signal_day)));
    return { rows, quotes, tags };
  })();
  const [mine, { rows: signals, quotes, tags }, health, weatherRes, scoreRes, watchRes, tradeRes, recordRes, modelRes] = await Promise.all([
    mineP,
    signalsP,
    getRuleHealth(db),
    db
      .from("market_weather")
      .select("day, state, vix, nifty, nifty_sma50, nifty_sma200")
      .order("day", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("strategy_scorecard_summary")
      .select("strategy, side, graded_20, up_20_pct, beat_index_20_pct, vs_index_20_pts, stop_hit_20_pct, first_day")
      .eq("period", "all"),
    db.from("signal_watch").select("symbol, strategy, signal_day, limit_price, stop, payload").order("symbol"),
    db.from("strategy_trade_summary").select("strategy, side, trades, made_money_pct, avg_result_pct"),
    db.from("signal_check_record").select("strategy, month, label, signals, trades, made_money"),
    db
      .from("signal_check_models")
      .select("valid_from, n_train:model->>n_train, trained_through:model->>trained_through, shown:model->>shown")
      .eq("strategy", "rsi_dip")
      .order("valid_from", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const record = (recordRes.data ?? []) as RecordRow[];
  const model = modelRes.data as { valid_from: string; n_train: string | null; trained_through: string | null; shown: string | null } | null;
  const quarterStart = quarterStartIST();
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
  // The track record lists the rules in use; replaced rules' signals stay in the list below as history.
  const scores = ((scoreRes.data ?? []) as ScoreRow[])
    .filter((r) => STRATEGIES.some((x) => x.key === r.strategy))
    .sort((a, b) => ORDER.indexOf(a.strategy) - ORDER.indexOf(b.strategy) || a.side.localeCompare(b.side));
  // Tomorrow's dip-buy levels (RSI dip / KK dip), for the stocks in scope.
  const watches = (watchRes.data ?? []).filter(
    (w) => (scope === "all" || mine.includes(w.symbol)) && (!strategy || w.strategy === strategy),
  );

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
    if (isTrendRule(sg.strategy) && action === "buy" && !closed) {
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
          nextTitle: "No fixed target: review after 60 trading sessions (the exact day depends on holidays)",
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

  // The rules in use; fresh = an open buy from the last 7 days.
  const current = new Set(STRATEGIES.map((x) => x.key));
  const weekAgo = isoDaysAgo(7);
  const fresh = evaluatedSignals.filter((x) => x.own && current.has(x.sg.strategy) && x.sg.generated_at >= weekAgo);
  const statuses = STRATEGIES.map((st) => health.latest.get(st.key)?.status);
  const onTrack = statuses.filter((x) => x === "within" || x === "above").length;
  const weaker = STRATEGIES.filter((st) => health.latest.get(st.key)?.status === "below").map((st) => st.title);

  const displayedSignals = evaluatedSignals.filter((item) =>
    statusFilter === "open" ? !item.closed && item.action === "buy" : statusFilter === "closed" ? item.closed : true,
  );
  const shownSignals = more ? displayedSignals : displayedSignals.slice(0, ROWS);

  const link = (patch: Record<string, string>, hash = "all") => {
    const p = new URLSearchParams({
      scope,
      ...(strategy ? { strategy } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(rules ? { rules } : {}),
      ...patch,
    });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/app/signals?${p.toString()}${hash ? `#${hash}` : ""}`;
  };

  const tag = (sg: Signal, action: SignalAction) =>
    isCheckRule(sg.strategy) && action === "buy" && tags.has(checkKey(sg.strategy, sg.symbol, signalDayOf(sg))) ? <CheckTag rule={sg.strategy} /> : null;

  const todayTab = (
    <div className="flex flex-col gap-5">
      <Panel title={`Fresh buys from the ${COUNT} rules`} meta="Open, last 7 days">
        {fresh.length === 0 ? (
          <Empty title={scope === "mine" ? "No fresh buys on your stocks." : "No fresh buys this week."}>
            {weather.state === "stormy" ? "In a stormy market the trend rules wait; the dip rules still fire on rising stocks. " : ""}
            {scope === "mine" ? (
              <Link prefetch={false} href={link({ scope: "all" }, "today")} className="text-foreground underline underline-offset-4">
                See every stock
              </Link>
            ) : null}
          </Empty>
        ) : (
          <>
            <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 [&>li:nth-child(n+7)]:hidden sm:[&>li:nth-child(n+7)]:flex" data-testid="fresh-buys">
              {fresh.slice(0, 12).map(({ sg, at, last, since, own }) => (
                <li key={sg.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link prefetch={false} href={`/app/markets/${encodeURIComponent(sg.symbol)}`} className="num text-[14px] font-semibold hover:underline">
                        {sg.symbol}
                      </Link>
                      <p className="text-[11.5px] text-muted-foreground">
                        {strategyLabel[sg.strategy]} · {date(sg.generated_at)}
                      </p>
                    </div>
                    {own ? <Badge tone={own.status.tone}>{own.status.label}</Badge> : null}
                  </div>
                  <p className="num flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
                    <span className="text-muted-foreground">₹{price(at)} →</span>
                    <span>{last ? `₹${price(last)}` : "—"}</span>
                    <Delta value={since} />
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {tag(sg, "buy")}
                    <HealthChip row={health.latest.get(sg.strategy)} prefix="Rule:" />
                  </div>
                  {own ? (
                    <p className="mt-auto flex justify-between gap-2 border-t border-border pt-2 text-[11.5px] text-muted-foreground">
                      <span title={own.stopTitle}>
                        Stop <span className="num text-loss">₹{price(own.stop)}</span>
                      </span>
                      <span title={own.nextTitle}>
                        {own.next} <span className="text-muted-foreground/80">{own.nextSub}</span>
                      </span>
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            {fresh.length > 6 ? (
              <Link prefetch={false} href={link({ status: "open" })} className="mt-3 inline-block text-[12.5px] text-muted-foreground underline underline-offset-4 hover:text-foreground">
                See all {fresh.length} in the signal list
              </Link>
            ) : null}
          </>
        )}
      </Panel>

      {/* Tomorrow's dip-buy levels: an RSI dip / KK dip signal is a price to buy at, valid for one session */}
      <Panel
        title="Dip-buy levels for the next session"
        meta={watches.length ? `${watches.length} ${watches.length === 1 ? "stock" : "stocks"} · from the close of ${date(watches[0].signal_day)}` : undefined}
      >
        {watches.length === 0 ? (
          <Empty title={scope === "mine" ? "No dip-buy levels on your stocks." : "No dip-buy levels for the next session."}>
            A level appears after a close when RSI dip or KK dip fires; it is good for the next session only.
          </Empty>
        ) : (
          <>
            <TableWrap>
              <table className="w-full min-w-[520px]">
                <thead>
                  <tr>
                    <th className={th}>Stock</th>
                    <th className={th}>Rule</th>
                    <th className={thNum}>Buy only at or under</th>
                    <th className={thNum}>Safety stop</th>
                    <th className={th}>Check</th>
                  </tr>
                </thead>
                <tbody>
                  {watches.map((w) => (
                    <tr key={`${w.symbol}-${w.strategy}`} className={tr}>
                      <td className={td}>
                        <Link prefetch={false} href={`/app/markets/${encodeURIComponent(w.symbol)}`} className="num font-medium hover:underline">
                          {w.symbol}
                        </Link>
                      </td>
                      <td className={td + " text-muted-foreground"}>{strategyLabel[w.strategy] ?? w.strategy}</td>
                      <td className={tdNum + " font-medium"}>₹{price(Number(w.limit_price))}</td>
                      <td className={tdNum + " text-loss"}>₹{price(Number(w.stop))}</td>
                      <td className={td}>
                        {w.strategy === "rsi_dip" && tags.has(checkKey("rsi_dip", w.symbol, w.signal_day)) ? (
                          <CheckTag rule="rsi_dip" />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <p className="mt-3 text-[12px] leading-5 text-muted-foreground">
              If the price trades down to the level in the next session the rule buys there; if not, the level expires. {DIP_EXIT}.
            </p>
          </>
        )}
      </Panel>
    </div>
  );

  const filterGroup = (label: string, param: "status" | "rules", value: string, options: { key: string; label: string }[]) => (
    <div role="group" aria-label={label} className="flex max-w-full flex-wrap rounded-md border border-border p-0.5 text-[11.5px]">
      {options.map((f) => (
        <Link
          prefetch={false}
          key={f.key}
          aria-current={value === f.key ? "true" : undefined}
          href={link({ [param]: f.key, more: "" })}
          className={clsx(
            "rounded-[5px] px-2 py-0.5 transition-colors",
            value === f.key ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {f.label}
        </Link>
      ))}
    </div>
  );

  const allTab = (
    <Panel
      title={strategy ? `${strategyLabel[strategy]} signals` : rules === "old" ? "Old rules' signals" : "Signals"}
      meta={`${displayedSignals.length} listed`}
      actions={
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {filterGroup("Show", "status", statusFilter, [
            { key: "", label: "All" },
            { key: "open", label: "Open buys" },
            { key: "closed", label: "Closed" },
          ])}
          {strategy ? (
            <Link prefetch={false} href={link({ strategy: "" })} className="rounded-md border border-border px-2 py-0.5 text-[11.5px] text-muted-foreground hover:text-foreground">
              {strategyLabel[strategy]} ✕
            </Link>
          ) : (
            filterGroup("Rules", "rules", rules, [
              { key: "", label: `${Count} rules` },
              { key: "old", label: "Old rules" },
              { key: "all", label: "Both" },
            ])
          )}
        </div>
      }
    >
      {displayedSignals.length === 0 ? (
        <Empty title={statusFilter ? "No signals match the selected filter." : scope === "mine" ? "No signals on your stocks." : "No signals."}>
          {statusFilter ? (
            <Link prefetch={false} href={link({ status: "" })} className="text-foreground underline underline-offset-4">
              Show all signals
            </Link>
          ) : scope === "mine" ? (
            <>
              Signals only show for stocks on your radar or in your portfolio.{" "}
              <Link prefetch={false} href={link({ scope: "all" })} className="text-foreground underline underline-offset-4">
                See everything
              </Link>
              .
            </>
          ) : null}
        </Empty>
      ) : (
        <>
          {/* Phones: one card per signal */}
          <ul className="flex flex-col divide-y divide-border sm:hidden" data-testid="signal-cards">
            {shownSignals.map(({ sg, at, last, since, evaluation, action, closed, result, own }) => (
              <li key={sg.id} className="flex flex-col gap-1 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <Link prefetch={false} href={`/app/markets/${encodeURIComponent(sg.symbol)}`} className="num font-medium hover:underline">
                      {sg.symbol}
                    </Link>
                    <Badge tone={action === "buy" || action === "cover" ? "gain" : "loss"}>{ACTION_LABEL[action]}</Badge>
                  </span>
                  <span className="num text-[11.5px] text-muted-foreground">{date(sg.generated_at)}</span>
                </div>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                  {strategyLabel[sg.strategy] ?? sg.strategy}
                  {tag(sg, action)}
                  {evaluation ? <Badge tone={evaluation.statusTone}>{evaluation.statusLabel}</Badge> : own ? <Badge tone={own.status.tone}>{own.status.label}</Badge> : null}
                </p>
                <p className="num flex flex-wrap items-baseline gap-x-2 text-[12px]">
                  <span className="text-muted-foreground">₹{price(at)}</span>
                  {closed ? (
                    <span className="flex items-center gap-1 text-muted-foreground">Closed {result != null ? <Delta value={result} /> : null}</span>
                  ) : (
                    <>
                      <span>→ {last ? `₹${price(last)}` : "—"}</span>
                      <Delta value={since} />
                      {own?.stop ? <span className="text-muted-foreground">· stop <span className="text-loss">₹{price(own.stop)}</span></span> : null}
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>

          {/* Wider screens: the full table */}
          <div className="hidden sm:block">
            <TableWrap>
              <table className="w-full min-w-[900px]">
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
                  </tr>
                </thead>
                <tbody>
                  {shownSignals.map(({ sg, at, last, since, evaluation, action, closed, result, own }) => {
                    const plan = evaluation?.plan;
                    const targets = plan && plan.isValid ? [plan.t1, plan.t2, plan.t3] : [];
                    const next = targets.findIndex((t) => !last || last < t);
                    return (
                      <tr key={sg.id} className={tr}>
                        <td className={td + " num text-muted-foreground"}>{date(sg.generated_at)}</td>
                        <td className={td}>
                          <Link prefetch={false} href={`/app/markets/${encodeURIComponent(sg.symbol)}`} className="num font-medium hover:underline">
                            {sg.symbol}
                          </Link>
                        </td>
                        <td className={td}>
                          <Badge tone={action === "buy" || action === "cover" ? "gain" : "loss"}>{ACTION_LABEL[action]}</Badge>
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
                          <div className="flex flex-col items-start gap-1">
                            {strategyLabel[sg.strategy] ?? sg.strategy}
                            {tag(sg, action)}
                          </div>
                        </td>
                        <td className={tdNum}>₹{price(at)}</td>
                        <td className={tdNum}>
                          {plan && plan.isValid ? (
                            <div className="flex flex-col items-end">
                              <span className="num font-medium text-loss">₹{price(plan.stop)}</span>
                              <span className="text-[10px] text-muted-foreground">−{plan.riskPercent.toFixed(1)}%</span>
                            </div>
                          ) : own?.stop && at ? (
                            <div className="flex flex-col items-end" title={own.stopTitle}>
                              <span className="num font-medium text-loss">₹{price(own.stop)}</span>
                              <span className="text-[10px] text-muted-foreground">−{(((at - own.stop) / at) * 100).toFixed(1)}%</span>
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
                            <div className="flex flex-col items-end" title={`Targets: ${targets.map((t, i) => `${i + 1}) ₹${price(t)}`).join("  ")}`}>
                              {next === -1 ? (
                                <span className="font-sans text-[12px] font-medium text-gain">All 3 reached</span>
                              ) : (
                                <>
                                  <span className="num">₹{price(targets[next])}</span>
                                  <span className="font-sans text-[10px] text-muted-foreground">target {next + 1} of 3</span>
                                </>
                              )}
                            </div>
                          ) : (
                            <span className="font-sans text-[12px] text-muted-foreground">
                              {action === "exit" ? "Closed the buy" : action === "cover" ? "Closed the short" : closed ? "Trade closed" : action === "sell" ? "Short trade" : "—"}
                            </span>
                          )}
                        </td>
                        <td className={tdNum}>{last ? `₹${price(last)}` : "—"}</td>
                        <td className={tdNum}>
                          <Delta value={since} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </div>
          {!more && displayedSignals.length > ROWS ? (
            <Link prefetch={false} href={link({ more: "1" })} className="mt-3 inline-block text-[12.5px] text-muted-foreground underline underline-offset-4 hover:text-foreground">
              Show all {displayedSignals.length}
            </Link>
          ) : null}
        </>
      )}
    </Panel>
  );

  const rulesTab = (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6" data-testid="rule-health">
        {STRATEGIES.map((st, i) => {
          const t = tradesBy.get(`${st.key}-long`);
          return (
            <article key={st.key} aria-label={st.title} className={clsx("panel flex min-w-0 flex-col gap-3 p-4", ruleSpan(i, STRATEGIES.length))}>
              <div>
                <h3 className="display text-[20px]">{st.title}</h3>
                <p className="mt-1 text-[13px] leading-5">{st.rule}</p>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{st.reads}</p>
              </div>
              <RuleHealthCard title={st.title} label="Lately" row={health.latest.get(st.key)} history={health.history.get(st.key) ?? []} />
              {t ? (
                <p className="text-[12px] text-muted-foreground">
                  On this site: <span className="num text-foreground">{Number(t.trades).toLocaleString("en-IN")}</span>{" "}
                  {Number(t.trades) === 1 ? "trade" : "trades"} closed,{" "}
                  <span className="num text-foreground">{pct(t.made_money_pct)}</span> made money.
                </p>
              ) : null}
              {st.tested ? (
                <details className="text-[12px] leading-5 text-muted-foreground">
                  <summary className="cursor-pointer select-none text-foreground">Tested record</summary>
                  <p className="mt-1">{st.tested}</p>
                </details>
              ) : null}
              <Link prefetch={false} href={link({ strategy: st.key, rules: "" })} className="mt-auto text-[12.5px] font-medium hover:underline">
                See its signals →
              </Link>
            </article>
          );
        })}
      </div>
      <p className="text-[12px] leading-5 text-muted-foreground">
        After every close, each rule&apos;s last 40 finished trades are compared with how it did in testing, and every losing trade is
        sorted by what went wrong. A rule that drifts outside its normal range is flagged for review; it is never changed or switched off
        on its own, because a short bad run is usually just noise. RSI dip, KK dip and SMA 20/50 trend replaced the old RSI reversal, KK
        breakout and SMA 20/50 cross rules, which did worse in testing; their signals stay in the list under &ldquo;Old rules&rdquo;. The
        200-day trend rule was added in November 2026; its record on this site starts with the stored prices. Secular trend was added
        on 9 November 2026: it needs about three and a half years of prices, so it signals from that day on and has no earlier signals here.
      </p>
    </div>
  );

  const recordTab = (
    <div className="flex flex-col gap-5">
      {/* Every entry signal, graded afterwards from stored prices */}
      <Panel title="Track record" meta="Every signal counted, winners and losers alike">
        {scores.length === 0 ? (
          <Empty title="No graded signals yet.">Signals are graded once 5, 20 and 60 sessions have passed.</Empty>
        ) : (
          <>
            <TableWrap>
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr>
                    <th className={th}>Rule</th>
                    <th className={thNum}>Trades closed</th>
                    <th className={thNum}>Made money</th>
                    <th className={thNum}>Average trade</th>
                    <th className={thNum}>Higher after 20 sessions</th>
                    <th className={thNum}>Vs the Nifty 500 (points)</th>
                    <th className={thNum}>Stop hit</th>
                  </tr>
                </thead>
                <tbody>
                  {scores.map((r) => {
                    const t = tradesBy.get(`${r.strategy}-${r.side}`);
                    return (
                      <tr key={`${r.strategy}-${r.side}`} className={tr}>
                        <td className={td}>{strategyLabel[r.strategy] ?? r.strategy}</td>
                        <td className={tdNum}>{t ? Number(t.trades).toLocaleString("en-IN") : "—"}</td>
                        <td className={tdNum}>{t ? pct(t.made_money_pct) : "—"}</td>
                        <td className={tdNum}>{t ? <Delta value={t.avg_result_pct == null ? null : Number(t.avg_result_pct)} /> : "—"}</td>
                        <td className={tdNum}>{pct(r.up_20_pct)}</td>
                        <td className={tdNum}>
                          <Delta value={r.vs_index_20_pts} kind="abs" />
                        </td>
                        <td className={tdNum}>{pct(r.stop_hit_20_pct)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
            <p className="mt-3 text-[12px] leading-5 text-muted-foreground">
              &ldquo;Made money&rdquo; counts every closed trade the way the rule closed it (its safety stop, its review or the bounce).
              &ldquo;Higher after 20 sessions&rdquo; grades every buy the same way, and the next column compares it with the Nifty 500
              over those sessions. Before costs (about 0.5 % a round trip). Earlier signals were worked out afterwards with the same
              rules on stored prices.
            </p>
          </>
        )}
      </Panel>

      {/* The signal checks: what each tag means and how tagged signals have done (ADR-038) */}
      <Panel title="Signal checks" meta="Nothing is hidden">
        <p className="text-[13px] leading-5">
          Two rules check how signals like today&apos;s have turned out and add a tag when the evidence is there. A tag is extra
          information: every signal is still listed and graded.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {CHECKS.map((c) => {
            const tested = CHECK_TESTED[c.rule].years;
            const live = total(liveYears(record, c.rule));
            return (
              <section key={c.rule} aria-label={c.title} className="min-w-0 rounded-md border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="display text-[18px]">{c.title}</h3>
                  <CheckTag rule={c.rule} />
                </div>
                <p className="mt-1.5 text-[13px] leading-5">{c.what}</p>
                <p className="mt-2 text-[12.5px] leading-5">{standingLine(c.rule, tested)}</p>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{periodsSentence(c.rule)}</p>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  {recordRes.error
                    ? "On this site: the record could not be loaded just now; reload to try again."
                    : live.tagged.n + live.rest.n === 0
                      ? "On this site: no checked trade has closed yet."
                      : `On this site so far: ${live.tagged.n.toLocaleString("en-IN")} tagged ${live.tagged.n === 1 ? "trade" : "trades"} closed${live.tagged.n ? `, ${Math.round(live.tagged.made)} in 100 made money` : ""}, vs ${Math.round(live.rest.made)} in 100 for the other ${live.rest.n.toLocaleString("en-IN")} checked.`}
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer select-none text-[12px] text-foreground">Tested record by year</summary>
                  <div className="mt-2">
                    <TableWrap label={`${c.title}, tested record`}>
                      <table className="w-full min-w-[360px]">
                        <thead>
                          <tr>
                            <th className={th}>Tested</th>
                            <th className={thNum}>Tagged</th>
                            <th className={thNum}>Made money</th>
                            <th className={thNum}>Others</th>
                            <th className={thNum}>Made money</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tested.map((y) => (
                            <tr key={y.year} className={tr}>
                              <td className={td + " num"}>{y.year}</td>
                              <td className={tdNum}>{y.tagged.n.toLocaleString("en-IN")}</td>
                              <td className={tdNum}>{y.tagged.n ? pct(y.tagged.made) : "—"}</td>
                              <td className={tdNum}>{y.rest.n.toLocaleString("en-IN")}</td>
                              <td className={tdNum}>{pct(y.rest.made)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableWrap>
                  </div>
                </details>
              </section>
            );
          })}
        </div>
        <p className="mt-3 text-[12px] leading-5 text-muted-foreground">
          Tested on each year&apos;s 300 most traded stocks, with every check using only what was known at the time; results by the
          rule&apos;s own plan after about 0.5 % in costs.{" "}
          {model
            ? `The RSI dip check is refitted at each quarter start on finished trades only: this one learned from ${Number(model.n_train ?? 0).toLocaleString("en-IN")} trades up to ${model.trained_through ? date(model.trained_through) : "—"}${model.valid_from < quarterStart ? "; this quarter's refit has not run yet" : ""}${model.shown === "false" ? ", and it could not rank its own past, so it tags nothing this quarter" : ""}.`
            : "The RSI dip check starts once its first model is stored."}{" "}
          Research, not advice.
        </p>
      </Panel>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Rule-based"
        title="Signals"
        description={`${Count} simple rules scan every NSE stock after each close. See what they found, what to watch in the next session, and how each rule is doing. Signals are research prompts, not advice.`}
        actions={
          <div role="group" aria-label="Stocks" className="flex rounded-md border border-border p-0.5 text-[12.5px]">
            {(["mine", "all"] as const).map((k) => (
              <Link
                prefetch={false}
                key={k}
                aria-current={scope === k ? "true" : undefined}
                href={link({ scope: k }, "")}
                className={clsx(
                  "rounded-[5px] px-3 py-1.5 transition-colors",
                  scope === k ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {k === "mine" ? "My stocks" : "Every stock"}
              </Link>
            ))}
          </div>
        }
      />

      {/* Today in one row: the market, what fired, what to watch, how the rules are doing */}
      <section aria-label="Today" className="panel grid grid-cols-2 lg:grid-cols-4">
        <div className="col-span-2 flex items-start gap-3 border-b border-border p-4 lg:col-span-1 lg:border-b-0 lg:border-r" role="region" aria-label="Market weather">
          <WeatherIcon size={22} weight="duotone" aria-hidden className="mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-[13px] font-medium">Market weather: {weather.label}</p>
            {/* The whole sentence: it names the reason the trend rules pause (cut at three lines, the reason was lost). */}
            <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
              {weather.sentence}
            </p>
          </div>
        </div>
        <a href="#today" className="flex flex-col gap-1 border-r border-border p-4 hover:bg-foreground/[0.02]">
          <span className="eyebrow">Fresh buys</span>
          <span className="num text-[22px] leading-7">{fresh.length}</span>
          <span className="text-[11.5px] text-muted-foreground">open, from the last 7 days</span>
        </a>
        <a href="#today" className="flex flex-col gap-1 p-4 hover:bg-foreground/[0.02] lg:border-r lg:border-border">
          <span className="eyebrow">To watch next session</span>
          <span className="num text-[22px] leading-7">{watches.length}</span>
          <span className="text-[11.5px] text-muted-foreground">dip-buy levels</span>
        </a>
        <a href="#rules" className="col-span-2 flex flex-col gap-1 border-t border-border p-4 hover:bg-foreground/[0.02] lg:col-span-1 lg:border-t-0">
          <span className="eyebrow">Rules lately</span>
          <span className="num text-[22px] leading-7">
            {onTrack}
            <span className="text-[14px] text-muted-foreground">/{STRATEGIES.length}</span>
            <span className="ml-1.5 font-sans text-[12px] text-muted-foreground">on track or better</span>
          </span>
          <span className="text-[11.5px] text-muted-foreground">{weaker.length ? `Weaker than usual: ${weaker.join(", ")}` : "None weaker than usual"}</span>
        </a>
      </section>

      <SectionTabs
        label="Signals"
        tabs={[
          { id: "today", label: "Today", content: todayTab },
          { id: "all", label: "All signals", content: allTab },
          { id: "rules", label: `The ${COUNT} rules`, aliases: ["health"], content: rulesTab },
          { id: "record", label: "Track record", aliases: ["checks"], content: recordTab },
        ]}
      />
    </div>
  );
}
