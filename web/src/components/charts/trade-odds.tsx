"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { price as fmtPrice } from "@/lib/format";
import { signalAction, type TradeView } from "@/lib/signal-trade";
import { barIndex, historicalOdds, oddsVerdict, simulateOdds } from "@/lib/trade-odds";
import type { RawChartMarker } from "@/lib/trade-plan";
import type { Candle } from "@/lib/types";

const HORIZONS = [5, 10, 20] as const;
const PATHS = 10_000;
const SEED = 19;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const signedR = (r: number) => `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`;

/** Part-to-whole bar: target / neither / stop, with a 2px surface gap and every share in text. */
function OutcomeBar({ target, neither, stop, label }: { target: number; neither: number; stop: number; label: string }) {
  const parts = [
    { key: "target", value: target, cls: "bg-[var(--gain)]" },
    { key: "neither", value: neither, cls: "bg-foreground/20" },
    { key: "stop", value: stop, cls: "bg-[var(--loss)]" },
  ].filter((p) => p.value > 0);
  return (
    <div className="flex flex-col gap-1.5">
      <div role="img" aria-label={label} className="flex h-3 w-full gap-[2px] overflow-hidden rounded-sm bg-card">
        {parts.map((p) => (
          <span key={p.key} className={clsx("h-full first:rounded-l-sm last:rounded-r-sm", p.cls)} style={{ width: `${p.value * 100}%` }} />
        ))}
      </div>
      <div className="num flex flex-wrap justify-between gap-x-3 text-[11.5px]">
        <span className="text-gain">▲ Target first {pct(target)}</span>
        <span className="text-muted-foreground">Neither {pct(neither)}</span>
        <span className="text-loss">▼ Stop first {pct(stop)}</span>
      </div>
    </div>
  );
}

