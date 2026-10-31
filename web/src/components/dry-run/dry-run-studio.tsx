"use client";

import {
  CheckCircleIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ScalesIcon,
  TrendDownIcon,
  TrendUpIcon,
  WarningCircleIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import clsx from "clsx";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useSymbolSearch } from "@/components/market/use-symbol-search";
import { badDays, guardrails, replayPlan, sizePlan, tradedValue, type PlanStock } from "@/lib/dry-run";
import { date, pct, price, rupees, rupeesCompact, signalDisplayName } from "@/lib/format";
import { ruleSentence, tradeFor } from "@/lib/signal-trade";
import { oddsForTrade, plainOdds, type OddsTone } from "@/lib/trade-odds";
import type { RawChartMarker } from "@/lib/trade-plan";
import type { Candle } from "@/lib/types";
import { ReplayChart } from "./replay-chart";

export interface Candidate {
  symbol: string;
  name: string;
  sector: string | null;
  price: number;
  strategy: string;
  matchedAt: string;
}

interface StockData {
  symbol: string;
  name: string;
  sector: string | null;
  segment: string | null;
  lastPrice: number | null;
  candles: Candle[];
  markers: RawChartMarker[];
}

const MAX_PICKS = 10;
const AMOUNTS = [100_000, 250_000, 500_000, 1_000_000];
const CASH = [0, 5, 10, 20];
const RULES: { key: string; label: string }[] = [
  { key: "all", label: "All matches" },
  { key: "strong_trend", label: "New 52-week high" },
  { key: "sma_trend", label: "Leader's trend turned up" },
  { key: "rsi_dip", label: "Bought a dip" },
  { key: "kk_dip", label: "Bought a deeper dip" },
  { key: "sma_20_50_cross", label: "Trend turned up (old rule)" },
  { key: "rsi_reversal", label: "Bounced (old rule)" },
  { key: "kk_breakout", label: "Breakout (old rule)" },
];

// Acknowledgement of the disclosure, remembered in this browser.
const ACK_KEY = "qp:dry-run-ack";
const ackSubscribe = (fn: () => void) => {
  window.addEventListener("qp-dry-run-ack", fn);
  return () => window.removeEventListener("qp-dry-run-ack", fn);
};
const ackSnapshot = () => {
  try {
    return localStorage.getItem(ACK_KEY) === "1";
  } catch {
    return false;
  }
};

const TONE: Record<OddsTone, { icon: typeof ScalesIcon; cls: string }> = {
  target: { icon: TrendUpIcon, cls: "bg-gain-soft text-gain" },
  stop: { icon: TrendDownIcon, cls: "bg-loss-soft text-loss" },
  even: { icon: ScalesIcon, cls: "bg-muted text-foreground" },
  open: { icon: ScalesIcon, cls: "bg-muted text-muted-foreground" },
};

/** The fixed words that go with every Dry Run screen. */
export function DryRunDisclosure({ compact = false }: { compact?: boolean }) {
  return (
    <div className={clsx("flex gap-2.5 rounded-lg border border-border bg-muted/30 text-muted-foreground", compact ? "p-2.5 text-[11.5px]" : "p-3.5 text-[12.5px]")} data-testid="dry-run-disclosure">
      <WarningCircleIcon size={compact ? 14 : 17} className="mt-0.5 shrink-0 text-foreground" aria-hidden />
      <p className="leading-relaxed">
        <span className="font-medium text-foreground">A practice tool, not advice.</span> QuantsPulse is not a SEBI-registered investment adviser or
        research analyst. The stocks shown matched published, mechanical rules; they are not recommendations. Every number here is past prices or a
        simulation, and past results don&apos;t promise future ones. Any investment you make is your own decision, at your own risk. Consider a
        SEBI-registered adviser for advice about your situation.
      </p>
    </div>
  );
}

