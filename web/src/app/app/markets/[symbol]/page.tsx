import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import { PriceChart, type ChartMarker } from "@/components/charts/price-chart";
import { AlertForm } from "@/components/market/alert-form";
import { RadarToggle } from "@/components/market/radar-toggle";
import { Badge, Delta, RangeBar } from "@/components/ui/data";
import { Empty, Panel, PlanGate, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { date, dateTime, price, qty, rupees, strategyLabel, volume } from "@/lib/format";
import type { Holding, Quote, Signal } from "@/lib/types";
import { getCandles, normalizeQuote } from "@/server/market-data";
import { can, requireSession } from "@/server/session";

export async function generateMetadata({ params }: PageProps<"/app/markets/[symbol]">): Promise<Metadata> {
  return { title: decodeURIComponent((await params).symbol).toUpperCase() };
}

type LedgerEntry = { date: string; price: number; units: number; invested: number; value: number };

export default async function SymbolPage({ params }: PageProps<"/app/markets/[symbol]">) {
  const symbol = decodeURIComponent((await params).symbol).toUpperCase();
  const s = await requireSession();
  const db = s.supabase;

  const [quoteRes, candles, signalsRes, ledgerRes, radarRes, holdingsRes, rsiRes] = await Promise.all([
    db.from("market_snapshot").select("*").eq("symbol", symbol).eq("exchange", "NSE").maybeSingle(),
    getCandles(db, symbol),
    db.from("trading_signals").select("*").eq("symbol", symbol).order("generated_at", { ascending: false }).limit(40),
    db.from("backtest_ledgers").select("ledger, roi_pct, computed_at").eq("symbol", symbol).eq("exchange", "NSE").maybeSingle(),
    db.from("watchlist_items").select("id").eq("symbol", symbol).limit(1),
    can(s, "portfolio") ? db.from("holdings").select("*").eq("symbol", symbol) : Promise.resolve({ data: [] as Holding[] }),
    db.from("rsi_events").select("ts, rsi, event_type").eq("symbol", symbol).neq("event_type", "daily").order("ts", { ascending: false }).limit(6),
  ]);
  if (!quoteRes.data) notFound();

  const q = normalizeQuote(quoteRes.data as Quote);
  const signals = (signalsRes.data ?? []) as Signal[];
  const markers: ChartMarker[] = signals.map((sg) => ({
    ts: sg.generated_at,
    kind: sg.signal_type,
    label: sg.strategy === "rsi_reversal" ? "RSI" : "MA",
  }));

  const closes = candles.map((c) => c.close);
  const sma = (n: number) => (closes.length >= n ? closes.slice(-n).reduce((a, b) => a + b, 0) / n : null);
  const sma20 = sma(20);
  const sma50 = sma(50);
  const sma200 = sma(200);

  const holdings = (holdingsRes.data ?? []) as Holding[];
  const held = holdings.reduce((a, h) => a + Number(h.quantity), 0);
  const avgCost = held ? holdings.reduce((a, h) => a + Number(h.quantity) * Number(h.avg_price), 0) / held : 0;

  const ledger = ledgerRes.data?.ledger as { entries: LedgerEntry[]; invested: number; final_value: number; installment: number } | undefined;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/app/markets" className="inline-flex w-fit items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon size={13} aria-hidden /> Markets
      </Link>

      <header className="flex flex-col gap-5 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">
            {q.exchange} · {q.sector ?? "Unclassified"}
          </p>
          <h1 className="display mt-1 text-[34px] leading-tight md:text-[42px]">{q.name}</h1>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="num text-[15px] font-medium">{q.symbol}</span>
            <span className="num text-[32px] leading-none">₹{price(q.last_price)}</span>
            <Delta value={q.change} kind="abs" className="text-[15px]" />
            <Delta value={q.change_pct} className="text-[15px]" showGlyph={false} />
            <span className="text-[12px] text-muted-foreground">Close · {date(q.as_of)}</span>
          </div>
        </div>
        <RadarToggle symbol={q.symbol} exchange={q.exchange} onRadar={Boolean(radarRes.data?.length)} size="md" />
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Price" meta="Daily · NSE">
          {candles.length ? <PriceChart candles={candles} markers={markers} symbol={q.symbol} /> : <Empty title="No price history yet." />}
        </Panel>

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

        <Panel title="Backtest ledger" meta={ledger ? `Monthly ₹${(ledger.installment ?? 10000).toLocaleString("en-IN")} SIP` : undefined}>
          {!ledger ? (
            <Empty title="No backtest yet." />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4 border-b border-border pb-4">
                <div>
                  <p className="eyebrow">Invested</p>
                  <p className="num mt-1 text-[17px]">{rupees(ledger.invested, { decimals: false })}</p>
                </div>
                <div>
                  <p className="eyebrow">Value today</p>
                  <p className="num mt-1 text-[17px]">{rupees(ledger.final_value, { decimals: false })}</p>
                </div>
                <div>
                  <p className="eyebrow">Return</p>
                  <p className="mt-1 text-[17px]">
                    <Delta value={Number(ledgerRes.data?.roi_pct)} />
                  </p>
                </div>
              </div>
              <TableWrap>
                <table className="mt-2 w-full min-w-[420px]">
                  <thead>
                    <tr>
                      <th className={th}>Month</th>
                      <th className={thNum}>Price</th>
                      <th className={thNum}>Units</th>
                      <th className={thNum}>Invested</th>
                      <th className={thNum}>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.entries.slice(-8).reverse().map((e) => (
                      <tr key={e.date} className={tr}>
                        <td className={td + " num text-muted-foreground"}>{e.date.slice(0, 7)}</td>
                        <td className={tdNum}>{price(e.price)}</td>
                        <td className={tdNum}>{Number(e.units).toFixed(3)}</td>
                        <td className={tdNum}>{rupees(e.invested, { decimals: false })}</td>
                        <td className={tdNum}>{rupees(e.value, { decimals: false })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <p className="mt-3 text-[11.5px] leading-5 text-muted-foreground">
                Computed {dateTime(ledgerRes.data?.computed_at)}. Past performance of a rule says nothing certain about the future.
              </p>
            </>
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
