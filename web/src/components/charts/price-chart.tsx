"use client";

import clsx from "clsx";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { generateKkChartMarkers } from "@/lib/backtest-engine";
import { price as fmtPrice, volume as fmtVolume } from "@/lib/format";
import { toTradingViewSymbol } from "@/lib/market";
import { deduplicateChartSignals, type RawChartMarker } from "@/lib/trade-plan";
import type { Candle } from "@/lib/types";

export type ChartMarker = RawChartMarker;
export type ChartStrategyFilter = "kk_breakout" | "sma_cross" | "rsi_reversal" | "all" | "none";

const RANGES = [
  { key: "1M", days: 30 },
  { key: "3M", days: 92 },
  { key: "6M", days: 183 },
  { key: "1Y", days: 365 },
  { key: "2Y", days: 731 },
  { key: "ALL", days: 9999 },
] as const;

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const toTime = (ts: string) => Math.floor(new Date(ts).getTime() / 1000) as UTCTimestamp;

function computeSma(candles: Candle[], period: number) {
  const result: { time: UTCTimestamp; value: number }[] = [];
  if (candles.length < period) return result;
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) {
      sum -= candles[i - period].close;
    }
    if (i >= period - 1) {
      result.push({
        time: toTime(candles[i].ts),
        value: Number((sum / period).toFixed(2)),
      });
    }
  }
  return result;
}

/**
 * Compact Institutional TradingView Chart:
 * Displays verified Indian equity candles, strategy-isolated Buy/Exit signals
 * (including dynamic KK 20d Breakout entries & asymmetric T1/T2 milestones),
 * SMA 20/50/200 overlays, and an interactive signals timeline ribbon.
 */
