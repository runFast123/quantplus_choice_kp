import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import clsx from "clsx";
import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import { MarketChartView } from "@/components/charts/market-chart-view";
import type { ChartMarker } from "@/components/charts/price-chart";
import { AlertForm } from "@/components/market/alert-form";
import { BacktestLab } from "@/components/market/backtest-lab";
import { RememberSymbol } from "@/components/shell/recent-symbols";
import { CopyPineButton } from "@/components/market/copy-pine-button";
import { RadarToggle } from "@/components/market/radar-toggle";
import { TradePlan } from "@/components/market/trade-plan";
import { NewsList } from "@/components/news/news-list";
import { AiRead } from "@/components/research/ai-read";
import { SymbolAiChat } from "@/components/research/symbol-ai-chat";
import { FactorBreakdown } from "@/components/research/factor-breakdown";
import { Badge, Delta, RangeBar, ScoreBar, StanceBadge } from "@/components/ui/data";
import { Empty, Panel, PlanGate, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { date, price, qty, rupees, signedInt, strategyLabel, volume } from "@/lib/format";
import { DIP_EXIT, isDipRule } from "@/lib/dip-rules";
import { isTrendRule, reviewDate } from "@/lib/strong-trend";
import { checkKey, signalDayOf } from "@/lib/signal-checks";
import { CheckTag } from "@/components/market/check-tag";
import { HealthChip } from "@/components/market/rule-health";
import { SectionTabs } from "@/components/ui/section-tabs";
import { PRICE_SOURCE } from "@/lib/market";
import type { Holding, Quote, RetiredSymbol, Signal } from "@/lib/types";
import { RetiredNote } from "@/components/market/retired-note";
import { setupsOf } from "@/lib/setups";
import { markerFromSignal } from "@/lib/signal-trade";
import { getCandles, getRetired, getRuleHealth, normalizeQuote } from "@/server/market-data";
import { getNews, getResearch } from "@/server/news-data";
import { can, requireSession } from "@/server/session";

export async function generateMetadata({ params }: PageProps<"/app/markets/[symbol]">): Promise<Metadata> {
  return { title: decodeURIComponent((await params).symbol).toUpperCase() };
}

export default async function SymbolPage({ params }: PageProps<"/app/markets/[symbol]">) {
  const symbol = decodeURIComponent((await params).symbol).toUpperCase();
  const ALIAS_MAP: Record<string, string> = {
    FINNIFTY: "NIFTYFINSERV",
    "FIN-NIFTY": "NIFTYFINSERV",
    NIFTY50: "NIFTY",
    CNXNIFTY: "NIFTY",
    NIFTYBANK: "BANKNIFTY",
    CNXBANK: "BANKNIFTY",
    MIDCPNIFTY: "NIFTYMIDCAP50",
    NIFTYJR: "NIFTY100",
  };
  if (ALIAS_MAP[symbol]) {
    redirect(`/app/markets/${ALIAS_MAP[symbol]}`);
  }
  const s = await requireSession();
  const db = s.supabase;

  // Everything the page needs in one round trip (none of these depend on each other).
  const [quoteRes, candles, signalsRes, radarRes, holdingsRes, rsiRes, watchRes, [note], news, aiKeysRes, aiConsentRes, checkRes, health] = await Promise.all([
    db.from("market_snapshot").select("*").eq("symbol", symbol).eq("exchange", "NSE").maybeSingle(),
    getCandles(db, symbol),
    db.from("trading_signals").select("*").eq("symbol", symbol).order("generated_at", { ascending: false }).limit(200),
    db.from("watchlist_items").select("id").eq("symbol", symbol).limit(1),
    can(s, "portfolio") ? db.from("holdings").select("*").eq("symbol", symbol) : Promise.resolve({ data: [] as Holding[] }),
    db.from("rsi_events").select("ts, rsi, event_type").eq("symbol", symbol).neq("event_type", "daily").order("ts", { ascending: false }).limit(6),
    db.from("signal_watch").select("strategy, signal_day, limit_price, stop").eq("symbol", symbol),
    getResearch(db, [symbol]),
    getNews(db, { symbols: [symbol], limit: 12 }),
    can(s, "ai_byok") ? db.from("ai_provider_keys").select("id").eq("status", "active").neq("provider", "other").limit(1) : Promise.resolve({ data: [] }),
    db.from("user_consents").select("id").eq("purpose", "ai_processing").is("withdrawn_at", null).limit(1),
    db.from("signal_checks").select("strategy, signal_day").eq("symbol", symbol).eq("tagged", true).limit(200),
    getRuleHealth(db),
  ]);
  if (!quoteRes.data) {
    const retired = (await getRetired(db, [symbol])).get(symbol);
    if (!retired) notFound();
    return <RetiredSymbolPage r={retired} />;
  }

  const q = normalizeQuote(quoteRes.data as Quote);
  const signals = (signalsRes.data ?? []) as Signal[];
  const markers: ChartMarker[] = signals.map(markerFromSignal);

  // The targets calculator follows the last buy of a rule with targets. Strong trend (a safety stop and a 60-session
  // review) and the dip rules (a safety stop and a bounce exit) were tested with their own plans instead.
  const latestBuySignal = signals.find(
    (s) => s.signal_type === "buy" && !isTrendRule(s.strategy) && !isDipRule(s.strategy),
  );
  const openTrends = (["strong_trend", "sma_trend"] as const)
    .map((rule) => signals.find((s) => s.strategy === rule))
    .filter((s): s is Signal => s?.signal_type === "buy");
  const openDips = (["rsi_dip", "kk_dip"] as const)
    .map((rule) => signals.find((s) => s.strategy === rule))
    .filter((s): s is Signal => s?.signal_type === "buy");
  const watches = watchRes.data ?? [];
  // Signal checks (ADR-038): which of this stock's open signals and dip-buy levels carry a tag.
  const tagged = new Set((checkRes.data ?? []).map((c) => checkKey(c.strategy, symbol, c.signal_day)));
  const signalEntry = latestBuySignal ? Number(latestBuySignal.payload.close) : null;
  const signalStop = latestBuySignal?.payload.stop ? Number(latestBuySignal.payload.stop) : null;

  const closes = candles.map((c) => c.close);
  const sma = (n: number) => (closes.length >= n ? closes.slice(-n).reduce((a, b) => a + b, 0) / n : null);
  const sma20 = sma(20);
  const sma50 = sma(50);
  const sma200 = sma(200);

  const holdings = (holdingsRes.data ?? []) as Holding[];
  const held = holdings.reduce((a, h) => a + Number(h.quantity), 0);
  const avgCost = held ? holdings.reduce((a, h) => a + Number(h.quantity) * Number(h.avg_price), 0) / held : 0;

  const aiReason = !can(s, "ai_byok")
    ? "AI reads with your own key are part of Pro."
    : !aiConsentRes.data?.length
      ? "Allow AI processing in Settings → Privacy, then add a key in"
      : !aiKeysRes.data?.length
        ? "Add an Anthropic, OpenAI or Gemini key in"
        : undefined;

  // At a glance: where the price sits against its long average, how hot it is, and what the rules say now.
  const vs200 = sma200 && q.last_price ? ((q.last_price - sma200) / sma200) * 100 : null;
  const inRange =
    q.low_52w != null && q.high_52w != null && q.last_price != null && q.high_52w > q.low_52w
      ? ((q.last_price - q.low_52w) / (q.high_52w - q.low_52w)) * 100
      : null;
  const openNow = [...openDips, ...openTrends][0];
  const watchNow = watches[0];
  const ruleNow = openNow?.strategy ?? watchNow?.strategy;

  const notes = (
    <>
      {openTrends.map((t) => (
        <div key={t.id} className="rounded-md border border-border p-3 text-[13px] leading-5">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            Open {strategyLabel[t.strategy]} signal from {date(t.generated_at)}
            {t.strategy === "strong_trend" && tagged.has(checkKey(t.strategy, symbol, signalDayOf(t))) ? <CheckTag rule="strong_trend" /> : null}
            <HealthChip row={health.latest.get(t.strategy)} prefix="Rule:" />
          </p>
          <p className="mt-1 text-muted-foreground">
            Closed at ₹{price(Number(t.payload.close))}
            {t.strategy === "strong_trend" ? ", a new 52-week high on heavy volume" : ", the 20-day average turning above the 50-day in a market leader"}
            . Safety stop <span className="num text-loss">₹{price(Number(t.payload.stop))}</span>; review around{" "}
            {date(reviewDate(t.generated_at).toISOString())} (60 trading sessions). No fixed target: in testing, holding to
            the review did better than taking profit early.
          </p>
        </div>
      ))}
      {openDips.map((d) => (
        <div key={d.id} className="rounded-md border border-border p-3 text-[13px] leading-5">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            Open {strategyLabel[d.strategy]} trade from {date(d.generated_at)}
            {d.strategy === "rsi_dip" && tagged.has(checkKey(d.strategy, symbol, signalDayOf(d))) ? <CheckTag rule="rsi_dip" /> : null}
            <HealthChip row={health.latest.get(d.strategy)} prefix="Rule:" />
          </p>
          <p className="mt-1 text-muted-foreground">
            Bought at ₹{price(Number(d.payload.fill))} on a dip in a rising stock. {DIP_EXIT}; safety stop{" "}
            <span className="num text-loss">₹{price(Number(d.payload.stop))}</span>.
          </p>
        </div>
      ))}
      {watches.map((w) => (
        <div key={w.strategy} className="rounded-md border border-border p-3 text-[13px] leading-5">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
            <span>
              {strategyLabel[w.strategy]} level for the next session: buy only at or under <span className="num">₹{price(Number(w.limit_price))}</span>
            </span>
            {w.strategy === "rsi_dip" && tagged.has(checkKey(w.strategy, symbol, w.signal_day)) ? <CheckTag rule="rsi_dip" /> : null}
            <HealthChip row={health.latest.get(w.strategy)} prefix="Rule:" />
          </p>
          <p className="mt-1 text-muted-foreground">
            From the close of {date(w.signal_day)}. If the price trades down there in the next session the rule buys;
            otherwise the level expires. Safety stop about <span className="num text-loss">₹{price(Number(w.stop))}</span>.
          </p>
        </div>
      ))}
    </>
  );

  const planTab = (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4">
        {openTrends.length || openDips.length || watches.length ? <div className="flex flex-col gap-3">{notes}</div> : null}
        {q.last_price ? (
          <Panel
            title="Trade plan & targets"
            meta={latestBuySignal ? `From the last ${strategyLabel[latestBuySignal.strategy] ?? latestBuySignal.strategy} buy signal` : "A stop and three price targets"}
          >
            <TradePlan
              key={q.symbol}
              symbol={q.symbol}
              lastPrice={q.last_price}
              rsi={q.rsi}
              sma20={sma20}
              sma50={sma50}
              signalEntry={signalEntry}
              signalStop={signalStop}
            />
          </Panel>
        ) : null}
      </div>
      <div id="levels" className="flex min-w-0 flex-col gap-4">
        {held > 0 ? (
          <Panel title="Your position">
            <dl className="grid grid-cols-2 gap-3 text-[13px]">
              <Level label="Quantity" value={qty(held)} />
              <Level label="Avg cost" value={price(avgCost)} />
              <Level label="Value" value={rupees(held * (q.last_price ?? 0))} />
              <div>
                <dt className="eyebrow">P&amp;L</dt>
                <dd className="mt-0.5">
                  <Delta value={(q.last_price! - avgCost) * held} kind="inr" />
                </dd>
              </div>
            </dl>
          </Panel>
        ) : null}
        {can(s, "alerts") ? (
          <Panel title="Price alert">
            <AlertForm symbol={q.symbol} lastPrice={q.last_price} compact />
          </Panel>
        ) : (
          <PlanGate feature="Price alerts" />
        )}
        <Panel title="Key levels">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
            <Level label="Prev close" value={price(q.prev_close)} />
            <Level label="Volume" value={volume(q.volume)} />
            <Level label="SMA 20" value={price(sma20)} hint={sma20 && q.last_price ? (q.last_price >= sma20 ? "above" : "below") : undefined} />
            <Level label="SMA 50" value={price(sma50)} hint={sma50 && q.last_price ? (q.last_price >= sma50 ? "above" : "below") : undefined} />
            <Level label="SMA 200" value={price(sma200)} hint={sma200 && q.last_price ? (q.last_price >= sma200 ? "above" : "below") : undefined} />
            <Level label="RSI 14" value={q.rsi != null ? q.rsi.toFixed(1) : "—"} hint={q.rsi != null ? (q.rsi >= 70 ? "overbought" : q.rsi <= 30 ? "oversold" : "neutral") : undefined} />
            <div className="col-span-2 pt-1">
              <dt className="eyebrow mb-2">52-week range</dt>
              <dd>
                <RangeBar low={q.low_52w} high={q.high_52w} value={q.last_price} />
                <span className="num mt-1.5 flex justify-between text-[11.5px] text-muted-foreground">
                  <span>{price(q.low_52w)}</span>
                  <span>{price(q.high_52w)}</span>
                </span>
              </dd>
            </div>
          </dl>
        </Panel>
      </div>
    </div>
  );

  const aiBlock = aiReason ? (
    <div>
      <p className="eyebrow mb-2">AI research &amp; reads</p>
      <p className="text-[12.5px] leading-5 text-muted-foreground">
        {aiReason}{" "}
        <Link href="/app/integrations" className="text-foreground underline underline-offset-4 hover:text-foreground/80">
          Integrations
        </Link>
      </p>
    </div>
  ) : (
    <>
      <div>
        <p className="eyebrow mb-2">Ask about this stock</p>
        <SymbolAiChat symbol={q.symbol} ready={true} />
      </div>
      {note ? (
        <div>
          <p className="eyebrow mb-2">Full AI research note</p>
          <AiRead symbol={q.symbol} ready={true} />
        </div>
      ) : null}
    </>
  );

  const researchTab = (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
      <Panel
        title="Research note"
        meta={note ? `session of ${date(note.as_of)}` : undefined}
        actions={
          <Link href="/app/research" className="text-[12px] text-muted-foreground hover:text-foreground">
            All notes
          </Link>
        }
      >
        {!note ? (
          <div className="flex flex-col gap-5">
            <Empty title="No note yet.">Notes are rebuilt after each close and whenever new headlines arrive.</Empty>
            <div className="flex flex-col gap-4 border-t border-border pt-4">{aiBlock}</div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <StanceBadge stance={note.stance} />
              <ScoreBar score={note.score} width={160} />
              {note.prev_score != null ? (
                <span className="text-[12px] text-muted-foreground">
                  previous <span className="num">{signedInt(note.prev_score)}</span>
                  {note.prev_stance && note.prev_stance !== note.stance ? ` (${note.prev_stance})` : ""}
                </span>
              ) : null}
            </div>
            <p className="display text-[20px] leading-snug">{note.headline}</p>
            <FactorBreakdown factors={note.factors} />
            <div className="flex flex-col gap-4 border-t border-border pt-4">{aiBlock}</div>
          </div>
        )}
      </Panel>

      <Panel title="Headlines" meta={news.length ? `${news.length} most recent` : undefined}>
        {news.length === 0 ? (
          <Empty title="No headlines matched yet.">We look for the company name, its common short names and its ticker across market feeds.</Empty>
        ) : (
          <>
            <NewsList items={news.slice(0, 5)} showSummary={false} hideSymbol={q.symbol} />
            {news.length > 5 ? (
              <details className="group mt-2">
                <summary className="cursor-pointer select-none text-[12.5px] text-muted-foreground hover:text-foreground">
                  <span className="group-open:hidden">Show {news.length - 5} more headlines</span>
                  <span className="hidden group-open:inline">Show fewer</span>
                </summary>
                <div className="mt-2">
                  <NewsList items={news.slice(5)} showSummary={false} hideSymbol={q.symbol} />
                </div>
              </details>
            ) : null}
          </>
        )}
      </Panel>
    </div>
  );

  const historyTab = (
    <Panel title="Signal history" meta={`${signals.length} most recent`}>
      {signals.length === 0 ? (
        <Empty title="No signals yet.">Rules haven&apos;t fired on {q.symbol} in the history we hold.</Empty>
      ) : (
        <TableWrap>
          <table className="w-full min-w-[460px]">
            <thead>
              <tr>
                <th className={th}>When</th>
                <th className={th}>Rule</th>
                <th className={th}>Signal</th>
                <th className={thNum}>At</th>
                <th className={thNum}>Since</th>
              </tr>
            </thead>
            <tbody>
              {signals.slice(0, 15).map((sg) => {
                const at = Number(sg.payload.close);
                const since = q.last_price && at ? ((q.last_price - at) / at) * 100 : null;
                return (
                  <tr key={sg.id} className={tr}>
                    <td className={td + " num text-muted-foreground"}>{date(sg.generated_at)}</td>
                    <td className={td}>{strategyLabel[sg.strategy] ?? sg.strategy}</td>
                    <td className={td}>
                      <Badge tone={sg.signal_type === "buy" ? "gain" : "loss"}>{sg.signal_type === "buy" ? "BUY" : "EXIT"}</Badge>
                    </td>
                    <td className={tdNum}>{price(at)}</td>
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
      {rsiRes.data?.length ? (
        <p className="mt-4 text-[12px] text-muted-foreground">
          RSI crossings:{" "}
          {rsiRes.data.map((r, i) => (
            <span key={r.ts} className="num">
              {i ? " · " : ""}
              {date(r.ts)} {r.event_type === "oversold_cross" ? "↓30" : "↑70"} ({Number(r.rsi).toFixed(0)})
            </span>
          ))}
        </p>
      ) : null}
    </Panel>
  );

  const backtestTab = (
    <Panel title="Backtest Lab" meta="Try a monthly SIP or a rule on past prices">
      {candles.length >= 20 ? <BacktestLab candles={candles} symbol={q.symbol} /> : <Empty title="Insufficient candle history to run backtest." />}
    </Panel>
  );

  return (
    <div className="flex flex-col gap-5">
      <Link href="/app/markets" className="inline-flex w-fit items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon size={13} aria-hidden /> Markets
      </Link>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">
            {q.exchange} · {q.segment === "index" ? "Index" : q.segment === "etf" ? "ETF" : `${q.sector ?? "Unclassified"}${q.segment === "sme" ? " · SME" : ""}`}
          </p>
          <h1 className="display mt-1 text-[32px] leading-tight md:text-[40px]">{q.name}</h1>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="num text-[15px] font-medium">{q.symbol}</span>
            <span className="num text-[30px] leading-none">₹{price(q.last_price)}</span>
            <Delta value={q.change} kind="abs" className="text-[15px]" />
            <Delta value={q.change_pct} className="text-[15px]" showGlyph={false} />
            <span className="text-[12px] text-muted-foreground">
              Close · {date(q.as_of)} · {PRICE_SOURCE}
            </span>
          </div>
          {setupsOf(q.setups).length ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground" data-testid="symbol-setups">
              <span>Matched on the last close:</span>
              {setupsOf(q.setups).map((x) => (
                <Link
                  key={x.key}
                  href={`/app/markets?setup=${x.key}`}
                  title={`${x.rule} See every stock that matched today.`}
                  className="rounded-[4px] bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-foreground/80 hover:bg-foreground/[0.1] hover:text-foreground"
                >
                  {x.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <CopyPineButton symbol={q.symbol} />
          <RadarToggle symbol={q.symbol} exchange={q.exchange} onRadar={Boolean(radarRes.data?.length)} size="md" />
        </div>
      </header>

      <RememberSymbol symbol={q.symbol} name={q.name} segment={q.segment ?? "equity"} />

      {/* At a glance: five plain answers before any detail */}
      <section aria-label="At a glance" className="panel grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5" data-testid="at-a-glance">
        <Glance label="Long-term direction" className="border-b border-r border-border xl:border-b-0">
          {vs200 != null ? (
            <>
              <p className={clsx("text-[15px] font-medium", vs200 >= 0 ? "text-gain" : "text-loss")}>{vs200 >= 0 ? "▲ Rising" : "▼ Falling"}</p>
              <p className="text-[11.5px] leading-4 text-muted-foreground">
                {Math.abs(vs200).toFixed(1)}% {vs200 >= 0 ? "above" : "below"} its 200-day average
              </p>
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">Not enough history</p>
          )}
        </Glance>
        <Glance label="How hot it is" className="border-b border-border md:border-r xl:border-b-0">
          {q.rsi != null ? (
            <>
              <p className="text-[15px] font-medium">{q.rsi >= 70 ? "Running hot" : q.rsi <= 30 ? "Beaten down" : "Calm"}</p>
              <p className="text-[11.5px] leading-4 text-muted-foreground">
                RSI 14 at {q.rsi.toFixed(1)} {q.rsi >= 70 ? "(70+ = rose fast)" : q.rsi <= 30 ? "(30 or less = fell fast)" : "(between 30 and 70)"}
              </p>
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">—</p>
          )}
        </Glance>
        <Glance label="Within its year" className="border-b border-r border-border md:border-r-0 xl:border-b-0 xl:border-r">
          <RangeBar low={q.low_52w} high={q.high_52w} value={q.last_price} />
          <p className="mt-2 text-[11.5px] leading-4 text-muted-foreground">
            {inRange != null ? `${inRange.toFixed(0)}% of the way from the 52-week low to the high` : "—"}
          </p>
        </Glance>
        <Glance label="Our rules now" className="border-b border-border md:border-b-0 md:border-r">
          {ruleNow ? (
            <>
              <a href="#plan" className="text-[14px] font-medium hover:underline">
                {openNow
                  ? `${strategyLabel[openNow.strategy]} ${isDipRule(openNow.strategy) ? "trade" : "signal"} open`
                  : `${strategyLabel[watchNow!.strategy]} level ₹${price(Number(watchNow!.limit_price))}`}
              </a>
              <div className="mt-1 flex flex-wrap gap-1">
                <HealthChip row={health.latest.get(ruleNow)} prefix="Rule:" />
              </div>
            </>
          ) : (
            <>
              <p className="text-[14px] font-medium">No open signal</p>
              <p className="text-[11.5px] text-muted-foreground">None of the four rules is in a trade here</p>
            </>
          )}
        </Glance>
        <Glance label="Research note" className="col-span-2 md:col-span-1">
          {note ? (
            <>
              <a href="#research" className="flex items-center gap-2 hover:underline">
                <StanceBadge stance={note.stance} />
                <span className="num text-[12px] text-muted-foreground">{signedInt(note.score)}</span>
              </a>
              <p className="mt-1 line-clamp-2 text-[11.5px] leading-4 text-muted-foreground">{note.headline}</p>
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">No note yet</p>
          )}
        </Glance>
      </section>

      <div id="chart" className="scroll-mt-28">
        <MarketChartView candles={candles} markers={markers} symbol={q.symbol} exchange={q.exchange} />
      </div>

      <SectionTabs
        label="Stock details"
        tabs={[
          { id: "plan", label: "Plan & alerts", aliases: ["levels"], content: planTab },
          { id: "research", label: "Research & news", aliases: ["news"], content: researchTab },
          { id: "history", label: "Signal history", content: historyTab },
          { id: "backtest", label: "Backtest", content: backtestTab },
        ]}
      />
    </div>
  );
}

function Glance({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={clsx("flex min-w-0 flex-col gap-1 p-3.5", className)}>
      <span className="eyebrow">{label}</span>
      {children}
    </div>
  );
}

function Level({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 flex items-baseline gap-1.5">
        <span className="num">{value}</span>
        {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  );
}

function RetiredSymbolPage({ r }: { r: RetiredSymbol }) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/app/markets" className="inline-flex w-fit items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon size={13} aria-hidden /> Markets
      </Link>
      <header className="border-b border-border pb-6">
        <p className="eyebrow">NSE · no longer trades</p>
        <h1 className="display mt-1 text-[34px] leading-tight md:text-[42px]">{r.name}</h1>
        <p className="num mt-2 text-[15px] font-medium">{r.symbol}</p>
      </header>
      <Panel title="What happened">
        <p className="max-w-2xl text-[14px] leading-6">{r.status_note ?? "This symbol is no longer listed, so there are no new prices for it."}</p>
        <RetiredNote r={r} className="mt-3 block text-[13px] text-muted-foreground" />
      </Panel>
    </div>
  );
}