function Step({ n, title, sub, children, id }: { n: number; title: string; sub?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={`step-${n}`} id={id} className="rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-foreground text-[12px] font-semibold text-background">{n}</span>
        <div className="min-w-0">
          <h2 id={`step-${n}`} className="display text-[20px] leading-tight">
            {title}
          </h2>
          {sub ? <p className="mt-0.5 text-[12.5px] text-muted-foreground">{sub}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function Pills<T extends string | number>({ label, options, value, onChange }: { label: string; options: { value: T; text: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "num rounded-full border px-3 py-1.5 text-[12px] transition-colors duration-150",
            o.value === value ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "gain" | "loss" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg bg-muted/30 p-3">
      <span className="text-[11.5px] text-muted-foreground">{label}</span>
      <span className={clsx("num text-[20px] font-semibold leading-none", tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-foreground")}>{value}</span>
      {sub ? <span className="text-[11.5px] text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

const signedRupees = (n: number) => `${n > 0 ? "▲ +" : n < 0 ? "▼ " : ""}${rupees(n, { decimals: false })}`;

/**
 * Dry Run (ADR-033): the user's own plan on past prices. They choose the amount and the stocks
 * (today's rule matches, or any stock); the page sizes it, replays it, finds its worst stretches
 * and checks it against general guardrails. It never picks stocks or amounts for them.
 */
export function DryRunStudio({ candidates, benchmark }: { candidates: Candidate[]; benchmark: Candle[] }) {
  const ack = useSyncExternalStore(ackSubscribe, ackSnapshot, () => false);
  const [agree, setAgree] = useState(false);
  const [total, setTotal] = useState(250_000);
  const [amountText, setAmountText] = useState("2,50,000");
  const [cashPct, setCashPct] = useState(10);
  const [rule, setRule] = useState("all");
  const [shown, setShown] = useState(12);
  const [picks, setPicks] = useState<string[]>([]);
  const [data, setData] = useState<Record<string, StockData | "loading" | "error">>({});
  const [stops, setStops] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const { hits } = useSymbolSearch(q, 6);

  const accept = () => {
    try {
      localStorage.setItem(ACK_KEY, "1");
    } catch {}
    window.dispatchEvent(new Event("qp-dry-run-ack"));
  };

  const add = async (symbol: string) => {
    if (picks.includes(symbol) || picks.length >= MAX_PICKS) return;
    setPicks((p) => [...p, symbol]);
    if (data[symbol] && data[symbol] !== "error") return;
    setData((d) => ({ ...d, [symbol]: "loading" }));
    try {
      const res = await fetch(`/api/dry-run/stock?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as StockData;
      setData((d) => ({ ...d, [symbol]: json }));
    } catch {
      setData((d) => ({ ...d, [symbol]: "error" }));
    }
  };
  const remove = (symbol: string) => setPicks((p) => p.filter((s) => s !== symbol));

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: candidates.length };
    for (const x of candidates) c[x.strategy] = (c[x.strategy] ?? 0) + 1;
    return c;
  }, [candidates]);
  const listed = candidates.filter((c) => rule === "all" || c.strategy === rule);

  // Each picked stock with its data: the latest buy signal's stop and the odds when it matched.
  const picked = useMemo(
    () =>
      picks.map((symbol) => {
        const d = data[symbol];
        if (!d || d === "loading" || d === "error") return { symbol, state: d ?? "loading" } as const;
        const lastPrice = d.lastPrice ?? d.candles.at(-1)?.close ?? 0;
        const buy = d.markers.find((m) => m.kind === "buy");
        const trade = buy ? tradeFor(buy, d.markers) : null;
        const sim = trade && !trade.exit ? oddsForTrade(d.candles, trade) : null;
        const signalStop = buy?.stop != null && buy.stop < lastPrice && !trade?.exit ? buy.stop : null;
        return { symbol, state: "ready", d, lastPrice, buy: trade && !trade.exit ? buy : undefined, odds: sim ? plainOdds(sim) : null, signalStop } as const;
      }),
    [picks, data],
  );

  const planStocks = useMemo(
    () =>
      picked.flatMap((p): PlanStock[] => {
        if (p.state !== "ready") return [];
        const typed = stops[p.symbol];
        const stop = typed != null && typed.trim() !== "" ? Number(typed.replace(/,/g, "")) : p.signalStop;
        return [
          {
            symbol: p.symbol,
            sector: p.d.sector,
            segment: p.d.segment,
            price: p.lastPrice,
            stop: stop != null && Number.isFinite(stop) && stop > 0 ? stop : null,
            tradedValue: tradedValue(p.d.candles),
          },
        ];
      }),
    [picked, stops],
  );
  const plan = useMemo(() => sizePlan(planStocks, total, cashPct), [planStocks, total, cashPct]);
  const candleMap = useMemo(() => Object.fromEntries(picked.flatMap((p) => (p.state === "ready" ? [[p.symbol, p.d.candles]] : []))), [picked]);
  const replay = useMemo(() => replayPlan(plan, candleMap, benchmark), [plan, candleMap, benchmark]);
  const bad = replay ? badDays(replay.points) : null;
  const rails = guardrails(plan);
  const passed = rails.filter((g) => g.pass).length;

  if (!ack) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4 rounded-xl border border-border bg-card p-5" data-testid="dry-run-gate">
        <h2 className="display text-[22px]">Before you start</h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] text-muted-foreground">
          <li>Dry Run lets you try a plan on past prices. No money moves and nothing is bought.</li>
          <li>You choose the amount and the stocks. The list shows stocks that matched our published rules; a match is research, not a tip.</li>
          <li>Past prices and simulations can&apos;t tell you what happens next.</li>
        </ul>
        <DryRunDisclosure />
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-4 accent-[var(--foreground)]" />
          I understand that this is a practice tool, not investment advice, and any decision I make is my own.
        </label>
        <button
          type="button"
          disabled={!agree}
          onClick={accept}
          className="rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-opacity duration-150 disabled:opacity-40"
        >
          Start my Dry Run
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="dry-run">
      <DryRunDisclosure compact />

      <Step n={1} title="Your money" sub="How much would you like to plan with? Nothing is invested; this only sizes the plan.">
        <div className="flex flex-col gap-3">
          <label className="flex max-w-xs items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
            <span className="text-[18px] text-muted-foreground">₹</span>
            <input
              aria-label="Amount to plan with"
              inputMode="numeric"
              value={amountText}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/[^\d]/g, ""));
                setAmountText(n ? n.toLocaleString("en-IN") : "");
                setTotal(Math.min(n || 0, 100_000_000));
              }}
              className="num w-full bg-transparent text-[20px] font-semibold outline-none"
            />
          </label>
          <Pills
            label="Quick amounts"
            options={AMOUNTS.map((a) => ({ value: a, text: rupeesCompact(a) }))}
            value={total}
            onChange={(a) => {
              setTotal(a);
              setAmountText(a.toLocaleString("en-IN"));
            }}
          />
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
            <span>Keep aside as cash</span>
            <Pills label="Keep aside as cash" options={CASH.map((c) => ({ value: c, text: `${c}%` }))} value={cashPct} onChange={setCashPct} />
          </div>
        </div>
      </Step>

      <Step
        n={2}
        title="Pick stocks to try"
        sub={
          <>
            India&apos;s 500 largest companies whose latest rule signal is a fresh buy (last 3 weeks). Pick up to {MAX_PICKS}, or add any stock.{" "}
            <span className="font-medium text-foreground">A match is research, not a tip.</span>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Pills
              label="Which rule matched"
              options={RULES.filter((r) => r.key === "all" || counts[r.key]).map((r) => ({ value: r.key, text: `${r.label} ${counts[r.key] ?? 0}` }))}
              value={rule}
              onChange={(r) => {
                setRule(r);
                setShown(12);
              }}
            />
            <div className="relative w-full sm:w-64">
              <MagnifyingGlassIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                aria-label="Add any stock"
                placeholder="Or add any stock…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-full rounded-full border border-border bg-background py-1.5 pl-8 pr-3 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
              />
              {q && hits.length ? (
                <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-md">
                  {hits
                    .filter((h) => h.segment !== "index")
                    .map((h) => (
                      <li key={h.symbol}>
                        <button
                          type="button"
                          onClick={() => {
                            add(h.symbol);
                            setQ("");
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-muted/50"
                        >
                          <span className="min-w-0 truncate">
                            <span className="num font-medium">{h.symbol}</span> <span className="text-muted-foreground">{h.name}</span>
                          </span>
                          <PlusIcon size={13} aria-hidden />
                        </button>
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
          </div>

          <p className="text-[12px] text-muted-foreground" aria-live="polite">
            {picks.length} of {MAX_PICKS} picked
          </p>

          {listed.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">No fresh rule matches right now. You can still add any stock above.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="dry-run-candidates">
              {listed.slice(0, shown).map((c) => {
                const on = picks.includes(c.symbol);
                const full = !on && picks.length >= MAX_PICKS;
                return (
                  <li key={c.symbol} className={clsx("flex min-w-0 flex-col gap-2 rounded-lg border p-3 transition-colors duration-150", on ? "border-foreground" : "border-border")}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link prefetch={false} href={`/app/markets/${encodeURIComponent(c.symbol)}`} className="num text-[14px] font-semibold hover:underline">
                          {c.symbol}
                        </Link>
                        <p className="truncate text-[11.5px] text-muted-foreground">
                          {c.name}
                          {c.sector ? ` · ${c.sector}` : ""}
                        </p>
                      </div>
                      <span className="num shrink-0 text-[13px]">₹{price(c.price)}</span>
                    </div>
                    <p className="text-[12px] leading-snug text-muted-foreground">
                      <span className="text-foreground">{signalDisplayName(c.strategy, "buy")}</span> on {date(c.matchedAt)}. {ruleSentence(c.strategy, "buy")}
                    </p>
                    <button
                      type="button"
                      aria-pressed={on}
                      disabled={full}
                      aria-label={`${on ? "Remove" : "Add"} ${c.symbol}`}
                      onClick={() => (on ? remove(c.symbol) : add(c.symbol))}
                      className={clsx(
                        "mt-auto flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors duration-150 disabled:opacity-40",
                        on ? "bg-foreground text-background" : "bg-muted/60 text-foreground hover:bg-muted",
                      )}
                    >
                      {on ? <CheckCircleIcon size={14} weight="fill" aria-hidden /> : <PlusIcon size={13} aria-hidden />}
                      {on ? "In your plan" : "Add to plan"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {listed.length > shown ? (
            <button type="button" onClick={() => setShown((n) => n + 12)} className="self-center rounded-full border border-border px-4 py-1.5 text-[12px] hover:bg-muted/40">
              Show more ({listed.length - shown} left)
            </button>
          ) : null}
        </div>
      </Step>

      <Step n={3} title="Your plan" sub={`${rupees(total, { decimals: false })} split evenly over your picks after ${cashPct}% cash, in whole shares.`}>
        {picks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">Add a few stocks above to see your plan.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <Tile label="Invested" value={rupees(plan.invested, { decimals: false })} sub={`${plan.rows.length} stock${plan.rows.length === 1 ? "" : "s"}`} />
              <Tile label="Cash left" value={rupees(plan.cash, { decimals: false })} sub={pct((plan.cash / Math.max(total, 1)) * 100, 0).replace("+", "")} />
              <Tile label="If every stop-loss is hit" value={plan.lossAtStops > 0 ? signedRupees(-plan.lossAtStops) : rupees(0, { decimals: false })} sub="The most you plan to lose" tone={plan.lossAtStops > 0 ? "loss" : undefined} />
            </div>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="dry-run-plan">
              {picked.map((p) => {
                const row = plan.rows.find((r) => r.symbol === p.symbol);
                const Tone = p.state === "ready" && p.odds ? TONE[p.odds.tone] : null;
                return (
                  <li key={p.symbol} className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:gap-4">
                    <div className="flex min-w-0 items-center justify-between gap-2 md:w-44">
                      <div className="min-w-0">
                        <Link prefetch={false} href={`/app/markets/${encodeURIComponent(p.symbol)}`} className="num text-[14px] font-semibold hover:underline">
                          {p.symbol}
                        </Link>
                        <p className="truncate text-[11.5px] text-muted-foreground">{p.state === "ready" ? p.d.sector ?? "—" : p.state === "error" ? "Couldn't load prices" : "Loading…"}</p>
                      </div>
                      <button type="button" onClick={() => remove(p.symbol)} aria-label={`Remove ${p.symbol}`} className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden">
                        <XIcon size={14} aria-hidden />
                      </button>
                    </div>
                    {p.state === "ready" && row ? (
                      <>
                        <div className="num flex-1 text-[12.5px]">
                          <span className="text-foreground">{row.shares}</span> <span className="text-muted-foreground">× ₹{price(row.price)} =</span>{" "}
                          <span className="font-medium">{rupees(row.invested, { decimals: false })}</span>
                          {row.shares === 0 ? <span className="block text-[11.5px] text-loss">▼ The share price is more than this stock&apos;s share of the money.</span> : null}
                        </div>
                        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                          Stop-loss ₹
                          <input
                            inputMode="decimal"
                            aria-label={`Stop-loss for ${p.symbol}`}
                            value={stops[p.symbol] ?? (p.signalStop != null ? p.signalStop.toFixed(2) : "")}
                            placeholder="none"
                            onChange={(e) => setStops((s) => ({ ...s, [p.symbol]: e.target.value }))}
                            className="num w-24 rounded-md border border-border bg-background px-2 py-1 text-[12.5px] text-foreground outline-none focus:ring-2 focus:ring-ring"
                          />
                        </label>
                        <span className="num whitespace-nowrap text-[12px] text-muted-foreground md:w-32">
                          {row.lossAtStop != null ? <span className="text-loss">▼ {rupees(row.lossAtStop, { decimals: false })} at stop</span> : "No stop set"}
                        </span>
                        {p.odds && Tone ? (
                          <Link
                            prefetch={false}
                            href={`/app/markets/${encodeURIComponent(p.symbol)}`}
                            title="When the rule matched: out of 100 replays of the next days, how many reached the signal's target first and how many its stop. Open the chart for the details."
                            className={clsx("flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] hover:underline", Tone.cls)}
                          >
                            <Tone.icon size={13} weight="bold" aria-hidden />
                            {p.odds.headline}
                            <span className="num">
                              ▲{p.odds.of100.target} ▼{p.odds.of100.stop}
                            </span>
                          </Link>
                        ) : (
                          <span className="text-[11.5px] text-muted-foreground">No open rule signal</span>
                        )}
                        <button type="button" onClick={() => remove(p.symbol)} aria-label={`Remove ${p.symbol}`} className="hidden rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground md:block">
                          <XIcon size={14} aria-hidden />
                        </button>
                      </>
                    ) : (
                      <span className="text-[12px] text-muted-foreground">{p.state === "error" ? "Prices for this stock aren't available." : "Fetching two years of prices…"}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-[11.5px] text-muted-foreground">
              Stop-losses start at the rule signal&apos;s own stop; change them to yours. The odds chip is from when the rule matched, on the chart&apos;s replays.
            </p>
          </div>
        )}
      </Step>

      {replay ? (
        <Step
          n={4}
          title="What if you'd done this before?"
          sub={`The same amounts put into the same stocks on ${date(replay.start)}, held until ${date(replay.end)}.${
            replay.limitedBy.length ? ` It starts then because our price history for ${replay.limitedBy.join(", ")} begins on that day.` : ""
          }`}
          id="dry-run-replay"
        >
          <div className="flex flex-col gap-4">
            <p className="text-[15px] leading-relaxed" data-testid="dry-run-replay-headline">
              {rupees(replay.startValue, { decimals: false })} would be{" "}
              <span className={clsx("num font-semibold", replay.endValue >= replay.startValue ? "text-gain" : "text-loss")}>
                {rupees(replay.endValue, { decimals: false })}
              </span>{" "}
              today ({signedRupees(replay.endValue - replay.startValue)}, {pct(((replay.endValue - replay.startValue) / replay.startValue) * 100, 1)}).
              {replay.benchEnd != null ? (
                <span className="text-muted-foreground">
                  {" "}
                  The same money in the NIFTY 50: <span className="num text-foreground">{rupees(replay.benchEnd, { decimals: false })}</span>.
                </span>
              ) : null}
            </p>
            <ReplayChart points={replay.points} />
            <p className="text-[11.5px] text-muted-foreground">
              Looking back flatters stocks picked today: you already know they&apos;re here now. Someone choosing on {date(replay.start)} couldn&apos;t have.
              The past doesn&apos;t repeat on schedule.
            </p>
          </div>
        </Step>
      ) : null}

      {replay && bad ? (
        <Step n={5} title="The bad-day test" sub="The roughest stretches this plan's money went through in the replay. Every plan has them; better to see them now.">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3" data-testid="dry-run-bad-days">
            <Tile
              label="Worst single day"
              value={bad.worstDay ? signedRupees(bad.worstDay.change) : "—"}
              sub={bad.worstDay ? `${pct(bad.worstDay.pct, 1)} on ${date(bad.worstDay.ts)}` : "No down days"}
              tone={bad.worstDay ? "loss" : undefined}
            />
            <Tile
              label="Worst week (5 trading days)"
              value={bad.worstWeek ? signedRupees(bad.worstWeek.change) : "—"}
              sub={bad.worstWeek ? `${pct(bad.worstWeek.pct, 1)}, ${date(bad.worstWeek.from)} to ${date(bad.worstWeek.ts)}` : "No down weeks"}
              tone={bad.worstWeek ? "loss" : undefined}
            />
            <Tile
              label="Biggest fall from a high"
              value={bad.biggestFall ? signedRupees(bad.biggestFall.change) : "—"}
              sub={
                bad.biggestFall
                  ? `${pct(bad.biggestFall.pct, 1)}, ${date(bad.biggestFall.from)} to ${date(bad.biggestFall.ts)}. ${
                      bad.biggestFall.recoveredOn ? `Back to the high in ${bad.biggestFall.sessionsToRecover} trading days.` : "Not back to that high yet."
                    }`
                  : "It never fell from a high"
              }
              tone={bad.biggestFall ? "loss" : undefined}
            />
          </div>
        </Step>
      ) : null}

      {picks.length ? (
        <Step n={6} title="Guardrail score" sub="General investing basics, checked on your plan. They describe good habits, not what to buy.">
          <div className="flex flex-col gap-4" data-testid="dry-run-guardrails">
            <div className="flex items-center gap-4">
              <p className="num text-[34px] font-semibold leading-none" data-testid="dry-run-score">
                {passed}
                <span className="text-[18px] text-muted-foreground">/{rails.length}</span>
              </p>
              <div className="flex flex-1 gap-1" aria-hidden>
                {rails.map((g) => (
                  <span key={g.key} className={clsx("h-2 flex-1 rounded-full", g.pass ? "bg-[var(--gain)]" : "bg-foreground/15")} />
                ))}
              </div>
            </div>
            <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {rails.map((g) => (
                <li key={g.key} className="flex gap-2.5 rounded-lg bg-muted/30 p-3">
                  {g.pass ? (
                    <CheckCircleIcon size={18} weight="fill" className="mt-0.5 shrink-0 text-gain" aria-label="Passed" />
                  ) : (
                    <XCircleIcon size={18} weight="fill" className="mt-0.5 shrink-0 text-loss" aria-label="Not yet" />
                  )}
                  <div className="min-w-0 text-[12.5px]">
                    <p className="font-medium text-foreground">{g.label}</p>
                    <p className="text-muted-foreground">{g.detail}</p>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">{g.why}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Step>
      ) : null}

      <DryRunDisclosure />
    </div>
  );
}
