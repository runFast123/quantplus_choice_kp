"use client";

import {
  ArrowDownIcon,
  BinocularsIcon,
  CheckCircleIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ScalesIcon,
  ShieldCheckIcon,
  TrendDownIcon,
  TrendUpIcon,
  WarningCircleIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import clsx from "clsx";
import Link from "next/link";
import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { CheckTag } from "@/components/market/check-tag";
import { HealthChip } from "@/components/market/rule-health";
import { useSymbolSearch } from "@/components/market/use-symbol-search";
import { Sparkline } from "@/components/ui/data";
import { badDays, guardrails, replayPlan, sizePlan, tradedValue, type PlanStock } from "@/lib/dry-run";
import { date, pct, price, rupees, rupeesCompact, signalDisplayName } from "@/lib/format";
import type { HealthRow } from "@/lib/rule-health";
import { isCheckRule } from "@/lib/signal-checks";
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
  /** The rule whose fresh buy put it on the list; "" for a Market Radar stock without one. */
  strategy: string;
  matchedAt: string;
  /** The buy signal's safety stop, when below the price. */
  stop: number | null;
  /** Carries a signal check tag (ADR-038). */
  tagged: boolean;
  onRadar: boolean;
  /** Daily closes, about the last two months. */
  spark: number[];
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
  { key: "all", label: "All" },
  { key: "radar", label: "My radar" },
  { key: "strong_trend", label: "New 52-week high" },
  { key: "sma_trend", label: "Trend turned up" },
  { key: "rsi_dip", label: "Bought a dip" },
  { key: "kk_dip", label: "Bought a deeper dip" },
  { key: "sma_20_50_cross", label: "Trend turned up (old rule)" },
  { key: "rsi_reversal", label: "Bounced (old rule)" },
  { key: "kk_breakout", label: "Breakout (old rule)" },
];
const TABS = [
  { key: "replay", label: "What happened" },
  { key: "bad", label: "Bad days" },
  { key: "checks", label: "Checks" },
] as const;
type Tab = (typeof TABS)[number]["key"];

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

