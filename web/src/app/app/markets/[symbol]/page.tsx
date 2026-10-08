import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import { MarketChartView } from "@/components/charts/market-chart-view";
import type { ChartMarker } from "@/components/charts/price-chart";
import { AlertForm } from "@/components/market/alert-form";
import { BacktestLab } from "@/components/market/backtest-lab";
import { RadarToggle } from "@/components/market/radar-toggle";
import { TradePlan } from "@/components/market/trade-plan";
import { NewsList } from "@/components/news/news-list";
import { AiRead } from "@/components/research/ai-read";
import { SymbolAiChat } from "@/components/research/symbol-ai-chat";
import { FactorBreakdown } from "@/components/research/factor-breakdown";
import { Badge, Delta, RangeBar, ScoreBar, StanceBadge } from "@/components/ui/data";
import { Empty, Panel, PlanGate, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { date, price, qty, rupees, signalDisplayName, signedInt, strategyLabel, volume } from "@/lib/format";
import { PRICE_SOURCE } from "@/lib/market";
import type { Holding, Quote, RetiredSymbol, Signal } from "@/lib/types";
import { RetiredNote } from "@/components/market/retired-note";
import { getCandles, getRetired, normalizeQuote } from "@/server/market-data";
import { getNews, getResearch } from "@/server/news-data";
import { can, requireSession } from "@/server/session";

export async function generateMetadata({ params }: PageProps<"/app/markets/[symbol]">): Promise<Metadata> {
  return { title: decodeURIComponent((await params).symbol).toUpperCase() };
}

export default async function SymbolPage({ params }: PageProps<"/app/markets/[symbol]">) {
  const symbol = decodeURIComponent((await params).symbol).toUpperCase();
  const s = await requireSession();
  const db = s.supabase;

  const [quoteRes, candles, signalsRes, radarRes, holdingsRes, rsiRes] = await Promise.all([
    db.from("market_snapshot").select("*").eq("symbol", symbol).eq("exchange", "NSE").maybeSingle(),
    getCandles(db, symbol),
    db.from("trading_signals").select("*").eq("symbol", symbol).order("generated_at", { ascending: false }).limit(40),
    db.from("watchlist_items").select("id").eq("symbol", symbol).limit(1),
    can(s, "portfolio") ? db.from("holdings").select("*").eq("symbol", symbol) : Promise.resolve({ data: [] as Holding[] }),
    db.from("rsi_events").select("ts, rsi, event_type").eq("symbol", symbol).neq("event_type", "daily").order("ts", { ascending: false }).limit(6),
  ]);
  if (!quoteRes.data) {
    const retired = (await getRetired(db, [symbol])).get(symbol);
    if (!retired) notFound();
    return <RetiredSymbolPage r={retired} />;
  }

  const q = normalizeQuote(quoteRes.data as Quote);
  const signals = (signalsRes.data ?? []) as Signal[];
  const markers: ChartMarker[] = signals.map((sg) => ({
    ts: sg.generated_at,
    kind: sg.signal_type,
    label: signalDisplayName(sg.strategy, sg.signal_type),
    strategy: sg.strategy,
    price: Number(sg.payload.close ?? sg.payload.trigger_price ?? 0) || null,
    stop: Number(sg.payload.stop ?? 0) || null,
  }));

  const latestBuySignal = signals.find((s) => s.signal_type === "buy");
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

  const [[note], news, aiKeysRes, aiConsentRes] = await Promise.all([
    getResearch(db, [symbol]),
    getNews(db, { symbols: [symbol], limit: 12 }),
    can(s, "ai_byok") ? db.from("ai_provider_keys").select("id").eq("status", "active").neq("provider", "other").limit(1) : Promise.resolve({ data: [] }),
    db.from("user_consents").select("id").eq("purpose", "ai_processing").is("withdrawn_at", null).limit(1),
  ]);
  const aiReason = !can(s, "ai_byok")
    ? "AI reads with your own key are part of Pro."
    : !aiConsentRes.data?.length
      ? "Allow AI processing in Settings → Privacy, then add a key in"
      : !aiKeysRes.data?.length
        ? "Add an Anthropic, OpenAI or Gemini key in"
        : undefined;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/app/markets" className="inline-flex w-fit items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon size={13} aria-hidden /> Markets
      </Link>

      <header className="flex flex-col gap-5 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">
            {q.exchange} · {q.segment === "index" ? "Index" : q.segment === "etf" ? "ETF" : `${q.sector ?? "Unclassified"}${q.segment === "sme" ? " · SME" : ""}`}
          </p>
          <h1 className="display mt-1 text-[34px] leading-tight md:text-[42px]">{q.name}</h1>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="num text-[15px] font-medium">{q.symbol}</span>
            <span className="num text-[32px] leading-none">₹{price(q.last_price)}</span>
            <Delta value={q.change} kind="abs" className="text-[15px]" />
            <Delta value={q.change_pct} className="text-[15px]" showGlyph={false} />
            <span className="text-[12px] text-muted-foreground">
              Close · {date(q.as_of)} · {PRICE_SOURCE}
            </span>
          </div>
        </div>
        <RadarToggle symbol={q.symbol} exchange={q.exchange} onRadar={Boolean(radarRes.data?.length)} size="md" />
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-6">
          <MarketChartView candles={candles} markers={markers} symbol={q.symbol} exchange={q.exchange} />

          {q.last_price ? (
            <Panel
              title="Trade plan & targets"
              meta={latestBuySignal ? `Anchored to ${strategyLabel[latestBuySignal.strategy] ?? latestBuySignal.strategy} signal` : "Asymmetric 0.75R / 2.0R / 3.0R model"}
            >
              <TradePlan
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

        <div className="flex flex-col gap-6">
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

          {can(s, "alerts") ? (
            <Panel title="Price alert">
              <AlertForm symbol={q.symbol} lastPrice={q.last_price} compact />
            </Panel>
          ) : (
            <PlanGate feature="Price alerts" />
          )}

          {held > 0 ? (
            <Panel title="Your position">
              <dl className="grid grid-cols-2 gap-3 text-[13px]">
                <Level label="Quantity" value={qty(held)} />
                <Level label="Avg cost" value={price(avgCost)} />
                <Level label="Value" value={rupees(held * (q.last_price ?? 0))} />
                <div>
                  <dt className="eyebrow">P&amp;L</dt>
                  <dd className="mt-0.5">
                    <Delta value={(q.last_price! - avgCost) * held} kind="abs" />
                  </dd>
                </div>
              </dl>
            </Panel>
          ) : null}
        </div>
      </div>

      <div id="research" className="grid scroll-mt-24 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
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
              <div className="border-t border-border pt-4">
                <p className="eyebrow mb-2">Interactive AI Research</p>
                <SymbolAiChat symbol={q.symbol} ready={!aiReason} reason={aiReason} />
              </div>
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
              <div className="border-t border-border pt-4 flex flex-col gap-4">
                <div>
                  <p className="eyebrow mb-2">Interactive AI Research</p>
                  <SymbolAiChat symbol={q.symbol} ready={!aiReason} reason={aiReason} />
                </div>
                <div>
                  <p className="eyebrow mb-2">Full AI Research Note</p>
                  <AiRead symbol={q.symbol} ready={!aiReason} reason={aiReason} />
                </div>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Headlines" meta={news.length ? `${news.length} most recent` : undefined}>
          {news.length === 0 ? (
            <Empty title="No headlines matched yet.">We look for the company name, its common short names and its ticker across market feeds.</Empty>
          ) : (
            <NewsList items={news} showSummary={false} hideSymbol={q.symbol} />
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
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
                  {signals.slice(0, 12).map((sg) => {
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

        <Panel title="Backtest Lab" meta="Interactive SIP & rule simulation">
          {candles.length >= 20 ? (
            <BacktestLab candles={candles} symbol={q.symbol} />
          ) : (
            <Empty title="Insufficient candle history to run backtest." />
          )}
        </Panel>
      </div>
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
