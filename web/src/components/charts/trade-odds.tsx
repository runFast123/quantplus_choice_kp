"use client";

import { CaretDown, Hourglass, Scales, TrendDown, TrendUp } from "@phosphor-icons/react";
import clsx from "clsx";
import { useMemo, useState } from "react";
import { price as fmtPrice } from "@/lib/format";
import { signalAction, type TradeView } from "@/lib/signal-trade";
import { barIndex, historicalOdds, plainOdds, simulateOdds, type OddsTone } from "@/lib/trade-odds";
import type { RawChartMarker } from "@/lib/trade-plan";
import type { Candle } from "@/lib/types";

const DAYS = [5, 10, 20] as const;
const PATHS = 10_000;
const SEED = 19;

const TONE: Record<OddsTone, { icon: typeof Scales; box: string; ink: string }> = {
  target: { icon: TrendUp, box: "bg-gain-soft", ink: "text-gain" },
  stop: { icon: TrendDown, box: "bg-loss-soft", ink: "text-loss" },
  even: { icon: Scales, box: "bg-muted/40", ink: "text-foreground" },
  open: { icon: Hourglass, box: "bg-muted/40", ink: "text-muted-foreground" },
};

/** A pill-shaped segmented control (radiogroup). */
function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; text: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11.5px] text-muted-foreground">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex rounded-full bg-muted/50 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={clsx(
              "num rounded-full px-2.5 py-1 text-[11.5px] transition-colors duration-150",
              o.value === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 100 dots, one per replay: target first (top-left), then neither, then stop. */
function Waffle({ target, neither, stop, label }: { target: number; neither: number; stop: number; label: string }) {
  const cells = [
    ...Array<string>(target).fill("bg-[var(--gain)]"),
    ...Array<string>(neither).fill("bg-foreground/15"),
    ...Array<string>(stop).fill("bg-[var(--loss)]"),
  ];
  return (
    <div role="img" aria-label={label} className="grid w-[168px] shrink-0 grid-cols-10 gap-[4px]">
      {cells.map((cls, i) => (
        <span key={i} className={clsx("waffle-cell aspect-square rounded-full", cls)} style={{ "--i": i } as React.CSSProperties} />
      ))}
    </div>
  );
}

function LegendRow({ glyph, count, text, ink }: { glyph: string; count: number; text: React.ReactNode; ink: string }) {
  return (
    <li className="flex items-baseline gap-2.5">
      <span className={clsx("num w-12 shrink-0 text-[20px] font-semibold leading-none", ink)}>
        <span aria-hidden className="mr-0.5 text-[12px]">{glyph}</span>
        {count}
      </span>
      <span className="text-[12.5px] text-muted-foreground">{text}</span>
    </li>
  );
}

/**
 * Odds before the trade (ADR-032), in plain words: 10,000 replays of the next few days from the
 * stock's own past days, shown as 100 dots, plus how this signal did here before. The method sits
 * behind "How is this worked out?". Shown under the chart when a signal's trade view is open.
 */
