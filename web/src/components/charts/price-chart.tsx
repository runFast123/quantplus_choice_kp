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
import { price as fmtPrice, volume as fmtVolume } from "@/lib/format";
import { toTradingViewSymbol } from "@/lib/market";
import { deduplicateChartSignals, type RawChartMarker } from "@/lib/trade-plan";
import type { Candle } from "@/lib/types";

export type ChartMarker = RawChartMarker;

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
 * Institutional TradingView Lightweight Chart:
 * Displays genuine Indian equity candles (NSE/BSE), QuantsPulse Buy/Exit signals,
 * interactive technical overlays (SMA 20, SMA 50, SMA 200, Volume), clean signals deduplication,
 * and an interactive signal timeline log.
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

  // Signals Controls
  const [signalFilter, setSignalFilter] = useState<"all" | "buy" | "exit">("all");
  const [signalDensity, setSignalDensity] = useState<"clean" | "all">("clean");
  const [showLabels, setShowLabels] = useState(false);
  const [showSignalsLog, setShowSignalsLog] = useState(true);
  const [selectedSignal, setSelectedSignal] = useState<ChartMarker | null>(null);

  const visible = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)!.days;
    if (!candles.length) return candles;
    const cutoff = new Date(candles[candles.length - 1].ts).getTime() - days * 86400000;
    return candles.filter((c) => new Date(c.ts).getTime() >= cutoff);
  }, [candles, range]);

  // Filtered and deduplicated markers
  const activeMarkers = useMemo(() => {
    let list = markers;
    if (signalFilter === "buy") list = markers.filter((m) => m.kind === "buy");
    if (signalFilter === "exit") list = markers.filter((m) => m.kind === "exit");
    return deduplicateChartSignals(list, signalDensity);
  }, [markers, signalFilter, signalDensity]);

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
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.25 } },
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

    // Technical Overlays
    if (showSma20) {
      const sma20 = chart.addSeries(LineSeries, {
        color: "#F59E0B", // Amber
        lineWidth: 2,
        title: "SMA 20",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      sma20.setData(computeSma(visible, 20));
    }

    if (showSma50) {
      const sma50 = chart.addSeries(LineSeries, {
        color: "#0284C7", // Sky blue
        lineWidth: 2,
        title: "SMA 50",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      sma50.setData(computeSma(visible, 50));
    }

    if (showSma200) {
      const sma200 = chart.addSeries(LineSeries, {
        color: "#9333EA", // Purple
        lineWidth: 2,
        title: "SMA 200",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      sma200.setData(computeSma(visible, 200));
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

    // Clean Buy/Exit Signal Markers directly on candles (No text collision)
    const first = new Date(visible[0].ts).getTime();
    createSeriesMarkers(
      mainSeries,
      activeMarkers
        .filter((m) => new Date(m.ts).getTime() >= first)
        .map((m) => {
          const t = toTime(m.ts);
          const bar = [...visible].reverse().find((c) => toTime(c.ts) <= t) ?? visible[0];
          return {
            time: toTime(bar.ts),
            position: m.kind === "buy" ? ("belowBar" as const) : ("aboveBar" as const),
            shape: m.kind === "buy" ? ("arrowUp" as const) : ("arrowDown" as const),
            color: m.kind === "buy" ? gain : loss,
            text: showLabels ? (m.kind === "buy" ? "BUY" : "EXIT") : undefined,
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
  }, [visible, activeMarkers, theme, chartType, showSma20, showSma50, showSma200, showVolume, showLabels]);

  const shown = hover ?? visible[visible.length - 1];
  const prev = shown ? visible[visible.indexOf(shown) - 1] : undefined;
  const chg = shown && prev ? ((shown.close - prev.close) / prev.close) * 100 : null;

  // Active signal for hovered or selected candle
  const activeSignal = useMemo(() => {
    if (selectedSignal) return selectedSignal;
    if (!shown) return null;
    const candleDay = new Date(shown.ts).toISOString().slice(0, 10);
    return markers.find((m) => m.ts.slice(0, 10) === candleDay) ?? null;
  }, [shown, selectedSignal, markers]);

  const tvSymbol = toTradingViewSymbol(symbol, exchange);

  // Recent chronological signals for ledger display
  const recentSignals = useMemo(() => {
    return [...activeMarkers].reverse().slice(0, 8);
  }, [activeMarkers]);

  return (
    <div className="flex flex-col gap-3">
      {/* Tier 1: Main Controls & Technical Overlays */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-2.5">
        <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
          <span className="font-medium text-foreground flex items-center gap-1.5 mr-1">
            <span className="h-2 w-2 rounded-full bg-gain" />
            <span className="num font-semibold text-[13px]">{symbol}</span>
            <span className="text-[10.5px] text-muted-foreground uppercase">({exchange})</span>
          </span>

          {/* Chart Style */}
          <div className="flex rounded border border-border p-0.5">
            <button
              type="button"
              onClick={() => setChartType("candles")}
              className={clsx(
                "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                chartType === "candles" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Candles
            </button>
            <button
              type="button"
              onClick={() => setChartType("area")}
              className={clsx(
                "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                chartType === "area" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Area
            </button>
          </div>

          <div className="h-3 w-px bg-border mx-0.5" />

          {/* Technical Indicator Toggles */}
          <button
            type="button"
            onClick={() => setShowSma20((v) => !v)}
            className={clsx(
              "num inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors",
              showSma20 ? "border-amber-500/50 bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            SMA 20
          </button>

          <button
            type="button"
            onClick={() => setShowSma50((v) => !v)}
            className={clsx(
              "num inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors",
              showSma50 ? "border-sky-500/50 bg-sky-500/15 text-sky-600 dark:text-sky-400 font-medium" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
            SMA 50
          </button>

          <button
            type="button"
            onClick={() => setShowSma200((v) => !v)}
            className={clsx(
              "num inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors",
              showSma200 ? "border-purple-500/50 bg-purple-500/15 text-purple-600 dark:text-purple-400 font-medium" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
            SMA 200
          </button>

          <button
            type="button"
            onClick={() => setShowVolume((v) => !v)}
            className={clsx(
              "num inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors",
              showVolume ? "border-primary/40 bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            Vol
          </button>
        </div>

        {/* Range Selector & TradingView Launcher */}
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Chart range" className="flex rounded border border-border p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.key}
                role="tab"
                type="button"
                aria-selected={range === r.key}
                onClick={() => setRange(r.key)}
                className={clsx(
                  "num h-6.5 rounded px-2 text-[11.5px] transition-colors",
                  range === r.key ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r.key}
              </button>
            ))}
          </div>

          <a
            href={`https://in.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="num inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-foreground transition-colors"
            title={`Open ${tvSymbol} on official TradingView website`}
          >
            <span>TradingView Web</span>
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>

      {/* Tier 2: Clean Signals Filter & Formatting Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-[11.5px] bg-muted/15 rounded-md px-2.5 py-1.5 border border-border/50">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground font-medium">Signals:</span>

          {/* Signal Kind Filter */}
          <div className="flex rounded border border-border p-0.5 bg-background">
            <button
              type="button"
              onClick={() => setSignalFilter("all")}
              className={clsx(
                "rounded px-2 py-0.5 font-medium transition-colors text-[11px]",
                signalFilter === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              All ({markers.length})
            </button>
            <button
              type="button"
              onClick={() => setSignalFilter("buy")}
              className={clsx(
                "rounded px-2 py-0.5 font-medium transition-colors text-[11px]",
                signalFilter === "buy" ? "bg-gain text-primary-foreground" : "text-gain hover:text-foreground",
              )}
            >
              ▲ Buy Only
            </button>
            <button
              type="button"
              onClick={() => setSignalFilter("exit")}
              className={clsx(
                "rounded px-2 py-0.5 font-medium transition-colors text-[11px]",
                signalFilter === "exit" ? "bg-loss text-primary-foreground" : "text-loss hover:text-foreground",
              )}
            >
              ▼ Exit Only
            </button>
          </div>

          {/* Density Mode: Clean Triggers vs All */}
          <div className="flex rounded border border-border p-0.5 bg-background">
            <button
              type="button"
              onClick={() => setSignalDensity("clean")}
              className={clsx(
                "rounded px-2 py-0.5 font-medium transition-colors text-[11px]",
                signalDensity === "clean" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              title="Suppresses overlapping duplicate exit signals for clean visual readability"
            >
              Clean Triggers
            </button>
            <button
              type="button"
              onClick={() => setSignalDensity("all")}
              className={clsx(
                "rounded px-2 py-0.5 font-medium transition-colors text-[11px]",
                signalDensity === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              title="Shows every raw recorded signal"
            >
              All Events
            </button>
          </div>

          {/* Labels Toggle */}
          <button
            type="button"
            onClick={() => setShowLabels((v) => !v)}
            className={clsx(
              "rounded border px-2 py-0.5 text-[11px] font-medium transition-colors",
              showLabels ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {showLabels ? "Labels: ON" : "Labels: OFF (Arrows only)"}
          </button>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-muted-foreground text-[11px]">
          <span className="inline-flex items-center gap-1">
            <span className="text-gain font-bold text-[13px]">▲</span>
            <span>Buy Marker</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="text-loss font-bold text-[13px]">▼</span>
            <span>Exit Marker</span>
          </span>
          <span className="opacity-40">|</span>
          <button
            type="button"
            onClick={() => setShowSignalsLog((v) => !v)}
            className="hover:text-foreground hover:underline text-primary"
          >
            {showSignalsLog ? "Hide Signals Log" : "View Signals Log"}
          </button>
        </div>
      </div>

      {/* Tier 3: Floating Crosshair OHLC + Active Signal HUD */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] pt-0.5">
        <dl className="num flex flex-wrap gap-x-4 gap-y-1">
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
                <div className={chg >= 0 ? "text-gain" : "text-loss"}>
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
              "num inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-[11.5px] font-medium border shadow-xs transition-all",
              activeSignal.kind === "buy" ? "border-gain/40 bg-gain/10 text-gain" : "border-loss/40 bg-loss/10 text-loss",
            )}
          >
            <span className="font-bold">{activeSignal.kind === "buy" ? "▲ BUY SIGNAL" : "▼ EXIT SIGNAL"}</span>
            <span className="opacity-90">· {activeSignal.label}</span>
            {activeSignal.price ? <span>@ ₹{fmtPrice(activeSignal.price)}</span> : null}
            {activeSignal.stop ? <span className="opacity-80">(Stop: ₹{fmtPrice(activeSignal.stop)})</span> : null}
            {selectedSignal ? (
              <button
                type="button"
                onClick={() => setSelectedSignal(null)}
                className="ml-1 text-[10px] uppercase font-bold underline opacity-80 hover:opacity-100"
              >
                Clear
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Interactive Chart Canvas */}
      <div ref={el} className="h-[400px] w-full md:h-[460px] rounded border border-border/40 bg-background/50" role="img" aria-label={`${symbol} daily price chart, ${range}`} />

      {/* Tier 4: Signals History Ledger & Interactive Table */}
      {showSignalsLog && recentSignals.length > 0 && (
        <div className="mt-1 flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/10 p-3">
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-medium text-foreground">
              Recent Signals Ledger <span className="num text-muted-foreground font-normal">({recentSignals.length} visible in {range})</span>
            </span>
            <span className="text-[11px] text-muted-foreground">Click a signal chip to inspect its parameters</span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {recentSignals.map((sig, idx) => (
              <button
                key={`${sig.ts}-${sig.kind}-${idx}`}
                type="button"
                onClick={() => setSelectedSignal(sig)}
                className={clsx(
                  "flex flex-col text-left rounded-md border p-2 text-[11.5px] transition-all",
                  sig.kind === "buy" ? "border-gain/30 bg-gain/5 hover:border-gain hover:bg-gain/10" : "border-loss/30 bg-loss/5 hover:border-loss hover:bg-loss/10",
                  selectedSignal?.ts === sig.ts && "ring-1 ring-primary shadow-xs",
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className={clsx("num font-bold text-[11px]", sig.kind === "buy" ? "text-gain" : "text-loss")}>
                    {sig.kind === "buy" ? "▲ BUY" : "▼ EXIT"}
                  </span>
                  <span className="num text-[10.5px] text-muted-foreground">
                    {new Date(sig.ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                </div>
                <div className="mt-1 truncate font-medium text-foreground text-[11px]">{sig.label}</div>
                <div className="num mt-0.5 text-[11px] text-muted-foreground">
                  {sig.price ? `Price: ₹${fmtPrice(sig.price)}` : "Triggered"}
                  {sig.stop ? ` · Stop: ₹${fmtPrice(sig.stop)}` : ""}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