export function PriceChart({
  candles,
  markers,
  symbol,
  exchange = "NSE",
}: {
  candles: Candle[];
  markers: ChartMarker[];
  symbol: string;
  exchange?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("1Y");
  const [theme, setTheme] = useState(0);
  const [hover, setHover] = useState<Candle | null>(null);

  // Technical Indicators & Display State
  const [chartType, setChartType] = useState<"candles" | "area">("candles");
  const [showSma20, setShowSma20] = useState(true);
  const [showSma50, setShowSma50] = useState(true);
  const [showSma200, setShowSma200] = useState(false);
  const [showVolume, setShowVolume] = useState(true);

  // Dynamic KK Strategy Signal Generation (Computed client-side from real historical candles)
  const kkMarkers = useMemo(() => generateKkChartMarkers(candles), [candles]);

  // Strategy Counts for UI Badges
  const kkCount = useMemo(() => kkMarkers.filter((m) => m.kind === "buy").length, [kkMarkers]);
  const smaCount = useMemo(
    () =>
      markers.filter(
        (m) =>
          m.strategy?.includes("sma") ||
          m.label.toLowerCase().includes("sma") ||
          m.label.toLowerCase().includes("ma"),
      ).length,
    [markers],
  );
  const rsiCount = useMemo(
    () =>
      markers.filter(
        (m) => m.strategy?.includes("rsi") || m.label.toLowerCase().includes("rsi"),
      ).length,
    [markers],
  );
  const totalCount = kkMarkers.length + markers.length;

  // Strategy Mode Filter (Isolates strategies to eliminate multi-plan signal confusion)
  const [strategyFilter, setStrategyFilter] = useState<ChartStrategyFilter>(() =>
    kkMarkers.length > 0 ? "kk_breakout" : markers.length > 0 ? "all" : "kk_breakout",
  );

  // Signals Controls
  const [signalFilter, setSignalFilter] = useState<"all" | "buy" | "exit">("all");
  const [signalDensity, setSignalDensity] = useState<"clean" | "all">("clean");
  const [showLabels, setShowLabels] = useState(true);
  const [selectedSignal, setSelectedSignal] = useState<ChartMarker | null>(null);
  const [showDataTable, setShowDataTable] = useState(false);

  const visible = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)!.days;
    if (!candles.length) return candles;
    const cutoff = new Date(candles[candles.length - 1].ts).getTime() - days * 86400000;
    return candles.filter((c) => new Date(c.ts).getTime() >= cutoff);
  }, [candles, range]);

  // Compute SMAs over the full historical candle series
  const fullSma20 = useMemo(() => computeSma(candles, 20), [candles]);
  const fullSma50 = useMemo(() => computeSma(candles, 50), [candles]);
  const fullSma200 = useMemo(() => computeSma(candles, 200), [candles]);

  // Strategy-isolated markers
  const rawStrategyMarkers = useMemo(() => {
    if (strategyFilter === "none") return [];
    if (strategyFilter === "kk_breakout") {
      const dbKk = markers.filter((m) => m.strategy === "kk_breakout");
      return dbKk.length > 0 ? dbKk : kkMarkers;
    }
    if (strategyFilter === "sma_cross") {
      return markers.filter(
        (m) =>
          m.strategy?.includes("sma") ||
          m.label.toLowerCase().includes("sma") ||
          m.label.toLowerCase().includes("ma"),
      );
    }
    if (strategyFilter === "rsi_reversal") {
      return markers.filter(
        (m) => m.strategy?.includes("rsi") || m.label.toLowerCase().includes("rsi"),
      );
    }
    // "all": show everything with distinct badges (avoiding duplicate KK markers)
    const hasDbKk = markers.some((m) => m.strategy === "kk_breakout");
    return hasDbKk ? markers : [...markers, ...kkMarkers];
  }, [strategyFilter, markers, kkMarkers]);

  // Filtered and deduplicated markers
  const activeMarkers = useMemo(() => {
    let list = rawStrategyMarkers;
    if (signalFilter === "buy") list = rawStrategyMarkers.filter((m) => m.kind === "buy");
    if (signalFilter === "exit") list = rawStrategyMarkers.filter((m) => m.kind === "exit");
    return deduplicateChartSignals(list, signalDensity);
  }, [rawStrategyMarkers, signalFilter, signalDensity]);

  // Re-render when theme flips
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme((t) => t + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!el.current || visible.length === 0) return;
    const ink = cssVar("--foreground");
    const muted = cssVar("--muted-foreground");
    const border = cssVar("--border");
    const gain = cssVar("--gain");
    const loss = cssVar("--loss");
    const sma20Color = cssVar("--sma-20") || "#D97706";
    const sma50Color = cssVar("--sma-50") || "#0284C7";
    const sma200Color = cssVar("--sma-200") || "#7C3AED";
    const firstTime = toTime(visible[0].ts);
    const lastTime = toTime(visible[visible.length - 1].ts);

    const chart = createChart(el.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: muted,
        fontFamily: getComputedStyle(document.body).getPropertyValue("--font-mono") || "monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: border, style: 2 } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderVisible: false, rightOffset: 4, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: muted, width: 1, style: 3, labelBackgroundColor: ink },
        horzLine: { color: muted, width: 1, style: 3, labelBackgroundColor: ink },
      },
      handleScale: { axisPressedMouseMove: false },
    });
    chartRef.current = chart;

    let mainSeries;
    if (chartType === "area") {
      mainSeries = chart.addSeries(AreaSeries, {
        topColor: gain + "40",
        bottomColor: gain + "05",
        lineColor: gain,
        lineWidth: 2,
        priceLineColor: ink,
        priceLineStyle: 2,
      });
      mainSeries.setData(visible.map((c) => ({ time: toTime(c.ts), value: c.close })));
    } else {
      mainSeries = chart.addSeries(CandlestickSeries, {
        upColor: gain,
        downColor: loss,
        borderUpColor: gain,
        borderDownColor: loss,
        wickUpColor: gain,
        wickDownColor: loss,
        priceLineColor: ink,
        priceLineStyle: 2,
      });
      mainSeries.setData(visible.map((c) => ({ time: toTime(c.ts), open: c.open, high: c.high, low: c.low, close: c.close })));
    }

    // Technical Overlays (computed over full history, sliced to visible range)
    if (showSma20) {
      const sma20 = chart.addSeries(LineSeries, {
        color: sma20Color,
        lineWidth: 2,
        title: "SMA 20",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      sma20.setData(fullSma20.filter((p) => p.time >= firstTime && p.time <= lastTime));
    }

    if (showSma50) {
      const sma50 = chart.addSeries(LineSeries, {
        color: sma50Color,
        lineWidth: 2,
        title: "SMA 50",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      sma50.setData(fullSma50.filter((p) => p.time >= firstTime && p.time <= lastTime));
    }

    if (showSma200) {
      const sma200 = chart.addSeries(LineSeries, {
        color: sma200Color,
        lineWidth: 2,
        title: "SMA 200",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      sma200.setData(fullSma200.filter((p) => p.time >= firstTime && p.time <= lastTime));
    }

    // Volume histogram
    if (showVolume) {
      const vol = chart.addSeries(HistogramSeries, {
        priceScaleId: "vol",
        priceFormat: { type: "volume" },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(
        visible.map((c, i) => ({
          time: toTime(c.ts),
          value: c.volume,
          color: (i === 0 || c.close >= visible[i - 1].close ? gain : loss) + "40",
        })),
      );
    }

    // Clean Strategy-Filtered Buy/Exit Signal Markers directly on candles
    const first = new Date(visible[0].ts).getTime();
    createSeriesMarkers(
      mainSeries,
      activeMarkers
        .filter((m) => new Date(m.ts).getTime() >= first)
        .map((m) => {
          const t = toTime(m.ts);
          const bar = [...visible].reverse().find((c) => toTime(c.ts) <= t) ?? visible[0];
          const isBuy = m.kind === "buy";
          const isWinExit =
            m.kind === "exit" &&
            ((m.realizedR ?? 0) > 0 || (m.pnlPct ?? 0) > 0 || m.resultType === "TARGET_2_HIT");

          let textLabel: string | undefined = undefined;
          if (showLabels) {
            if (isBuy) {
              textLabel = m.strategy === "kk_breakout" ? "KK BUY" : "BUY";
            } else {
              if (m.resultType === "TARGET_2_HIT") textLabel = "T2 +2R";
              else if (
                m.resultType === "TARGET_1_HIT_TIME_EXIT" ||
                m.resultType === "T1_HIT_THEN_TIME_EXIT"
              )
                textLabel = "T1 +0.75R";
              else if (m.resultType === "SL_HIT") textLabel = "SL -1R";
              else textLabel = m.strategy === "kk_breakout" ? "KK EXIT" : "EXIT";
            }
          }

          return {
            time: toTime(bar.ts),
            position: isBuy ? ("belowBar" as const) : ("aboveBar" as const),
            shape: isBuy ? ("arrowUp" as const) : ("arrowDown" as const),
            color: isBuy ? gain : isWinExit ? gain : loss,
            text: textLabel,
            size: 1.3,
          };
        })
        .sort((a, b) => (a.time as number) - (b.time as number)),
    );

    chart.timeScale().fitContent();

    const byTime = new Map(visible.map((c) => [toTime(c.ts) as Time, c]));
    const onMove = (p: MouseEventParams) => setHover(p.time ? (byTime.get(p.time) ?? null) : null);
    chart.subscribeCrosshairMove(onMove);

    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
    };
  }, [
    visible,
    activeMarkers,
    theme,
    chartType,
    showSma20,
    showSma50,
    showSma200,
    showVolume,
    showLabels,
    fullSma20,
    fullSma50,
    fullSma200,
  ]);

  // Smoothly focus visible time range around a selected signal
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !visible.length) return;
    if (!selectedSignal) {
      chart.timeScale().fitContent();
      return;
    }
    const sigDay = selectedSignal.ts.slice(0, 10);
    let idx = visible.findIndex((c) => c.ts.slice(0, 10) === sigDay);
    if (idx === -1) {
      const sigTime = toTime(selectedSignal.ts);
      idx = visible.findIndex((c) => toTime(c.ts) >= sigTime);
    }
    if (idx !== -1) {
      const fromIdx = Math.max(0, idx - 22);
      const toIdx = Math.min(visible.length - 1, idx + 22);
      chart.timeScale().setVisibleRange({
        from: toTime(visible[fromIdx].ts),
        to: toTime(visible[toIdx].ts),
      });
    }
  }, [selectedSignal, visible]);

  const selectedCandle = useMemo(() => {
    if (!selectedSignal) return null;
    const day = selectedSignal.ts.slice(0, 10);
    return candles.find((c) => c.ts.slice(0, 10) === day) ?? null;
  }, [selectedSignal, candles]);

  const shown = hover ?? selectedCandle ?? visible[visible.length - 1];
  const fullIdx = shown ? candles.findIndex((c) => c.ts === shown.ts) : -1;
  const prev = fullIdx > 0 ? candles[fullIdx - 1] : undefined;
  const chg = shown && prev && prev.close ? ((shown.close - prev.close) / prev.close) * 100 : null;

  // Active signal for hovered or selected candle from activeMarkers
  const activeSignal = useMemo(() => {
    if (selectedSignal) return selectedSignal;
    if (!shown) return null;
    const candleDay = new Date(shown.ts).toISOString().slice(0, 10);
    return activeMarkers.find((m) => m.ts.slice(0, 10) === candleDay) ?? null;
  }, [shown, selectedSignal, activeMarkers]);

  const tvSymbol = toTradingViewSymbol(symbol, exchange);

  // Recent chronological signals for compact ribbon
  const recentSignals = useMemo(() => {
    const first = new Date(visible[0]?.ts ?? 0).getTime();
    return [...activeMarkers]
      .filter((m) => new Date(m.ts).getTime() >= first)
      .reverse()
      .slice(0, 10);
  }, [activeMarkers, visible]);

  return (
    <div className="flex flex-col gap-2">
      {/* Row 1: Primary Toolbar (Symbol, Chart Style, Indicators, Range & External Link) */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border/60 pb-2">
        {/* Left: Symbol & Quick Indicators */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="font-medium text-foreground flex items-center gap-1 mr-1">
            <span className="h-2 w-2 rounded-full bg-gain" />
            <span className="num font-semibold text-[12px]">{symbol}</span>
            <span className="text-[10px] text-muted-foreground uppercase">({exchange})</span>
          </span>

          {/* Chart Style */}
          <div className="flex rounded border border-border p-0.5 bg-muted/20">
            <button
              type="button"
              onClick={() => setChartType("candles")}
              className={clsx(
                "rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-colors",
                chartType === "candles" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Candles
            </button>
            <button
              type="button"
              onClick={() => setChartType("area")}
              className={clsx(
                "rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-colors",
                chartType === "area" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Area
            </button>
          </div>

          <div className="h-3 w-px bg-border mx-0.5" />

          {/* Indicator Pills */}
          <button
            type="button"
            onClick={() => setShowSma20((v) => !v)}
            className={clsx(
              "num inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10.5px] transition-colors",
              showSma20 ? "border-foreground/30 bg-muted/40 text-foreground font-semibold" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-sma-20" />
            SMA 20
          </button>

          <button
            type="button"
            onClick={() => setShowSma50((v) => !v)}
            className={clsx(
              "num inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10.5px] transition-colors",
              showSma50 ? "border-foreground/30 bg-muted/40 text-foreground font-semibold" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-sma-50" />
            SMA 50
          </button>

          <button
            type="button"
            onClick={() => setShowSma200((v) => !v)}
            className={clsx(
              "num inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10.5px] transition-colors",
              showSma200 ? "border-foreground/30 bg-muted/40 text-foreground font-semibold" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-sma-200" />
            SMA 200
          </button>

          <button
            type="button"
            onClick={() => setShowVolume((v) => !v)}
            className={clsx(
              "num inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] transition-colors",
              showVolume ? "border-primary/40 bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            Vol
          </button>
        </div>

        {/* Right: Range, Table & External Link */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {/* Range Selector */}
          <div role="tablist" aria-label="Chart range" className="flex rounded border border-border p-0.5 bg-muted/20">
            {RANGES.map((r) => (
              <button
                key={r.key}
                role="tab"
                type="button"
                aria-selected={range === r.key}
                onClick={() => setRange(r.key)}
                className={clsx(
                  "num h-5 rounded px-1.5 text-[10.5px] transition-colors",
                  range === r.key ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r.key}
              </button>
            ))}
          </div>

          <button
            type="button"
            aria-expanded={showDataTable}
            onClick={() => setShowDataTable((v) => !v)}
            className={clsx(
              "num inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10.5px] transition-colors",
              showDataTable
                ? "border-primary bg-primary text-primary-foreground font-medium"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
            title="Toggle accessible daily OHLCV data table"
          >
            <span>Table</span>
          </button>

          <a
            href={`https://in.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="num inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[10.5px] text-muted-foreground hover:text-foreground transition-colors"
            title={`Open ${tvSymbol} on official TradingView website`}
          >
            <span>TV Web</span>
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>

      {/* Row 2: Strategy Plan Isolator Bar (Prevents multi-strategy signal confusion!) */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border/60 bg-muted/15 px-2.5 py-1.5 text-[11px]">
        {/* Left: Strategy Selector */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground font-medium text-[10.5px] mr-0.5">Plan / Strategy:</span>
          <div role="radiogroup" aria-label="Strategy Signal Filter" className="flex flex-wrap rounded border border-border p-0.5 bg-background">
            <button
              type="button"
              role="radio"
              aria-checked={strategyFilter === "kk_breakout"}
              onClick={() => setStrategyFilter("kk_breakout")}
              className={clsx(
                "rounded px-2 py-0.5 text-[10.5px] font-semibold transition-colors flex items-center gap-1",
                strategyFilter === "kk_breakout"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="Isolate signals to the 20-bar Extreme Breakout plan with +0.75R / +2.0R asymmetric targets"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-gain" />
              <span>KK 20d Breakout</span>
              <span className="num text-[9.5px]">({kkCount})</span>
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={strategyFilter === "sma_cross"}
              onClick={() => setStrategyFilter("sma_cross")}
              className={clsx(
                "rounded px-2 py-0.5 text-[10.5px] font-medium transition-colors flex items-center gap-1",
                strategyFilter === "sma_cross"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="Show only SMA 20/50 Golden and Death Cross trend signals"
            >
              <span>SMA 20/50</span>
              <span className="num text-[9.5px]">({smaCount})</span>
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={strategyFilter === "rsi_reversal"}
              onClick={() => setStrategyFilter("rsi_reversal")}
              className={clsx(
                "rounded px-2 py-0.5 text-[10.5px] font-medium transition-colors flex items-center gap-1",
                strategyFilter === "rsi_reversal"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="Show only RSI Oversold bounce and Overbought mean-reversion signals"
            >
              <span>RSI Reversal</span>
              <span className="num text-[9.5px]">({rsiCount})</span>
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={strategyFilter === "all"}
              onClick={() => setStrategyFilter("all")}
              className={clsx(
                "rounded px-2 py-0.5 text-[10.5px] font-medium transition-colors",
                strategyFilter === "all"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="Display signals across all active quantitative strategies with strategy badges"
            >
              All Plans ({totalCount})
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={strategyFilter === "none"}
              onClick={() => setStrategyFilter("none")}
              className={clsx(
                "rounded px-2 py-0.5 text-[10.5px] font-medium transition-colors",
                strategyFilter === "none"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="Hide all signal markers to view pure price action"
            >
              Clean (Off)
            </button>
          </div>
        </div>

        {/* Right: Direction Filter & Display density */}
        {strategyFilter !== "none" && (
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Direction Filter */}
            <div className="flex rounded border border-border p-0.5 bg-background">
              <button
                type="button"
                onClick={() => setSignalFilter("all")}
                className={clsx(
                  "rounded px-1.5 py-0.5 font-medium transition-colors text-[10.5px]",
                  signalFilter === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                All ({rawStrategyMarkers.length})
              </button>
              <button
                type="button"
                onClick={() => setSignalFilter("buy")}
                className={clsx(
                  "rounded px-1.5 py-0.5 font-medium transition-colors text-[10.5px]",
                  signalFilter === "buy" ? "bg-gain text-primary-foreground" : "text-gain hover:text-foreground",
                )}
              >
                ▲ Buy
              </button>
              <button
                type="button"
                onClick={() => setSignalFilter("exit")}
                className={clsx(
                  "rounded px-1.5 py-0.5 font-medium transition-colors text-[10.5px]",
                  signalFilter === "exit" ? "bg-loss text-primary-foreground" : "text-loss hover:text-foreground",
                )}
              >
                ▼ Exit
              </button>
            </div>

            {/* Density Pill */}
            <button
              type="button"
              onClick={() => setSignalDensity((d) => (d === "clean" ? "all" : "clean"))}
              className={clsx(
                "rounded border px-1.5 py-0.5 text-[10.5px] font-medium transition-colors",
                signalDensity === "clean" ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}
              title="Clean Mode clusters same-day signals to prevent clutter"
            >
              {signalDensity === "clean" ? "Clean" : "Raw"}
            </button>

            {/* Labels Toggle */}
            <button
              type="button"
              onClick={() => setShowLabels((v) => !v)}
              className={clsx(
                "rounded border px-1.5 py-0.5 text-[10.5px] font-medium transition-colors",
                showLabels ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground hover:text-foreground",
              )}
              title="Toggle text labels on chart markers"
            >
              {showLabels ? "Labels ON" : "Labels OFF"}
            </button>
          </div>
        )}
      </div>

      {/* Floating Crosshair OHLC + Active Signal HUD (Unified Compact Row) */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] min-h-[26px]">
        <dl className="num flex flex-wrap gap-x-3.5 gap-y-0.5 text-[11.5px]">
          {shown ? (
            <>
              <div className="flex gap-1 text-muted-foreground">
                <dt className="sr-only">Date</dt>
                <dd className="font-medium text-foreground">{new Date(shown.ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}</dd>
              </div>
              {(["open", "high", "low", "close"] as const).map((k) => (
                <div key={k} className="flex gap-1">
                  <dt className="uppercase text-muted-foreground">{k[0]}</dt>
                  <dd>{fmtPrice(shown[k])}</dd>
                </div>
              ))}
              <div className="flex gap-1">
                <dt className="text-muted-foreground">Vol</dt>
                <dd>{fmtVolume(shown.volume)}</dd>
              </div>
              {chg != null ? (
                <div className={chg >= 0 ? "text-gain font-medium" : "text-loss font-medium"}>
                  <dt className="sr-only">Change</dt>
                  <dd>
                    {chg >= 0 ? "▲ +" : "▼ −"}
                    {Math.abs(chg).toFixed(2)}%
                  </dd>
                </div>
              ) : null}
            </>
          ) : null}
        </dl>

        {activeSignal ? (
          <div
            className={clsx(
              "num inline-flex flex-wrap items-center gap-1.5 rounded-md px-2.5 py-0.5 text-[11px] font-medium border shadow-xs transition-all",
              activeSignal.kind === "buy"
                ? "border-gain/40 bg-gain/10 text-gain"
                : (activeSignal.realizedR ?? 0) > 0 || (activeSignal.pnlPct ?? 0) > 0
                  ? "border-gain/40 bg-gain/10 text-gain"
                  : "border-loss/40 bg-loss/10 text-loss",
            )}
          >
            <span className="font-bold">
              {activeSignal.kind === "buy"
                ? "▲ BUY"
                : (activeSignal.realizedR ?? 0) > 0 || (activeSignal.pnlPct ?? 0) > 0
                  ? "★ TARGET HIT"
                  : "▼ EXIT"}
            </span>
            <span className="font-semibold text-foreground">· {activeSignal.label}</span>
            {activeSignal.price ? <span>@ ₹{fmtPrice(activeSignal.price)}</span> : null}
            {activeSignal.stop ? <span className="text-muted-foreground">(Stop: ₹{fmtPrice(activeSignal.stop)})</span> : null}
            {activeSignal.target1 ? <span className="text-gain font-semibold">(T1: ₹{fmtPrice(activeSignal.target1)})</span> : null}
            {activeSignal.target2 ? <span className="text-gain font-semibold">(T2: ₹{fmtPrice(activeSignal.target2)})</span> : null}
            {activeSignal.realizedR != null ? (
              <span className={clsx("font-bold px-1.5 py-0.2 rounded text-[10px]", activeSignal.realizedR >= 0 ? "bg-gain/20 text-gain" : "bg-loss/20 text-loss")}>
                {activeSignal.realizedR >= 0 ? "+" : ""}{activeSignal.realizedR.toFixed(2)}R
              </span>
            ) : null}
            {activeSignal.pnlPct != null ? (
              <span className={clsx("font-bold", activeSignal.pnlPct >= 0 ? "text-gain" : "text-loss")}>
                ({activeSignal.pnlPct >= 0 ? "+" : ""}{activeSignal.pnlPct.toFixed(2)}%)
              </span>
            ) : null}
            {activeSignal.barsHeld != null ? (
              <span className="text-muted-foreground text-[10.5px]">[{activeSignal.barsHeld}d held]</span>
            ) : null}
            {selectedSignal ? (
              <button
                type="button"
                onClick={() => setSelectedSignal(null)}
                className="ml-1 text-[9.5px] uppercase font-bold underline opacity-80 hover:opacity-100 cursor-pointer"
              >
                Clear
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Interactive Chart Canvas */}
      <div ref={el} className="h-[420px] w-full md:h-[480px] lg:h-[520px] rounded border border-border/40 bg-background/50" role="img" aria-label={`${symbol} daily price chart, ${range}`} />

      {/* Accessible Daily OHLCV Table View (MASTER.md §Charts & WCAG 2.1 AA) */}
      {showDataTable && visible.length > 0 && (
        <div className="rounded-md border border-border bg-card p-3 animate-fade-in">
          <div className="mb-2 flex items-center justify-between text-[11.5px]">
            <span className="eyebrow">Daily OHLCV Data ({symbol} · Latest 20 sessions in {range})</span>
            <button
              type="button"
              onClick={() => setShowDataTable(false)}
              className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Hide table
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto overflow-x-auto [scrollbar-width:thin]">
            <table className="w-full min-w-[520px] text-[12px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-1.5 text-left font-medium">Date</th>
                  <th className="py-1.5 text-right font-medium">Open</th>
                  <th className="py-1.5 text-right font-medium">High</th>
                  <th className="py-1.5 text-right font-medium">Low</th>
                  <th className="py-1.5 text-right font-medium">Close</th>
                  <th className="py-1.5 text-right font-medium">Volume</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 num">
                {visible.slice(-20).reverse().map((c) => (
                  <tr key={c.ts} className="hover:bg-foreground/[0.03]">
                    <td className="py-1.5 text-muted-foreground">
                      {new Date(c.ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="py-1.5 text-right">₹{fmtPrice(c.open)}</td>
                    <td className="py-1.5 text-right">₹{fmtPrice(c.high)}</td>
                    <td className="py-1.5 text-right">₹{fmtPrice(c.low)}</td>
                    <td className={clsx("py-1.5 text-right font-medium", c.close >= c.open ? "text-gain" : "text-loss")}>
                      ₹{fmtPrice(c.close)}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">{fmtVolume(c.volume)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Streamlined Compact Signals Ribbon with Strategy Isolation Badges */}
      {strategyFilter !== "none" && recentSignals.length > 0 && (
        <div data-testid="signals-timeline" className="flex flex-col gap-1 rounded-md border border-border/50 bg-muted/10 px-2.5 py-1.5">
          <div className="flex items-center justify-between text-[10.5px]">
            <span className="font-medium text-foreground flex items-center gap-1.5">
              <span>Signals Timeline</span>
              <span className="num text-muted-foreground font-normal">
                ({recentSignals.length} {strategyFilter === "all" ? "across all plans" : strategyFilter === "kk_breakout" ? "KK Breakout" : strategyFilter === "sma_cross" ? "SMA" : "RSI"} in {range})
              </span>
            </span>
            <span className="text-[10px] text-muted-foreground">Click chip to focus candle</span>
          </div>

          {/* Compact Pill Strip with Strategy Tags */}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {recentSignals.map((sig, idx) => {
              const isSelected = selectedSignal?.ts === sig.ts && selectedSignal?.label === sig.label;
              const isWinExit = sig.kind === "exit" && ((sig.realizedR ?? 0) > 0 || (sig.pnlPct ?? 0) > 0);
              return (
                <button
                  key={`${sig.ts}-${sig.kind}-${sig.label}-${idx}`}
                  type="button"
                  onClick={() => setSelectedSignal(isSelected ? null : sig)}
                  className={clsx(
                    "num inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] transition-all cursor-pointer bg-card",
                    sig.kind === "buy"
                      ? "border-gain/40 text-gain hover:border-gain hover:bg-gain/10"
                      : isWinExit
                        ? "border-gain/40 text-gain hover:border-gain hover:bg-gain/10"
                        : "border-loss/40 text-loss hover:border-loss hover:bg-loss/10",
                    isSelected && "ring-1 ring-primary shadow-xs font-semibold",
                  )}
                  title={`${sig.label} on ${new Date(sig.ts).toLocaleDateString("en-IN")}`}
                >
                  <span className="font-bold">
                    {sig.kind === "buy" ? "▲ BUY" : isWinExit ? "★ TARGET" : "▼ EXIT"}
                  </span>
                  <span className="rounded bg-muted/50 px-1 py-0.2 text-[9px] font-semibold text-foreground">
                    {sig.strategy === "kk_breakout"
                      ? "KK 20d"
                      : sig.strategy?.includes("sma")
                        ? "SMA"
                        : sig.strategy?.includes("rsi")
                          ? "RSI"
                          : "SIG"}
                  </span>
                  <span className="text-muted-foreground font-normal">
                    {new Date(sig.ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                  </span>
                  {sig.price ? <span className="font-medium text-foreground">₹{fmtPrice(sig.price)}</span> : null}
                  {sig.realizedR != null ? (
                    <span className={clsx("font-bold text-[9.5px]", sig.realizedR >= 0 ? "text-gain" : "text-loss")}>
                      {sig.realizedR >= 0 ? "+" : ""}{sig.realizedR.toFixed(2)}R
                    </span>
                  ) : null}
                  <span className="text-muted-foreground text-[10px]">({sig.label})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