/**
 * Odds before the trade (ADR-032): 10,000 replays of the next sessions from the stock's own days
 * before the entry, plus every earlier time the same rule fired here. Shown under the chart when a
 * signal's trade view is open.
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
  const [horizon, setHorizon] = useState<number>(trade.entry.strategy === "kk_breakout" ? 5 : 10);
  // Targets to test: the signal's own, or 1R / 2R when it carries none.
  const targets = useMemo(() => {
    if (trade.targets.length) return trade.targets;
    if (!trade.risk) return [];
    const at = (r: number) => (trade.direction === "long" ? trade.entryPrice + r * trade.risk! : trade.entryPrice - r * trade.risk!);
    return [
      { label: "1R", price: at(1) },
      { label: "2R", price: at(2) },
    ];
  }, [trade]);
  const [targetIdx, setTargetIdx] = useState(0);
  const target = targets[Math.min(targetIdx, targets.length - 1)];

  const entryIndex = useMemo(() => barIndex(candles, trade.entry.ts), [candles, trade.entry.ts]);
  const plan = useMemo(
    () => (trade.stop != null && target ? { direction: trade.direction, entry: trade.entryPrice, stop: trade.stop, target: target.price, horizon } : null),
    [trade, target, horizon],
  );
  const sim = useMemo(() => (plan ? simulateOdds(candles, entryIndex, plan, { paths: PATHS, seed: SEED }) : null), [candles, entryIndex, plan]);
  const history = useMemo(() => {
    if (!plan || !sim) return null;
    const opening = signalAction(trade.entry);
    const entries = markers.filter(
      (m) => (m.strategy ?? "") === (trade.entry.strategy ?? "") && signalAction(m) === opening && new Date(m.ts) < new Date(trade.entry.ts),
    );
    return historicalOdds(candles, entries, trade.direction, sim.rAtTarget, horizon);
  }, [plan, sim, markers, trade, candles, horizon]);
  const verdict = sim ? oddsVerdict(sim) : null;
  const entryDay = new Date(trade.entry.ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  return (
    <section aria-labelledby="odds-title" className="animate-fade-quick rounded-md border border-border/60 bg-muted/10 p-3" data-testid="trade-odds">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="odds-title" className="text-[13px] font-semibold">Odds before the trade</h3>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {targets.length > 1 ? (
            <div role="radiogroup" aria-label="Target to test" className="flex rounded border border-border p-0.5 bg-background">
              {targets.map((t, i) => (
                <button
                  key={t.label}
                  type="button"
                  role="radio"
                  aria-checked={i === targetIdx}
                  onClick={() => setTargetIdx(i)}
                  className={clsx("num rounded px-1.5 py-0.5 transition-colors", i === targetIdx ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : null}
          <div role="radiogroup" aria-label="Sessions to replay" className="flex rounded border border-border p-0.5 bg-background">
            {HORIZONS.map((h) => (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={h === horizon}
                onClick={() => setHorizon(h)}
                className={clsx("num rounded px-1.5 py-0.5 transition-colors", h === horizon ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {h} sessions
              </button>
            ))}
          </div>
        </div>
      </div>

      {!plan ? (
        <p className="mt-2 text-[12.5px] text-muted-foreground">This signal carries no stop, so there is no risk to measure the odds against.</p>
      ) : !sim ? (
        <p className="mt-2 text-[12.5px] text-muted-foreground">Not enough history before {entryDay} to replay this trade (it needs 60 sessions).</p>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          <div>
            <p className="text-[15px] font-semibold" data-testid="odds-verdict">{verdict!.headline}</p>
            <p className="text-[12.5px] text-muted-foreground">{verdict!.detail}</p>
            {verdict!.notes.map((n) => (
              <p key={n} className="text-[12px] text-muted-foreground">{n}</p>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-[12px]">
              <span className="font-medium">{PATHS.toLocaleString("en-IN")} replays</span>{" "}
              <span className="text-muted-foreground">
                of the next {horizon} sessions, each day drawn from {symbol}&apos;s own {sim.poolDays} sessions before {entryDay} · stop ₹{fmtPrice(plan.stop)}
                , target ₹{fmtPrice(plan.target)} ({+sim.rAtTarget.toFixed(2)}R) · average result{" "}
                <span className="num text-foreground">{signedR(sim.avgR)}</span> · seed {SEED}
              </span>
            </p>
            <OutcomeBar
              target={sim.pTarget}
              neither={sim.pNeither}
              stop={sim.pStop}
              label={`Simulation: target first ${pct(sim.pTarget)}, neither ${pct(sim.pNeither)}, stop first ${pct(sim.pStop)}`}
            />
          </div>

          <div className="flex flex-col gap-1" data-testid="odds-history">
            {history && history.fired > 0 ? (
              <>
                <p className="text-[12px]">
                  <span className="font-medium">
                    This rule on {symbol} before: {history.fired} time{history.fired === 1 ? "" : "s"}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    with its own stop and a target at {+sim.rAtTarget.toFixed(2)}R over the real {horizon} sessions that followed — {history.target} target,{" "}
                    {history.stop} stop, {history.neither} neither
                  </span>
                </p>
                <OutcomeBar
                  target={history.target / history.fired}
                  neither={history.neither / history.fired}
                  stop={history.stop / history.fired}
                  label={`History: ${history.target} target first, ${history.neither} neither, ${history.stop} stop first, of ${history.fired}`}
                />
                {history.fired < 10 ? <p className="text-[11.5px] text-muted-foreground">Fewer than 10 past trades: too few to lean on.</p> : null}
              </>
            ) : (
              <p className="text-[12px] text-muted-foreground">No earlier entries of this rule on {symbol} (with a stop and {horizon} sessions after them) to compare.</p>
            )}
          </div>

          <p className="text-[11.5px] text-muted-foreground">
            A simulation, not a prediction. A day that touches both the stop and the target counts as the stop. Results, news and gaps can do things these
            sessions never did. Research from published rules, not advice.
          </p>
        </div>
      )}
    </section>
  );
}