export function TradeOdds({
  symbol,
  candles,
  trade,
  markers,
}: {
  symbol: string;
  candles: Candle[];
  trade: TradeView;
  markers: RawChartMarker[];
}) {
  const [days, setDays] = useState<number>(trade.entry.strategy === "kk_breakout" ? 5 : 10);
  // Targets to test: the signal's own, or 1:1 / 1:2 reward to risk when it carries none.
  const targets = useMemo(() => {
    if (trade.targets.length) return trade.targets.map((t) => ({ label: t.label.split(" ")[0], price: t.price }));
    if (!trade.risk) return [];
    const at = (r: number) => (trade.direction === "long" ? trade.entryPrice + r * trade.risk! : trade.entryPrice - r * trade.risk!);
    return [
      { label: "1:1", price: at(1) },
      { label: "1:2", price: at(2) },
    ];
  }, [trade]);
  const [targetIdx, setTargetIdx] = useState(0);
  const target = targets[Math.min(targetIdx, targets.length - 1)];

  const entryIndex = useMemo(() => barIndex(candles, trade.entry.ts), [candles, trade.entry.ts]);
  const plan = useMemo(
    () => (trade.stop != null && target ? { direction: trade.direction, entry: trade.entryPrice, stop: trade.stop, target: target.price, horizon: days } : null),
    [trade, target, days],
  );
  const sim = useMemo(() => (plan ? simulateOdds(candles, entryIndex, plan, { paths: PATHS, seed: SEED }) : null), [candles, entryIndex, plan]);
  const history = useMemo(() => {
    if (!plan || !sim) return null;
    const opening = signalAction(trade.entry);
    const entries = markers.filter(
      (m) => (m.strategy ?? "") === (trade.entry.strategy ?? "") && signalAction(m) === opening && new Date(m.ts) < new Date(trade.entry.ts),
    );
    return historicalOdds(candles, entries, trade.direction, sim.rAtTarget, days);
  }, [plan, sim, markers, trade, candles, days]);
  const odds = sim ? plainOdds(sim) : null;
  const entryDay = new Date(trade.entry.ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const tone = odds ? TONE[odds.tone] : null;
  const Icon = tone?.icon ?? Scales;

  return (
    <section aria-labelledby="odds-title" className="animate-fade-quick rounded-xl border border-border/70 bg-card p-4" data-testid="trade-odds">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <h3 id="odds-title" className="text-[14px] font-semibold">What usually happens next?</h3>
          <p className="text-[12px] text-muted-foreground">If this trade were taken 100 times, from {symbol}&apos;s own past days</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented label="Look ahead" options={DAYS.map((d) => ({ value: d, text: `${d} days` }))} value={days} onChange={setDays} />
          {targets.length > 1 ? (
            <Segmented
              label="Target"
              options={targets.map((t, i) => ({ value: i, text: `₹${fmtPrice(t.price)}` }))}
              value={Math.min(targetIdx, targets.length - 1)}
              onChange={setTargetIdx}
            />
          ) : null}
        </div>
      </div>

      {!plan ? (
        <p className="mt-3 text-[13px] text-muted-foreground">This signal has no stop-loss, so there is nothing to measure the odds against.</p>
      ) : !sim || !odds || !tone ? (
        <p className="mt-3 text-[13px] text-muted-foreground">Not enough price history before {entryDay} to work this out (it needs about 3 months).</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {/* The answer */}
          <div className={clsx("flex items-start gap-3 rounded-lg p-3", tone.box)}>
            <span className={clsx("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-card", tone.ink)}>
              <Icon size={18} weight="bold" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className={clsx("display text-[19px] leading-tight", tone.ink)} data-testid="odds-verdict">
                {odds.headline}
              </p>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">{odds.sentence}</p>
              {odds.won != null ? (
                <div className="mt-2.5" data-testid="odds-passmark">
                  <div className="relative h-1.5 rounded-full bg-foreground/10">
                    <div
                      className={clsx("bar-fill absolute inset-y-0 left-0 rounded-full", odds.won >= odds.needed ? "bg-[var(--gain)]" : "bg-[var(--loss)]")}
                      style={{ width: `${odds.won}%` }}
                    />
                    <span aria-hidden className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground" style={{ left: `${odds.needed}%` }} />
                  </div>
                  <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                    When one side was hit, the target won <span className="num font-medium text-foreground">{odds.won} of 100</span> times. It needs{" "}
                    <span className="num font-medium text-foreground">{odds.needed}</span> to break even
                    {odds.needed > 52 ? " (the target is closer than the stop)" : odds.needed < 48 ? " (the target is further away than the stop)" : ""}.
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          {/* The 100 replays */}
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
            <Waffle
              key={`${days}-${targetIdx}`}
              target={odds.of100.target}
              neither={odds.of100.neither}
              stop={odds.of100.stop}
              label={`Out of 100 replays: ${odds.of100.target} reached the target, ${odds.of100.neither} neither, ${odds.of100.stop} hit the stop`}
            />
            <ul className="flex flex-col gap-2.5">
              <LegendRow glyph="▲" count={odds.of100.target} ink="text-gain" text={<>reached the target <span className="num">₹{fmtPrice(plan.target)}</span> first</>} />
              <LegendRow glyph="▼" count={odds.of100.stop} ink="text-loss" text={<>hit the stop <span className="num">₹{fmtPrice(plan.stop)}</span> first</>} />
              <LegendRow glyph="•" count={odds.of100.neither} ink="text-muted-foreground" text={`hit neither, still open after ${days} days`} />
            </ul>
          </div>

          {/* How this signal did here before */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-3 text-[12.5px]" data-testid="odds-history">
            {history && history.fired > 0 ? (
              <>
                <span className="font-medium">Past signals on {symbol}:</span>
                <span className="num flex flex-wrap gap-0.5 text-[12px]" aria-hidden>
                  {history.trades.slice(-20).map((t) => (
                    <span key={t.ts} className={t.outcome === "target" ? "text-gain" : t.outcome === "stop" ? "text-loss" : "text-muted-foreground"}>
                      {t.outcome === "target" ? "▲" : t.outcome === "stop" ? "▼" : "•"}
                    </span>
                  ))}
                </span>
                <span className="text-muted-foreground">
                  {history.target} of {history.fired} reached the target first
                  {history.fired < 10 ? " · too few to rely on" : ""}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">First time this signal shows up on {symbol} with enough days after it, so there is no track record yet.</span>
            )}
          </div>

          <details className="group rounded-lg bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
            <summary className="flex list-none items-center gap-1.5 font-medium text-foreground [&::-webkit-details-marker]:hidden">
              <CaretDown size={12} weight="bold" aria-hidden className="transition-transform duration-150 group-open:rotate-180" />
              How is this worked out?
            </summary>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4">
              <li>
                The next {days} trading days were replayed {PATHS.toLocaleString("en-IN")} times. Each replayed day is a real day picked at random from {symbol}&apos;s{" "}
                {sim.poolDays} trading days before {entryDay}, so nothing after the signal is used.
              </li>
              <li>
                Entry <span className="num">₹{fmtPrice(plan.entry)}</span>, stop <span className="num">₹{fmtPrice(plan.stop)}</span>, target{" "}
                <span className="num">₹{fmtPrice(plan.target)}</span>: the target is {+sim.rAtTarget.toFixed(2)}× as far from the entry as the stop.
              </li>
              <li>A day that touches both the stop and the target counts as the stop, to stay on the safe side.</li>
              <li>
                Average result per trade: <span className="num">{sim.avgR >= 0 ? "+" : "−"}{Math.abs(sim.avgR).toFixed(2)}×</span> the amount risked.
              </li>
              {odds.of100.neither >= 40 ? (
                <li>Many replays hit neither side in {days} days. For those, the result is wherever the price ended up, which is why the average can differ from the dots.</li>
              ) : null}
              <li>Past signals: each earlier time this rule fired on {symbol}, checked on the real days that followed, with its own stop and a target the same distance away.</li>
              <li>The same inputs always give the same numbers (random seed {SEED}).</li>
            </ul>
          </details>

          <p className="text-[11.5px] text-muted-foreground">A simulation, not a prediction: news and results can do things the past never did. Research, not advice.</p>
        </div>
      )}
    </section>
  );
}
