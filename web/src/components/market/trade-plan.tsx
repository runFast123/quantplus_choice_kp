"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  CalculatorIcon,
  CrosshairIcon,
  ShieldCheckIcon,
  TargetIcon,
  TrendUpIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { price } from "@/lib/format";
import {
  calculatePositionSize,
  calculateTradePlan,
  evaluateSentiment,
} from "@/lib/trade-plan";

export interface TradePlanProps {
  symbol?: string;
  lastPrice: number;
  rsi?: number | null;
  sma20?: number | null;
  sma50?: number | null;
  signalEntry?: number | null;
  signalStop?: number | null;
}

export function TradePlan({
  symbol,
  lastPrice,
  rsi,
  sma20,
  sma50,
  signalEntry,
  signalStop,
}: TradePlanProps) {
  // Determine baseline entry and stop reference
  const baseEntry = signalEntry ?? lastPrice;
  const defaultStop =
    signalStop ??
    (sma20 && sma20 < baseEntry
      ? sma20
      : sma50 && sma50 < baseEntry
        ? sma50
        : Number((baseEntry * 0.95).toFixed(2)));

  const [capital, setCapital] = useState<number>(100000);
  const [riskPct, setRiskPct] = useState<number>(1.0);
  const [customEntry, setCustomEntry] = useState<number>(baseEntry);
  const [customStop, setCustomStop] = useState<number>(defaultStop);
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);

  // Trade Plan Mathematical Calculations (PDF §5: 0.75R, 2.0R, 3.0R)
  const plan = useMemo(
    () =>
      calculateTradePlan({
        entry: Number(customEntry) || lastPrice,
        stop: Number(customStop) || (Number(customEntry) || lastPrice) * 0.95,
        lastPrice,
      }),
    [customEntry, customStop, lastPrice],
  );

  // Position Sizing with Strict Capital Ceiling (Fixes PDF §13 Issue #6)
  const sizing = useMemo(
    () =>
      calculatePositionSize({
        capital: Math.max(1000, Number(capital) || 100000),
        riskPct: Math.max(0.1, Math.min(10, Number(riskPct) || 1.0)),
        entry: plan.entry,
        stop: plan.stop,
      }),
    [capital, riskPct, plan.entry, plan.stop],
  );

  // Sentiment Exhaustion Stage (PDF §6: Quantum Audit / Sentiment Exhaustion Nodes)
  const sentiment = useMemo(() => evaluateSentiment(rsi), [rsi]);

  return (
    <div className="flex flex-col gap-4">
      {/* Target Nodes Grid */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div
          className={clsx(
            "rounded-md border p-3 transition-colors",
            lastPrice <= plan.stop ? "border-loss/60 bg-loss-soft/30" : "border-border bg-card",
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-loss">
              <WarningCircleIcon size={14} aria-hidden />
              <span className="eyebrow text-loss">Stop Loss (1R)</span>
            </div>
            {lastPrice <= plan.stop && (
              <span className="rounded bg-loss-soft px-1.5 py-0.2 text-[10px] font-semibold text-loss uppercase">
                Breached
              </span>
            )}
          </div>
          <p className="num mt-1 text-[16px] font-medium text-foreground">
            ₹{price(plan.stop)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            −{plan.riskPercent.toFixed(1)}% (₹{price(plan.riskPerShare)} risk)
          </p>
        </div>

        <div
          className={clsx(
            "rounded-md border p-3 transition-colors",
            lastPrice >= plan.t1 ? "border-gain/60 bg-gain-soft/30" : "border-border bg-card",
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <CrosshairIcon size={14} aria-hidden />
              <span className="eyebrow">Target 1 (0.75R)</span>
            </div>
            {lastPrice >= plan.t1 && (
              <span className="rounded bg-gain-soft px-1.5 py-0.2 text-[10px] font-semibold text-gain uppercase">
                Hit
              </span>
            )}
          </div>
          <p className="num mt-1 text-[16px] font-medium text-foreground">
            ₹{price(plan.t1)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            +{(plan.riskPercent * 0.75).toFixed(1)}% · De-risking
          </p>
        </div>

        <div
          className={clsx(
            "rounded-md border p-3 transition-colors",
            lastPrice >= plan.t2 ? "border-gain/60 bg-gain-soft/30" : "border-border bg-card",
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-gain">
              <TargetIcon size={14} aria-hidden />
              <span className="eyebrow text-gain">Target 2 (2.0R)</span>
            </div>
            {lastPrice >= plan.t2 && (
              <span className="rounded bg-gain-soft px-1.5 py-0.2 text-[10px] font-semibold text-gain uppercase">
                Hit
              </span>
            )}
          </div>
          <p className="num mt-1 text-[16px] font-medium text-gain">
            ₹{price(plan.t2)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            +{(plan.riskPercent * 2.0).toFixed(1)}% · Core objective
          </p>
        </div>

        <div
          className={clsx(
            "rounded-md border p-3 transition-colors",
            lastPrice >= plan.t3 ? "border-gain/60 bg-gain-soft/30" : "border-border bg-card",
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-gain">
              <TrendUpIcon size={14} aria-hidden />
              <span className="eyebrow text-gain">Target 3 (3.0R)</span>
            </div>
            {lastPrice >= plan.t3 && (
              <span className="rounded bg-gain-soft px-1.5 py-0.2 text-[10px] font-semibold text-gain uppercase">
                Hit
              </span>
            )}
          </div>
          <p className="num mt-1 text-[16px] font-medium text-gain">
            ₹{price(plan.t3)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            +{(plan.riskPercent * 3.0).toFixed(1)}% · Trend runner
          </p>
        </div>
      </div>

      {/* Sentiment Exhaustion Bar (Quantum Audit Node Logic) */}
      {sentiment && (
        <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card/60 p-3">
          <div className="flex items-center justify-between text-[12px]">
            <div className="flex items-center gap-2">
              <span className="eyebrow">Sentiment Node</span>
              <span
                className={clsx(
                  "rounded px-1.5 py-0.5 text-[11px] font-medium uppercase",
                  sentiment.tone === "gain"
                    ? "bg-gain-soft text-gain"
                    : sentiment.tone === "loss"
                      ? "bg-loss-soft text-loss"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {sentiment.label}
              </span>
            </div>
            {rsi != null && (
              <span className="num text-muted-foreground">
                RSI 14: <strong className="text-foreground">{rsi.toFixed(1)}</strong>
              </span>
            )}
          </div>
          <p className="text-[12px] text-muted-foreground">{sentiment.sub}</p>
        </div>
      )}

      {/* Toggle Position Calculator */}
      <div className="rounded-md border border-border bg-card">
        <button
          type="button"
          onClick={() => setIsCalculatorOpen(!isCalculatorOpen)}
          className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-[13px] font-medium transition-colors hover:bg-foreground/[0.03]"
        >
          <span className="flex items-center gap-2 text-foreground">
            <CalculatorIcon size={16} className="text-muted-foreground" aria-hidden />
            Position sizing calculator {symbol ? `· ${symbol}` : ""}
          </span>
          <span className="text-[12px] text-muted-foreground">
            {isCalculatorOpen ? "Hide" : "Calculate sizing"}
          </span>
        </button>

        {isCalculatorOpen && (
          <div className="border-t border-border p-3.5 animate-fadeIn">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1">
                <span className="eyebrow">Account Capital (₹)</span>
                <input
                  type="number"
                  min="1000"
                  step="5000"
                  value={capital}
                  onChange={(e) => setCapital(Number(e.target.value) || 0)}
                  className="num h-9 w-full rounded-md border border-input bg-card px-2.5 text-[13px] text-foreground focus:border-foreground focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="eyebrow">Risk Per Trade (%)</span>
                <input
                  type="number"
                  min="0.1"
                  max="10"
                  step="0.5"
                  value={riskPct}
                  onChange={(e) => setRiskPct(Number(e.target.value) || 0)}
                  className="num h-9 w-full rounded-md border border-input bg-card px-2.5 text-[13px] text-foreground focus:border-foreground focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="eyebrow">Entry Price (₹)</span>
                <input
                  type="number"
                  step="0.05"
                  value={customEntry}
                  onChange={(e) => setCustomEntry(Number(e.target.value) || 0)}
                  className="num h-9 w-full rounded-md border border-input bg-card px-2.5 text-[13px] text-foreground focus:border-foreground focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="eyebrow">Stop Loss (₹)</span>
                <input
                  type="number"
                  step="0.05"
                  value={customStop}
                  onChange={(e) => setCustomStop(Number(e.target.value) || 0)}
                  className="num h-9 w-full rounded-md border border-input bg-card px-2.5 text-[13px] text-foreground focus:border-foreground focus:outline-none"
                />
              </label>
            </div>

            {/* Sizing Results */}
            <div className="mt-4 grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:grid-cols-4">
              <div className="rounded border border-border/70 p-2.5">
                <span className="eyebrow">Recommended Size</span>
                <p className="num mt-0.5 text-[15px] font-semibold text-foreground">
                  {sizing.units.toLocaleString("en-IN")} units
                </p>
                <p className="text-[11px] text-muted-foreground">
                  ₹{price(sizing.exposure)} outlay
                </p>
              </div>

              <div className="rounded border border-border/70 p-2.5">
                <span className="eyebrow">Risk at Stop</span>
                <p className="num mt-0.5 text-[15px] font-semibold text-loss">
                  −₹{price(sizing.maxLoss)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Budget: ₹{price(sizing.riskBudget)}
                </p>
              </div>

              <div className="rounded border border-border/70 p-2.5">
                <span className="eyebrow">Gain at Target 2</span>
                <p className="num mt-0.5 text-[15px] font-semibold text-gain">
                  +₹{price(sizing.gainT2)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  2.0R target (₹{price(plan.t2)})
                </p>
              </div>

              <div className="rounded border border-border/70 p-2.5">
                <span className="eyebrow">Capital Utilization</span>
                <p className="num mt-0.5 text-[15px] font-semibold text-foreground">
                  {sizing.exposurePct.toFixed(1)}%
                </p>
                <p className="text-[11px] text-muted-foreground">
                  of ₹{price(capital)} capital
                </p>
              </div>
            </div>

            {sizing.isCappedByCash && (
              <div className="mt-3 flex items-start gap-2 rounded border border-border bg-muted/40 p-2.5 text-[12px] text-muted-foreground">
                <ShieldCheckIcon size={16} className="mt-0.5 shrink-0 text-foreground" aria-hidden />
                <span>
                  <strong>Capital Protection Active:</strong> For a tight stop, unconstrained fractional sizing would exceed your account capital. Position size is capped at 100% available cash ({sizing.units} shares).
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
