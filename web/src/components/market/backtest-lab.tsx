"use client";

import { useId, useMemo, useState } from "react";
import clsx from "clsx";
import {
  ChartLineUpIcon,
  CheckIcon,
  CodeIcon,
  DownloadSimpleIcon,
  RepeatIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import { Delta } from "@/components/ui/data";
import { TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import {
  generateBacktestPineScript,
  simulateCustomStrategy,
  simulateSip,
  type AdvancedStrategyParams,
  type DetailedStrategyResult,
} from "@/lib/backtest-engine";
import { date, price, rupees } from "@/lib/format";
import type { Candle } from "@/lib/types";

interface BacktestLabProps {
  candles: Candle[];
  symbol: string;
}

export function BacktestLab({ candles, symbol }: BacktestLabProps) {
  const [activeTab, setActiveTab] = useState<"strategy" | "sip">("strategy");

  // Strategy configuration state
  const [strategyType, setStrategyType] = useState<"sma_cross" | "rsi_reversal" | "breakout" | "kk_breakout">("sma_cross");
  const [fastMa, setFastMa] = useState<number>(20);
  const [slowMa, setSlowMa] = useState<number>(50);
  const [rsiPeriod, setRsiPeriod] = useState<number>(14);
  const [rsiOversold, setRsiOversold] = useState<number>(30);
  const [rsiOverbought, setRsiOverbought] = useState<number>(70);
  const [breakoutPeriod, setBreakoutPeriod] = useState<number>(20);
  const [stopLossPct, setStopLossPct] = useState<number>(4.0);
  const [takeProfitPct, setTakeProfitPct] = useState<number>(0);
  const [initialCapital, setInitialCapital] = useState<number>(100000);

  // KK Breakout parameters state
  const [kkPeriod, setKkPeriod] = useState<number>(20);
  const [kkExtensionPct, setKkExtensionPct] = useState<number>(1.0);
  const [kkConfirmationBars, setKkConfirmationBars] = useState<number>(5);
  const [kkTradeWindowBars, setKkTradeWindowBars] = useState<number>(5);
  const [kkDirection, setKkDirection] = useState<"buy" | "both">("buy");

  // SIP configuration state
  const [monthlyAmount, setMonthlyAmount] = useState<number>(10000);

  // Filter & interaction state
  const [tradeFilter, setTradeFilter] = useState<"all" | "wins" | "losses">("all");
  const [copiedPine, setCopiedPine] = useState<boolean>(false);
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);

  const customSipInputId = useId();

  // Run dynamic strategy simulation
  const strategyParams: AdvancedStrategyParams = useMemo(
    () => ({
      type: strategyType,
      fastMa,
      slowMa,
      rsiPeriod,
      rsiOversold,
      rsiOverbought,
      breakoutPeriod,
      stopLossPct,
      takeProfitPct,
      initialCapital,
      kkPeriod,
      kkExtensionPct,
      kkConfirmationBars,
      kkTradeWindowBars,
      kkTarget1Fraction: 0.5,
      kkTarget1R: 0.75,
      kkTarget2R: 2.0,
      kkDirection,
    }),
    [
      strategyType,
      fastMa,
      slowMa,
      rsiPeriod,
      rsiOversold,
      rsiOverbought,
      breakoutPeriod,
      stopLossPct,
      takeProfitPct,
      initialCapital,
      kkPeriod,
      kkExtensionPct,
      kkConfirmationBars,
      kkTradeWindowBars,
      kkDirection,
    ],
  );

  const stratResult: DetailedStrategyResult | null = useMemo(() => {
    return simulateCustomStrategy(candles, strategyParams);
  }, [candles, strategyParams]);

  // Run dynamic SIP simulation
  const sipResult = useMemo(() => {
    return simulateSip(candles, monthlyAmount);
  }, [candles, monthlyAmount]);

  // Filtered trades for trade log
  const displayedTrades = useMemo(() => {
    if (!stratResult) return [];
    if (tradeFilter === "wins") return stratResult.trades.filter((t) => t.isWin);
    if (tradeFilter === "losses") return stratResult.trades.filter((t) => !t.isWin);
    return stratResult.trades;
  }, [stratResult, tradeFilter]);

  // Handle Export Trades CSV
  const handleExportCsv = () => {
    if (!stratResult || stratResult.trades.length === 0) return;
    const isKk = strategyType === "kk_breakout";
    const headers = isKk
      ? ["Entry Date", "Signal", "Entry Price (INR)", "Exit Date", "Exit Price (INR)", "Duration (Days)", "Realized R", "P&L (%)", "Milestone Result", "Win/Loss"]
      : ["Entry Date", "Entry Price (INR)", "Exit Date", "Exit Price (INR)", "Duration (Days)", "P&L (%)", "Exit Reason", "Win/Loss"];
    const rows = stratResult.trades.map((t) =>
      isKk
        ? [
            t.entryDate,
            t.signalType ?? "BUY",
            t.entryPrice.toFixed(2),
            t.exitDate,
            t.exitPrice.toFixed(2),
            t.barsHeld,
            t.realizedR != null ? t.realizedR.toFixed(3) : "-",
            t.pnlPct.toFixed(2),
            t.resultType ?? t.exitReason,
            t.isWin ? "WIN" : "LOSS",
          ]
        : [
            t.entryDate,
            t.entryPrice.toFixed(2),
            t.exitDate,
            t.exitPrice.toFixed(2),
            t.barsHeld,
            t.pnlPct.toFixed(2),
            t.exitReason,
            t.isWin ? "WIN" : "LOSS",
          ],
    );
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `quantspulse-${symbol.toLowerCase()}-backtest.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Handle Copy Pine Script v5
  const handleCopyPineScript = async () => {
    const script = generateBacktestPineScript(strategyParams, symbol);
    await navigator.clipboard.writeText(script);
    setCopiedPine(true);
    setTimeout(() => setCopiedPine(false), 2000);
  };

  // SVG Equity Curve geometry computation
  const svgMetrics = useMemo(() => {
    if (!stratResult || stratResult.equityCurve.length < 2) return null;
    const curve = stratResult.equityCurve;
    const minVal = Math.min(...curve.map((p) => Math.min(p.equity, p.benchmark))) * 0.96;
    const maxVal = Math.max(...curve.map((p) => Math.max(p.equity, p.benchmark))) * 1.04;
    const range = maxVal - minVal || 1;

    const width = 640;
    const height = 140;
    const padding = 10;

    const points = curve.map((p, idx) => {
      const x = padding + (idx / (curve.length - 1)) * (width - padding * 2);
      const yEquity = height - padding - ((p.equity - minVal) / range) * (height - padding * 2);
      const yBench = height - padding - ((p.benchmark - minVal) / range) * (height - padding * 2);
      return { x, yEquity, yBench, data: p };
    });

    const equityPath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.yEquity.toFixed(1)}`).join(" ");
    const benchPath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.yBench.toFixed(1)}`).join(" ");

    return { width, height, points, equityPath, benchPath, minVal, maxVal };
  }, [stratResult]);

  const SIP_PRESETS = [5000, 10000, 25000, 50000];

  return (
    <div className="flex flex-col gap-4">
      {/* Top Mode Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Backtest modes">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "strategy"}
            onClick={() => setActiveTab("strategy")}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors",
              activeTab === "strategy"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
            )}
          >
            <ChartLineUpIcon size={15} aria-hidden />
            <span>Interactive Strategy Simulator</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "sip"}
            onClick={() => setActiveTab("sip")}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors",
              activeTab === "sip"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
            )}
          >
            <RepeatIcon size={15} aria-hidden />
            <span>SIP vs Lump Sum</span>
          </button>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="num">{candles.length} NSE daily candles</span>
          {candles.length > 0 && (
            <span>
              · {date(candles[0].ts)} to {date(candles[candles.length - 1].ts)}
            </span>
          )}
        </div>
      </div>

      {/* TAB 1: STRATEGY SIMULATOR */}
      {activeTab === "strategy" && (
        <div className="flex flex-col gap-5">
          {/* Strategy Model & Parameter Bar */}
          <div className="rounded-lg border border-border bg-card/60 p-3.5 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="eyebrow flex items-center gap-1.5 text-foreground">
                  <SlidersHorizontalIcon size={14} className="text-muted-foreground" aria-hidden />
                  Strategy Model:
                </span>
                {(
                  [
                    { id: "sma_cross", label: "Dual MA Crossover" },
                    { id: "rsi_reversal", label: "RSI Mean Reversion" },
                    { id: "breakout", label: "Donchian Breakout" },
                    { id: "kk_breakout", label: "KK 20d Breakout" },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => {
                      setStrategyType(st.id);
                      if (st.id === "sma_cross") {
                        setFastMa(20);
                        setSlowMa(50);
                      }
                    }}
                    className={clsx(
                      "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                      strategyType === st.id
                        ? "bg-foreground text-background"
                        : "border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40",
                    )}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              {/* Action Buttons: Pine Script & CSV */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyPineScript}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-foreground/[0.04]"
                >
                  {copiedPine ? (
                    <>
                      <CheckIcon size={14} className="text-gain" aria-hidden />
                      <span className="text-gain">Copied Pine Script!</span>
                    </>
                  ) : (
                    <>
                      <CodeIcon size={14} className="text-muted-foreground" aria-hidden />
                      <span>TradingView Pine v5</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  disabled={!stratResult || stratResult.trades.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-foreground/[0.04] disabled:opacity-40"
                >
                  <DownloadSimpleIcon size={14} className="text-muted-foreground" aria-hidden />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            {/* Parameter Adjustment Row */}
            <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-4 border-t border-border/70 text-[12px]">
              {strategyType === "sma_cross" && (
                <>
                  <div className="min-w-0">
                    <label className="eyebrow block mb-1 truncate">Fast MA Period</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[9, 13, 20].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setFastMa(v)}
                          className={clsx(
                            "num rounded px-2 py-0.5 text-[11px]",
                            fastMa === v ? "bg-foreground text-background font-medium" : "border border-border text-muted-foreground",
                          )}
                        >
                          {v}
                        </button>
                      ))}
                      <input
                        type="number"
                        min="2"
                        max="100"
                        aria-label="Fast MA period"
                        value={fastMa}
                        onChange={(e) => setFastMa(Math.max(2, Number(e.target.value) || 2))}
                        className="num h-6 w-12 rounded border border-border bg-card px-1.5 text-[11px] text-foreground text-center"
                      />
                    </div>
                  </div>

                  <div className="min-w-0">
                    <label className="eyebrow block mb-1 truncate">Slow MA Period</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[30, 50, 200].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setSlowMa(v)}
                          className={clsx(
                            "num rounded px-2 py-0.5 text-[11px]",
                            slowMa === v ? "bg-foreground text-background font-medium" : "border border-border text-muted-foreground",
                          )}
                        >
                          {v}
                        </button>
                      ))}
                      <input
                        type="number"
                        min="5"
                        max="250"
                        aria-label="Slow MA period"
                        value={slowMa}
                        onChange={(e) => setSlowMa(Math.max(fastMa + 1, Number(e.target.value) || 5))}
                        className="num h-6 w-12 rounded border border-border bg-card px-1.5 text-[11px] text-foreground text-center"
                      />
                    </div>
                  </div>
                </>
              )}

              {strategyType === "rsi_reversal" && (
                <>
                  <div className="min-w-0">
                    <label className="eyebrow block mb-1 truncate">RSI Length</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[7, 9, 14, 21].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setRsiPeriod(v)}
                          className={clsx(
                            "num rounded px-2 py-0.5 text-[11px]",
                            rsiPeriod === v ? "bg-foreground text-background font-medium" : "border border-border text-muted-foreground",
                          )}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <label className="eyebrow block mb-1 truncate">Buy / Exit Thresholds</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">Buy &le;</span>
                      <input
                        type="number"
                        min="15"
                        max="45"
                        aria-label="RSI buy threshold"
                        value={rsiOversold}
                        onChange={(e) => setRsiOversold(Number(e.target.value) || 30)}
                        className="num h-6 w-11 rounded border border-border bg-card px-1 text-[11px] text-foreground text-center"
                      />
                      <span className="text-[11px] text-muted-foreground">Exit &ge;</span>
                      <input
                        type="number"
                        min="55"
                        max="85"
                        aria-label="RSI exit threshold"
                        value={rsiOverbought}
                        onChange={(e) => setRsiOverbought(Number(e.target.value) || 70)}
                        className="num h-6 w-11 rounded border border-border bg-card px-1 text-[11px] text-foreground text-center"
                      />
                    </div>
                  </div>
                </>
              )}

              {strategyType === "breakout" && (
                <div className="min-w-0">
                  <label className="eyebrow block mb-1 truncate">Donchian Lookback</label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[10, 20, 55].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setBreakoutPeriod(v)}
                        className={clsx(
                          "num rounded px-2 py-0.5 text-[11px]",
                          breakoutPeriod === v ? "bg-foreground text-background font-medium" : "border border-border text-muted-foreground",
                        )}
                      >
                        {v}d
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {strategyType === "kk_breakout" && (
                <>
                  <div className="min-w-0">
                    <label className="eyebrow block mb-1 truncate">Lookback Period</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[10, 20, 30, 50].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setKkPeriod(v)}
                          className={clsx(
                            "num rounded px-2 py-0.5 text-[11px]",
                            kkPeriod === v
                              ? "bg-foreground text-background font-medium"
                              : "border border-border text-muted-foreground",
                          )}
                        >
                          {v}d
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <label className="eyebrow block mb-1 truncate">Extension %</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[0.5, 1.0, 1.5, 2.0].map((ext) => (
                        <button
                          key={ext}
                          type="button"
                          onClick={() => setKkExtensionPct(ext)}
                          className={clsx(
                            "num rounded px-2 py-0.5 text-[11px]",
                            kkExtensionPct === ext
                              ? "bg-foreground text-background font-medium"
                              : "border border-border text-muted-foreground",
                          )}
                        >
                          {ext}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <label className="eyebrow block mb-1 truncate">Confirm Window</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[3, 5, 7].map((b) => (
                        <button
                          key={b}
                          type="button"
                          onClick={() => setKkConfirmationBars(b)}
                          className={clsx(
                            "num rounded px-2 py-0.5 text-[11px]",
                            kkConfirmationBars === b
                              ? "bg-foreground text-background font-medium"
                              : "border border-border text-muted-foreground",
                          )}
                        >
                          {b}d
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <label className="eyebrow block mb-1 truncate">Max Hold Bars</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[3, 5, 7, 10].map((w) => (
                        <button
                          key={w}
                          type="button"
                          onClick={() => setKkTradeWindowBars(w)}
                          className={clsx(
                            "num rounded px-2 py-0.5 text-[11px]",
                            kkTradeWindowBars === w
                              ? "bg-foreground text-background font-medium"
                              : "border border-border text-muted-foreground",
                          )}
                        >
                          {w}d
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="min-w-0 col-span-2">
                    <label className="eyebrow block mb-1 truncate">Setup Direction</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setKkDirection("buy")}
                        className={clsx(
                          "rounded px-2 py-0.5 text-[11px]",
                          kkDirection === "buy"
                            ? "bg-foreground text-background font-medium"
                            : "border border-border text-muted-foreground",
                        )}
                      >
                        Long Only (Cash Delivery)
                      </button>
                      <button
                        type="button"
                        onClick={() => setKkDirection("both")}
                        className={clsx(
                          "rounded px-2 py-0.5 text-[11px]",
                          kkDirection === "both"
                            ? "bg-foreground text-background font-medium"
                            : "border border-border text-muted-foreground",
                        )}
                      >
                        Both (Long &amp; F&amp;O Short)
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* Stop Loss & Profit Target */}
              {strategyType !== "kk_breakout" && (
                <>
                  <div className="min-w-0">
                    <label className="eyebrow block mb-1 truncate">Stop Loss %</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[0, 3, 5, 7].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setStopLossPct(s)}
                          className={clsx(
                            "num rounded px-2 py-0.5 text-[11px]",
                            stopLossPct === s ? "bg-foreground text-background font-medium" : "border border-border text-muted-foreground",
                          )}
                        >
                          {s === 0 ? "Off" : `${s}%`}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <label className="eyebrow block mb-1 truncate">Profit Target %</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[0, 8, 15, 25].map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTakeProfitPct(t)}
                          className={clsx(
                            "num rounded px-2 py-0.5 text-[11px]",
                            takeProfitPct === t ? "bg-foreground text-background font-medium" : "border border-border text-muted-foreground",
                          )}
                        >
                          {t === 0 ? "Off" : `+${t}%`}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="min-w-0">
                <label className="eyebrow block mb-1 truncate">Starting Capital</label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[25000, 50000, 100000, 500000].map((cap) => (
                    <button
                      key={cap}
                      type="button"
                      onClick={() => setInitialCapital(cap)}
                      className={clsx(
                        "num rounded px-2 py-0.5 text-[11px]",
                        initialCapital === cap ? "bg-foreground text-background font-medium" : "border border-border text-muted-foreground",
                      )}
                    >
                      ₹{cap >= 100000 ? `${cap / 100000}L` : `${cap / 1000}k`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* KK Strategy Guidance Card */}
          {strategyType === "kk_breakout" && (
            <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 space-y-2 text-[12px]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">KK 20-Day Asymmetric Breakout Architecture</span>
                  <span className="rounded bg-coral/10 px-1.5 py-0.5 text-[10px] font-medium text-coral-ink">
                    Empirical 2006–2026 Model
                  </span>
                </div>
                <span className="text-[11px] num text-muted-foreground">
                  Geometry: Target 1 (+0.75R, 50% Trim) · Target 2 (+2.0R) · 5d Time Stop
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-[11.5px] text-muted-foreground">
                <div className="rounded border border-border/60 bg-card p-2.5 space-y-1">
                  <strong className="text-foreground block">1. Signal Bar</strong>
                  <p>
                    Stock makes a {kkPeriod}d extreme with &ge; {kkExtensionPct}% extension, identifying potential exhaustion.
                  </p>
                </div>
                <div className="rounded border border-border/60 bg-card p-2.5 space-y-1">
                  <strong className="text-foreground block">2. Confirmation</strong>
                  <p>
                    Enters on breakout above the signal high (BUY) within {kkConfirmationBars} sessions.
                  </p>
                </div>
                <div className="rounded border border-border/60 bg-card p-2.5 space-y-1">
                  <strong className="text-foreground block">3. Target 1 (+0.75R)</strong>
                  <p>
                    Locks in 50% profit to render the remaining position virtually risk-free.
                  </p>
                </div>
                <div className="rounded border border-border/60 bg-card p-2.5 space-y-1">
                  <strong className="text-foreground block">4. Target 2 &amp; Time Exit</strong>
                  <p>
                    Rides remainder to +2.0R (+1.38R net) or closes at market on session {kkTradeWindowBars}.
                  </p>
                </div>
              </div>
            </div>
          )}

          {stratResult ? (
            <>
              {/* Quantitative Desk Performance Summary Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3.5 border-y border-border py-3 text-[13px]">
                <div className="min-w-0">
                  <p className="eyebrow truncate">Strategy Return</p>
                  <div className="mt-1 text-[17px] font-medium">
                    <Delta value={stratResult.totalReturnPct} />
                  </div>
                  <p className="num text-[11px] text-muted-foreground truncate">
                    {rupees(stratResult.finalCapital, { decimals: false })}
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="eyebrow truncate">Buy &amp; Hold</p>
                  <div className="mt-1 text-[17px] font-medium">
                    <Delta value={stratResult.benchmarkReturnPct} />
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">Stock benchmark</p>
                </div>

                <div className="min-w-0">
                  <p className="eyebrow truncate">Alpha Generated</p>
                  <div className="mt-1 text-[17px] font-medium">
                    <Delta value={stratResult.alphaPct} />
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">Excess over hold</p>
                </div>

                <div className="min-w-0">
                  <p className="eyebrow truncate">Win Rate</p>
                  <p className="num mt-1 text-[17px] font-medium text-foreground">
                    {stratResult.winRatePct}%
                  </p>
                  <p className="num text-[11px] text-muted-foreground truncate">
                    {stratResult.winningTrades}W / {stratResult.losingTrades}L
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="eyebrow truncate">Profit Factor</p>
                  <p className="num mt-1 text-[17px] font-medium text-foreground">
                    {stratResult.profitFactor}x
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">Gross gain / loss</p>
                </div>

                <div className="min-w-0">
                  <p className="eyebrow truncate">Max Drawdown</p>
                  <p className="num mt-1 text-[17px] font-medium text-loss">
                    &minus;{stratResult.maxDrawdownPct}%
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">Peak to trough</p>
                </div>

                <div className="min-w-0">
                  <p className="eyebrow truncate">Payoff Ratio</p>
                  <p className="num mt-1 text-[17px] font-medium text-foreground">
                    {stratResult.payoffRatio}x
                  </p>
                  <p className="num text-[11px] text-muted-foreground truncate">
                    +{stratResult.avgWinPct}% / &minus;{stratResult.avgLossPct}%
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="eyebrow truncate">Avg Duration</p>
                  <p className="num mt-1 text-[17px] font-medium text-foreground">
                    {stratResult.avgBarsHeld}d
                  </p>
                  <p className="num text-[11px] text-muted-foreground truncate">
                    {stratResult.totalTrades} closed trades
                  </p>
                </div>
              </div>

              {/* Interactive Visual Equity Curve (SVG) */}
              {svgMetrics && (
                <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-3 text-[12px]">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full bg-foreground" aria-hidden />
                        <span className="font-medium text-foreground">Strategy Equity</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="h-0.5 w-3 bg-muted-foreground/60 border-t border-dashed" aria-hidden />
                        <span className="text-muted-foreground">Buy &amp; Hold Benchmark</span>
                      </div>
                    </div>

                    {hoveredPointIndex != null && svgMetrics.points[hoveredPointIndex] ? (
                      <div className="flex items-center gap-3 text-[11.5px] num bg-muted/20 px-2.5 py-0.5 rounded border border-border">
                        <span className="text-muted-foreground">{svgMetrics.points[hoveredPointIndex].data.date}</span>
                        <span>Strategy: <strong>{rupees(svgMetrics.points[hoveredPointIndex].data.equity, { decimals: false })}</strong></span>
                        <span className="text-muted-foreground">Hold: {rupees(svgMetrics.points[hoveredPointIndex].data.benchmark, { decimals: false })}</span>
                        <span className="text-loss">DD: &minus;{svgMetrics.points[hoveredPointIndex].data.drawdownPct}%</span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Hover curve to inspect historical points</span>
                    )}
                  </div>

                  <div className="relative w-full overflow-hidden">
                    <svg
                      viewBox={`0 0 ${svgMetrics.width} ${svgMetrics.height}`}
                      className="w-full h-36 overflow-visible"
                    >
                      {/* Grid Lines */}
                      <line x1="10" y1="20" x2={svgMetrics.width - 10} y2="20" stroke="currentColor" strokeOpacity="0.07" strokeDasharray="3 3" />
                      <line x1="10" y1="70" x2={svgMetrics.width - 10} y2="70" stroke="currentColor" strokeOpacity="0.07" strokeDasharray="3 3" />
                      <line x1="10" y1="120" x2={svgMetrics.width - 10} y2="120" stroke="currentColor" strokeOpacity="0.07" strokeDasharray="3 3" />

                      {/* Benchmark Line */}
                      <path d={svgMetrics.benchPath} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="4 3" />

                      {/* Strategy Equity Line */}
                      <path d={svgMetrics.equityPath} fill="none" stroke="currentColor" strokeWidth="2.2" className="text-foreground" />

                      {/* Interactive Hover Point */}
                      {hoveredPointIndex != null && svgMetrics.points[hoveredPointIndex] && (
                        <circle
                          cx={svgMetrics.points[hoveredPointIndex].x}
                          cy={svgMetrics.points[hoveredPointIndex].yEquity}
                          r="4"
                          fill="currentColor"
                          className="text-foreground animate-ping-soft"
                        />
                      )}

                      {/* Interactive Hover Area Slices */}
                      {svgMetrics.points.map((p, idx) => (
                        <rect
                          key={p.data.date}
                          x={p.x - 3}
                          y="0"
                          width="6"
                          height={svgMetrics.height}
                          fill="transparent"
                          onMouseEnter={() => setHoveredPointIndex(idx)}
                          onMouseLeave={() => setHoveredPointIndex(null)}
                          className="cursor-crosshair"
                        />
                      ))}
                    </svg>
                  </div>
                </div>
              )}

              {/* Complete Trade Log & Audit */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="eyebrow">Trade Log:</span>
                    <div className="flex items-center gap-1" role="group" aria-label="Filter trades">
                      {(["all", "wins", "losses"] as const).map((filter) => (
                        <button
                          key={filter}
                          type="button"
                          onClick={() => setTradeFilter(filter)}
                          className={clsx(
                            "rounded px-2.5 py-0.5 text-[11.5px] font-medium transition-colors",
                            tradeFilter === filter
                              ? "bg-foreground text-background"
                              : "border border-border text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {filter === "all"
                            ? `All (${stratResult.totalTrades})`
                            : filter === "wins"
                              ? `Wins (${stratResult.winningTrades})`
                              : `Losses (${stratResult.losingTrades})`}
                        </button>
                      ))}
                    </div>
                  </div>

                  <span className="num text-[11.5px] text-muted-foreground">
                    Expectancy per trade: <strong>{stratResult.expectancyPct > 0 ? `+${stratResult.expectancyPct}%` : `${stratResult.expectancyPct}%`}</strong>
                  </span>
                </div>

                {displayedTrades.length > 0 ? (
                  <TableWrap>
                    <table className="w-full min-w-[540px]">
                      <thead>
                        <tr>
                          <th className={th}>Entry Date</th>
                          {strategyType === "kk_breakout" && <th className={th}>Signal</th>}
                          <th className={thNum}>Entry Price</th>
                          <th className={th}>Exit Date</th>
                          <th className={thNum}>Exit Price</th>
                          <th className={thNum}>Hold</th>
                          <th className={th}>Milestone / Trigger</th>
                          {strategyType === "kk_breakout" && <th className={thNum}>Realized R</th>}
                          <th className={thNum}>Trade P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedTrades.slice(-10).reverse().map((t, idx) => (
                          <tr key={`${t.entryDate}-${idx}`} className={tr}>
                            <td className={td + " num text-muted-foreground"}>{t.entryDate}</td>
                            {strategyType === "kk_breakout" && (
                              <td className={td}>
                                <span
                                  className={clsx(
                                    "rounded px-1.5 py-0.5 text-[10px] font-medium",
                                    t.signalType === "SELL"
                                      ? "bg-loss-soft text-loss"
                                      : "bg-gain-soft text-gain",
                                  )}
                                >
                                  {t.signalType ?? "BUY"}
                                </span>
                              </td>
                            )}
                            <td className={tdNum}>{price(t.entryPrice)}</td>
                            <td className={td + " num text-muted-foreground"}>{t.exitDate}</td>
                            <td className={tdNum}>{price(t.exitPrice)}</td>
                            <td className={tdNum}>{t.barsHeld}d</td>
                            <td className={td}>
                              {t.resultType === "TARGET_2_HIT" ? (
                                <span className="rounded px-1.5 py-0.5 text-[10.5px] font-medium bg-gain-soft text-gain">
                                  Target 2 Hit (+1.38R)
                                </span>
                              ) : t.resultType === "TARGET_1_HIT_TIME_EXIT" ? (
                                <span className="rounded px-1.5 py-0.5 text-[10.5px] font-medium bg-gain-soft/70 text-gain">
                                  T1 Hit + Time Exit
                                </span>
                              ) : t.resultType === "TIME_EXIT" ? (
                                <span className="rounded px-1.5 py-0.5 text-[10.5px] font-medium bg-muted/40 text-muted-foreground">
                                  Time Exit (5d)
                                </span>
                              ) : t.resultType === "SL_HIT_AFTER_TARGET_1" ? (
                                <span className="rounded px-1.5 py-0.5 text-[10.5px] font-medium bg-loss-soft/70 text-loss">
                                  SL After T1 (-0.13R)
                                </span>
                              ) : t.resultType === "SL_HIT" ? (
                                <span className="rounded px-1.5 py-0.5 text-[10.5px] font-medium bg-loss-soft text-loss">
                                  Stop Loss (-1.0R)
                                </span>
                              ) : (
                                <span
                                  className={clsx(
                                    "rounded px-1.5 py-0.5 text-[10.5px] font-medium capitalize",
                                    t.exitReason === "stop_loss"
                                      ? "bg-loss-soft text-loss"
                                      : t.exitReason === "take_profit"
                                        ? "bg-gain-soft text-gain"
                                        : "bg-muted/40 text-muted-foreground",
                                  )}
                                >
                                  {t.exitReason.replace(/_/g, " ")}
                                </span>
                              )}
                            </td>
                            {strategyType === "kk_breakout" && (
                              <td className={tdNum}>
                                <span
                                  className={clsx(
                                    "num font-medium",
                                    (t.realizedR ?? 0) > 0
                                      ? "text-gain"
                                      : (t.realizedR ?? 0) < 0
                                        ? "text-loss"
                                        : "text-muted-foreground",
                                  )}
                                >
                                  {(t.realizedR ?? 0) > 0
                                    ? `+${(t.realizedR ?? 0).toFixed(2)}R`
                                    : `${(t.realizedR ?? 0).toFixed(2)}R`}
                                </span>
                              </td>
                            )}
                            <td className={tdNum}>
                              <Delta value={t.pnlPct} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                ) : (
                  <p className="text-[12.5px] text-muted-foreground py-2">
                    No trades match the selected filter.
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="text-[12.5px] text-muted-foreground py-4">
              Insufficient candle history ({candles.length} bars) to run this strategy configuration.
            </p>
          )}
        </div>
      )}

      {/* TAB 2: SIP VS LUMP SUM */}
      {activeTab === "sip" && sipResult && (
        <div className="flex flex-col gap-4 animate-fadeIn">
          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow">Monthly SIP:</span>
              <div className="flex items-center gap-1.5">
                {SIP_PRESETS.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setMonthlyAmount(amt)}
                    className={clsx(
                      "num rounded border px-2 py-0.5 text-[11.5px] font-medium transition-colors",
                      monthlyAmount === amt
                        ? "border-foreground bg-foreground/5 text-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/30",
                    )}
                  >
                    ₹{amt.toLocaleString("en-IN")}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor={customSipInputId} className="eyebrow">Custom ₹:</label>
              <input
                id={customSipInputId}
                type="number"
                step="1000"
                min="500"
                value={monthlyAmount}
                onChange={(e) => setMonthlyAmount(Math.max(500, Number(e.target.value) || 500))}
                className="num h-7 w-24 rounded border border-border bg-card px-2 text-[12px] text-foreground focus:border-foreground focus:outline-none"
              />
            </div>
          </div>

          {/* Performance strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 border-y border-border py-3 text-[13px]">
            <div>
              <p className="eyebrow">Total Invested</p>
              <p className="num mt-1 text-[16px] font-medium text-foreground">
                {rupees(sipResult.totalInvested, { decimals: false })}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {sipResult.durationMonths} monthly installments
              </p>
            </div>

            <div>
              <p className="eyebrow">SIP Value Today</p>
              <p className="num mt-1 text-[16px] font-medium text-foreground">
                {rupees(sipResult.finalValue, { decimals: false })}
              </p>
              <p className="num text-[11px] text-muted-foreground">
                {sipResult.totalUnits.toFixed(2)} shares accumulated
              </p>
            </div>

            <div>
              <p className="eyebrow">SIP Return</p>
              <div className="mt-1 text-[16px] font-medium">
                <Delta value={sipResult.roiPct} />
              </div>
              <p className="text-[11px] text-muted-foreground">Dollar-cost averaged</p>
            </div>

            <div>
              <p className="eyebrow">Lump Sum Benchmark</p>
              <div className="mt-1 text-[16px] font-medium">
                <Delta value={sipResult.lumpSumRoiPct} />
              </div>
              <p className="num text-[11px] text-muted-foreground">
                {rupees(sipResult.lumpSumFinalValue, { decimals: false })} if upfront
              </p>
            </div>
          </div>

          {/* Monthly ledger */}
          <TableWrap>
            <table className="w-full min-w-[420px]">
              <thead>
                <tr>
                  <th className={th}>Month</th>
                  <th className={thNum}>Price</th>
                  <th className={thNum}>Units Acquired</th>
                  <th className={thNum}>Invested</th>
                  <th className={thNum}>Portfolio Value</th>
                </tr>
              </thead>
              <tbody>
                {sipResult.entries.slice(-8).reverse().map((e) => (
                  <tr key={e.date} className={tr}>
                    <td className={td + " num text-muted-foreground"}>{e.date}</td>
                    <td className={tdNum}>{price(e.price)}</td>
                    <td className={tdNum}>{Number(e.units).toFixed(3)}</td>
                    <td className={tdNum}>{rupees(e.cumulativeInvested, { decimals: false })}</td>
                    <td className={tdNum}>{rupees(e.currentValue, { decimals: false })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Simulated on daily historical NSE candles. Past performance does not guarantee future results. Research only.
      </p>
    </div>
  );
}