function Pills<T extends string | number>({ label, options, value, onChange }: { label: string; options: { value: T; text: ReactNode }[]; value: T; onChange: (v: T) => void }) {
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
            "num inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] transition-colors duration-150",
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
      <span className={clsx("num whitespace-nowrap text-[16px] font-semibold leading-none", tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-foreground")}>{value}</span>
      {sub ? <span className="text-[11.5px] text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

/** The three steps across the top; each ticks itself off as the user goes. */
function Steps({ done, onGo }: { done: [boolean, boolean, boolean]; onGo: (i: number) => void }) {
  const steps = [
    ["Pick stocks", "Pick a few stocks"],
    ["Set money", "Set your money"],
    ["See results", "See what would have happened"],
  ];
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="How Dry Run works">
      {steps.map((s, i) => (
        <li key={s[1]}>
          <button
            type="button"
            onClick={() => onGo(i)}
            className={clsx(
              "flex w-full items-center gap-2 rounded-lg border p-2.5 text-left text-[12px] leading-tight transition-colors duration-150 sm:text-[12.5px]",
              done[i] ? "border-foreground/40 bg-card" : "border-border bg-card/60 text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              className={clsx(
                "num grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                done[i] ? "bg-foreground text-background" : "border border-border",
              )}
              aria-hidden
            >
              {done[i] ? <CheckIcon size={12} weight="bold" /> : i + 1}
            </span>
            <span className={clsx(done[i] && "text-foreground")}>
              <span className="sm:hidden">{s[0]}</span>
              <span className="hidden sm:inline">{s[1]}</span>
              <span className="sr-only">{done[i] ? " (done)" : ""}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

const signedRupees = (n: number) => `${n > 0 ? "▲ +" : n < 0 ? "▼ " : ""}${rupees(n, { decimals: false })}`;
const SHADES = ["bg-foreground/85", "bg-foreground/60", "bg-foreground/40", "bg-foreground/25", "bg-foreground/15"];

/**
 * Dry Run (ADR-033): the user's own plan on past prices. They pick stocks (today's rule matches, their Market Radar or
 * any stock) and an amount; the plan panel sizes it live, and the results show what the same money did, its worst
 * stretches and a checklist of general guardrails. It never picks stocks or amounts for them.
 */
export function DryRunStudio({ candidates, benchmark, health }: { candidates: Candidate[]; benchmark: Candle[]; health: Record<string, HealthRow> }) {
  const ack = useSyncExternalStore(ackSubscribe, ackSnapshot, () => false);
  const [agree, setAgree] = useState(false);
  const [total, setTotal] = useState(250_000);
  const [amountText, setAmountText] = useState("2,50,000");
  const [amountSet, setAmountSet] = useState(false);
  const [cashPct, setCashPct] = useState(10);
  const [rule, setRule] = useState("all");
  const [shown, setShown] = useState(12);
  const [picks, setPicks] = useState<string[]>([]);
  const [data, setData] = useState<Record<string, StockData | "loading" | "error">>({});
  const [stops, setStops] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>("replay");
  const [q, setQ] = useState("");
  const { hits } = useSymbolSearch(q, 6);
  const pickRef = useRef<HTMLElement>(null);
  const planRef = useRef<HTMLElement>(null);
  const resultRef = useRef<HTMLElement>(null);

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
  const setAmount = (n: number) => {
    setTotal(n);
    setAmountText(n ? n.toLocaleString("en-IN") : "");
    setAmountSet(true);
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: candidates.length, radar: candidates.filter((x) => x.onRadar).length };
    for (const x of candidates) if (x.strategy) c[x.strategy] = (c[x.strategy] ?? 0) + 1;
    return c;
  }, [candidates]);
  const listed = candidates.filter((c) => rule === "all" || (rule === "radar" ? c.onRadar : c.strategy === rule));

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
        return { symbol, state: "ready", d, lastPrice, odds: sim ? plainOdds(sim) : null, signalStop } as const;
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
  const go = (i: number) => [pickRef, planRef, resultRef][i].current?.scrollIntoView({ behavior: "smooth", block: "start" });

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

  const ready = picked.filter((p) => p.state === "ready").length;

  return (
    <div className="flex flex-col gap-5 pb-16 lg:pb-0" data-testid="dry-run">
      <DryRunDisclosure compact />
      <Steps done={[picks.length > 0, picks.length > 0 && amountSet, Boolean(replay)]} onGo={go} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* ---------------------------------------------------------------- pick */}
        <section ref={pickRef} aria-labelledby="dr-pick" className="scroll-mt-24 rounded-xl border border-border bg-card p-4 md:p-5">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 id="dr-pick" className="display text-[20px] leading-tight">
                Pick a few stocks
              </h2>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                Fresh rule buys among India&apos;s 500 largest companies (last 3 weeks) and your Market Radar.{" "}
                <span className="text-foreground">A match is research, not a tip.</span>
              </p>
            </div>
            <div className="relative w-full sm:w-60">
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

          <div className="-mx-1 mb-3 overflow-x-auto px-1 pb-1 no-scrollbar">
            <Pills
              label="Show"
              options={RULES.filter((r) => r.key === "all" || counts[r.key]).map((r) => ({
                value: r.key,
                text: (
                  <>
                    {r.key === "radar" ? <BinocularsIcon size={12} aria-hidden /> : null}
                    {r.label} <span className="font-semibold">{counts[r.key] ?? 0}</span>
                  </>
                ),
              }))}
              value={rule}
              onChange={(r) => {
                setRule(r);
                setShown(12);
              }}
            />
          </div>

          {listed.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
              {rule === "radar" ? "Nothing on your Market Radar yet. " : "No fresh rule matches right now. "}You can still add any stock above.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 2xl:grid-cols-3" data-testid="dry-run-candidates">
              {listed.slice(0, shown).map((c) => (
                <CandidateCard
                  key={c.symbol}
                  c={c}
                  on={picks.includes(c.symbol)}
                  full={picks.length >= MAX_PICKS}
                  health={health[c.strategy]}
                  onToggle={() => (picks.includes(c.symbol) ? remove(c.symbol) : add(c.symbol))}
                />
              ))}
            </ul>
          )}
          {listed.length > shown ? (
            <button type="button" onClick={() => setShown((n) => n + 12)} className="mx-auto mt-3 block rounded-full border border-border px-4 py-1.5 text-[12px] hover:bg-muted/40">
              Show more ({listed.length - shown} left)
            </button>
          ) : null}
        </section>

        {/* ---------------------------------------------------------------- plan */}
        <section ref={planRef} aria-labelledby="dr-plan" className="scroll-mt-24 rounded-xl border border-border bg-card p-4 md:p-5 lg:sticky lg:top-20">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 id="dr-plan" className="display text-[20px] leading-tight">
              Your plan
            </h2>
            <span className="num text-[12px] text-muted-foreground" aria-live="polite">
              {picks.length} of {MAX_PICKS} picked
            </span>
          </div>

          <div className="flex flex-col gap-2.5">
            <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
              <span className="text-[18px] text-muted-foreground">₹</span>
              <input
                aria-label="Amount to plan with"
                inputMode="numeric"
                value={amountText}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/[^\d]/g, ""));
                  setAmountText(n ? n.toLocaleString("en-IN") : "");
                  setTotal(Math.min(n || 0, 100_000_000));
                  setAmountSet(true);
                }}
                className="num w-full min-w-0 bg-transparent text-[20px] font-semibold outline-none"
              />
            </label>
            <Pills label="Quick amounts" options={AMOUNTS.map((a) => ({ value: a, text: rupeesCompact(a) }))} value={total} onChange={setAmount} />
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
              <span title="Money you keep aside and don't put into any stock.">Keep as cash</span>
              <Pills
                label="Keep aside as cash"
                options={CASH.map((c) => ({ value: c, text: `${c}%` }))}
                value={cashPct}
                onChange={(c) => {
                  setCashPct(c);
                  setAmountSet(true);
                }}
              />
            </div>
          </div>

          {picks.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-border p-5 text-center text-[12.5px] text-muted-foreground">
              Tap <span className="font-medium text-foreground">Add to plan</span> on a stock. The money is split evenly and sized here as you go.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              <AllocationBar rows={plan.rows.map((r) => ({ symbol: r.symbol, value: r.invested }))} cash={plan.cash} />
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="dry-run-plan">
                {picked.map((p) => {
                  const row = plan.rows.find((r) => r.symbol === p.symbol);
                  const Tone = p.state === "ready" && p.odds ? TONE[p.odds.tone] : null;
                  return (
                    <li key={p.symbol} className="flex flex-col gap-1.5 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-baseline gap-2">
                          <Link prefetch={false} href={`/app/markets/${encodeURIComponent(p.symbol)}`} className="num text-[13px] font-semibold hover:underline">
                            {p.symbol}
                          </Link>
                          {p.state === "ready" && row ? (
                            <span className="num truncate text-[11.5px] text-muted-foreground">
                              {row.shares} × ₹{price(row.price)} = <span className="text-foreground">{rupees(row.invested, { decimals: false })}</span>
                            </span>
                          ) : (
                            <span className="text-[11.5px] text-muted-foreground">{p.state === "error" ? "Prices not available" : "Loading prices…"}</span>
                          )}
                        </div>
                        <button type="button" onClick={() => remove(p.symbol)} aria-label={`Remove ${p.symbol}`} className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                          <XIcon size={13} aria-hidden />
                        </button>
                      </div>
                      {p.state === "ready" && row ? (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <label className="flex items-center gap-1 text-[11.5px] text-muted-foreground" title="The price where you'd get out to keep a loss small.">
                            Stop-loss ₹
                            <input
                              inputMode="decimal"
                              aria-label={`Stop-loss for ${p.symbol}`}
                              value={stops[p.symbol] ?? (p.signalStop != null ? p.signalStop.toFixed(2) : "")}
                              placeholder="none"
                              onChange={(e) => setStops((s) => ({ ...s, [p.symbol]: e.target.value }))}
                              className="num w-20 rounded-md border border-border bg-background px-1.5 py-0.5 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-ring"
                            />
                          </label>
                          <span className="num text-[11.5px]">
                            {row.lossAtStop != null ? <span className="text-loss">▼ {rupees(row.lossAtStop, { decimals: false })} at stop</span> : <span className="text-muted-foreground">No stop set</span>}
                          </span>
                          {p.odds && Tone && p.odds.of100.target + p.odds.of100.stop > 0 ? (
                            <span
                              title="When the rule matched: out of 100 replays of the next days, how many reached the signal's target first (▲) and how many its stop (▼)."
                              className={clsx("num inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]", Tone.cls)}
                            >
                              <Tone.icon size={11} weight="bold" aria-hidden />
                              {p.odds.headline} ▲{p.odds.of100.target} ▼{p.odds.of100.stop}
                            </span>
                          ) : null}
                          {row.shares === 0 ? <span className="w-full text-[11px] text-loss">▼ The share price is more than this stock&apos;s share of the money.</span> : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <div className="grid grid-cols-3 gap-2">
                <Tile label="Invested" value={rupeesCompact(plan.invested)} />
                <Tile label="Cash" value={rupeesCompact(plan.cash)} />
                <Tile
                  label="If stops hit"
                  value={plan.lossAtStops > 0 ? `▼ ${rupeesCompact(plan.lossAtStops)}` : "₹0"}
                  sub="the most you'd lose"
                  tone={plan.lossAtStops > 0 ? "loss" : undefined}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setTab("checks");
                  go(2);
                }}
                className="flex items-center gap-3 rounded-lg bg-muted/30 p-2.5 text-left hover:bg-muted/50"
              >
                <ShieldCheckIcon size={18} className="shrink-0 text-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium">Good-habit checks</span>
                  <span className="mt-1 flex gap-0.5" aria-hidden>
                    {rails.map((g) => (
                      <span key={g.key} className={clsx("h-1.5 flex-1 rounded-full", g.pass ? "bg-[var(--gain)]" : "bg-foreground/15")} />
                    ))}
                  </span>
                </span>
                <span className="num text-[15px] font-semibold">
                  {passed}/{rails.length}
                </span>
              </button>
              <button
                type="button"
                disabled={!replay}
                onClick={() => go(2)}
                className="flex items-center justify-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-opacity duration-150 disabled:opacity-40"
              >
                {replay ? "See what would have happened" : ready < picks.length ? "Loading prices…" : "Add a stock with prices"}
                <ArrowDownIcon size={13} aria-hidden />
              </button>
            </div>
          )}

          <details className="mt-4 text-[12px] text-muted-foreground">
            <summary className="cursor-pointer select-none text-foreground">What do these words mean?</summary>
            <dl className="mt-2 flex flex-col gap-1.5 leading-5">
              <div>
                <dt className="inline font-medium text-foreground">Stop-loss: </dt>
                <dd className="inline">a price you pick in advance where you would sell, so one bad stock costs a little, not a lot.</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Rule match: </dt>
                <dd className="inline">the stock met one of four published rules on its last close. It explains why it is listed; it is not a tip.</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Rule lately: </dt>
                <dd className="inline">how that rule&apos;s last 40 finished trades went compared with its tested record.</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Replay: </dt>
                <dd className="inline">the same money put into the same stocks two years ago and held until today.</dd>
              </div>
            </dl>
          </details>
        </section>
      </div>

      {/* ---------------------------------------------------------------- results */}
      <section ref={resultRef} aria-labelledby="dr-result" className="scroll-mt-24 rounded-xl border border-border bg-card p-4 md:p-5" id="dry-run-replay">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="dr-result" className="display text-[20px] leading-tight">
              What would have happened
            </h2>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {replay
                ? `The same amounts put into the same stocks on ${date(replay.start)}, held until ${date(replay.end)}.${
                    replay.limitedBy.length ? ` It starts then because our prices for ${replay.limitedBy.join(", ")} begin that day.` : ""
                  }`
                : "Pick a stock and the replay appears here."}
            </p>
          </div>
          {picks.length ? (
            <div role="tablist" aria-label="Results" className="flex rounded-full border border-border p-0.5">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  id={`dr-tab-${t.key}`}
                  aria-selected={tab === t.key}
                  aria-controls={`dr-panel-${t.key}`}
                  onClick={() => setTab(t.key)}
                  className={clsx(
                    "rounded-full px-3 py-1 text-[12px] transition-colors duration-150",
                    tab === t.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                  {t.key === "checks" ? <span className="num ml-1">{passed}/{rails.length}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {!picks.length ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">Nothing to replay yet.</p>
        ) : (
          <>
            <div role="tabpanel" id="dr-panel-replay" aria-labelledby="dr-tab-replay" hidden={tab !== "replay"}>
              {replay ? (
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
              ) : (
                <p className="text-[13px] text-muted-foreground">Loading prices…</p>
              )}
            </div>

            <div role="tabpanel" id="dr-panel-bad" aria-labelledby="dr-tab-bad" hidden={tab !== "bad"}>
              <p className="mb-3 text-[12.5px] text-muted-foreground">The roughest stretches this money went through in the replay. Every plan has them; better to see them now.</p>
              {bad ? (
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
              ) : (
                <p className="text-[13px] text-muted-foreground">Loading prices…</p>
              )}
            </div>

            <div role="tabpanel" id="dr-panel-checks" aria-labelledby="dr-tab-checks" hidden={tab !== "checks"} data-testid="dry-run-guardrails">
              <div className="mb-3 flex items-center gap-4">
                <p className="num text-[30px] font-semibold leading-none" data-testid="dry-run-score">
                  {passed}
                  <span className="text-[16px] text-muted-foreground">/{rails.length}</span>
                </p>
                <p className="text-[12.5px] text-muted-foreground">General investing basics, checked on your plan. They describe good habits, not what to buy.</p>
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
          </>
        )}
      </section>

      {/* On phones the plan sits below the list: a bar keeps it one tap away. */}
      {picks.length ? (
        <div className="fixed inset-x-3 bottom-[4.5rem] z-30 flex items-center justify-between gap-3 rounded-full border border-border bg-card px-4 py-2 shadow-md md:bottom-4 lg:hidden">
          <span className="num text-[12.5px]">
            {picks.length} picked · {rupeesCompact(plan.invested)}
          </span>
          <button type="button" onClick={() => go(1)} className="rounded-full bg-foreground px-3 py-1 text-[12px] font-medium text-background">
            Your plan
          </button>
        </div>
      ) : null}

      <DryRunDisclosure />
    </div>
  );
}

/** One stock to pick: why it is listed, its last two months, its safety stop and how its rule has done lately. */
function CandidateCard({ c, on, full, health, onToggle }: { c: Candidate; on: boolean; full: boolean; health: HealthRow | undefined; onToggle: () => void }) {
  const first = c.spark[0];
  const last = c.spark.at(-1);
  const move = first && last ? ((last - first) / first) * 100 : null;
  const room = c.stop != null ? ((c.price - c.stop) / c.price) * 100 : null;
  return (
    <li
      className={clsx(
        "flex min-w-0 flex-col gap-2.5 rounded-lg border p-3 transition-colors duration-150",
        on ? "border-foreground bg-foreground/[0.03]" : "border-border hover:border-foreground/30",
      )}
    >
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
        <div className="shrink-0 text-right">
          <p className="num text-[13px]">₹{price(c.price)}</p>
          {move != null ? (
            <p className={clsx("num text-[11px]", move >= 0 ? "text-gain" : "text-loss")}>
              {move >= 0 ? "▲ +" : "▼ "}
              {Math.abs(move).toFixed(1)}%<span className="text-muted-foreground"> 2 mo</span>
            </p>
          ) : null}
        </div>
      </div>

      {c.spark.length > 1 ? <Sparkline values={c.spark} width={240} height={34} className="w-full" /> : null}

      {c.strategy ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[12px] leading-snug text-muted-foreground" title={ruleSentence(c.strategy, "buy")}>
            <span className="font-medium text-foreground">{signalDisplayName(c.strategy, "buy")}</span> on {date(c.matchedAt)}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {c.tagged && isCheckRule(c.strategy) ? <CheckTag rule={c.strategy} /> : null}
            <HealthChip row={health} prefix="Rule:" />
          </div>
          {room != null ? (
            <p className="num text-[11.5px] text-muted-foreground" title="The price where the rule says the idea is wrong.">
              Safety stop <span className="text-loss">₹{price(c.stop)}</span> · {room.toFixed(1)}% below
            </p>
          ) : null}
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <BinocularsIcon size={13} aria-hidden /> On your radar · no fresh rule buy
        </p>
      )}

      <button
        type="button"
        aria-pressed={on}
        disabled={!on && full}
        aria-label={`${on ? "Remove" : "Add"} ${c.symbol}`}
        onClick={onToggle}
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
}

/** Where the money goes: one bar, a segment per stock (labelled below), cash last. */
function AllocationBar({ rows, cash }: { rows: { symbol: string; value: number }[]; cash: number }) {
  const total = rows.reduce((a, r) => a + r.value, 0) + Math.max(0, cash);
  if (total <= 0) return null;
  const parts = [...rows.filter((r) => r.value > 0), { symbol: "Cash", value: Math.max(0, cash) }];
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {parts.map((p, i) => (
          <span
            key={p.symbol}
            className={clsx("motion-safe:transition-[width] motion-safe:duration-200", p.symbol === "Cash" ? "bg-foreground/[0.07]" : SHADES[i % SHADES.length])}
            style={{ width: `${(100 * p.value) / total}%` }}
          />
        ))}
      </span>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {parts.map((p, i) => (
          <li key={p.symbol} className="flex items-center gap-1">
            <span className={clsx("size-1.5 rounded-full", p.symbol === "Cash" ? "bg-foreground/[0.15]" : SHADES[i % SHADES.length])} aria-hidden />
            <span className="num text-foreground">{p.symbol}</span> {((100 * p.value) / total).toFixed(0)}%
          </li>
        ))}
      </ul>
    </div>
  );
}
