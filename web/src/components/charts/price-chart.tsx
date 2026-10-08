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
import type { Candle } from "@/lib/types";

export type ChartMarker = { ts: string; kind: "buy" | "exit"; label: string };

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
 * interactive technical overlays (SMA 20, SMA 50, SMA 200, Volume), and range controls.
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
  const [signalFilter, setSignalFilter] = useState<"all" | "buy" | "exit">("all");

  const visible = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)!.days;
    if (!candles.length) return candles;
    const cutoff = new Date(candles[candles.length - 1].ts).getTime() - days * 86400000;
    return candles.filter((c) => new Date(c.ts).getTime() >= cutoff);
  }, [candles, range]);

  const activeMarkers = useMemo(() => {
    if (signalFilter === "buy") return markers.filter((m) => m.kind === "buy");
    if (signalFilter === "exit") return markers.filter((m) => m.kind === "exit");
    return markers;
  }, [markers, signalFilter]);

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
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.24 } },
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

    // Buy/Exit Signal Markers directly on candles
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
            text: m.kind === "buy" ? `▲ Buy: ${m.label}` : `▼ Exit: ${m.label}`,
            size: 1.2,
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
  }, [visible, activeMarkers, theme, chartType, showSma20, showSma50, showSma200, showVolume]);

  const shown = hover ?? visible[visible.length - 1];
  const prev = shown ? visible[visible.indexOf(shown) - 1] : undefined;
  const chg = shown && prev ? ((shown.close - prev.close) / prev.close) * 100 : null;

  // Check if hovered candle has a signal
  const hoverSignal = useMemo(() => {
    if (!shown) return null;
    const candleDay = new Date(shown.ts).toISOString().slice(0, 10);
    return markers.find((m) => m.ts.slice(0, 10) === candleDay) ?? null;
  }, [shown, markers]);

  const tvSymbol = toTradingViewSymbol(symbol, exchange);

  return (
    <div className="flex flex-col gap-3">
      {/* Controls & Indicator Overlays Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-2.5">
        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
          <span className="font-medium text-foreground mr-1 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-gain" />
            <span className="num font-semibold">{symbol}</span>
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

          <div className="h-3 w-px bg-border mx-1" />

          {/* Technical Indicator Toggles */}
          <button
            type="button"
            onClick={() => setShowSma20((v) => !v)}
            className={clsx(
              "num inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors",
              showSma20 ? "border-amber-500/40 bg-amber-500/10 text-amber-500 font-medium" : "border-border text-muted-foreground hover:text-foreground",
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
              showSma50 ? "border-sky-500/40 bg-sky-500/10 text-sky-500 font-medium" : "border-border text-muted-foreground hover:text-foreground",
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
              showSma200 ? "border-purple-500/40 bg-purple-500/10 text-purple-500 font-medium" : "border-border text-muted-foreground hover:text-foreground",
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

          <div className="h-3 w-px bg-border mx-1" />

          {/* Signal Filters */}
          <div className="flex rounded border border-border p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setSignalFilter("all")}
              className={clsx(
                "rounded px-2 py-0.5 font-medium transition-colors",
                signalFilter === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              All Signals ({markers.length})
            </button>
            <button
              type="button"
              onClick={() => setSignalFilter("buy")}
              className={clsx(
                "rounded px-2 py-0.5 font-medium transition-colors",
                signalFilter === "buy" ? "bg-gain text-primary-foreground" : "text-gain hover:text-foreground",
              )}
            >
              ▲ Buy
            </button>
            <button
              type="button"
              onClick={() => setSignalFilter("exit")}
              className={clsx(
                "rounded px-2 py-0.5 font-medium transition-colors",
                signalFilter === "exit" ? "bg-loss text-primary-foreground" : "text-loss hover:text-foreground",
              )}
            >
              ▼ Exit
            </button>
          </div>
        </div>

        {/* Timeframe Presets & External TradingView Launcher */}
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
                  range === r.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
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
            <span>Open {tvSymbol} on TradingView</span>
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>

      {/* Floating Crosshair OHLC + Active Signal Inspector Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
        <dl className="num flex flex-wrap gap-x-4 gap-y-1">
          {shown ? (
            <>
              <div className="flex gap-1 text-muted-foreground">
                <dt className="sr-only">Date</dt>
                <dd>{new Date(shown.ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}</dd>
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

        {hoverSignal ? (
          <div
            className={clsx(
              "num inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium border",
              hoverSignal.kind === "buy" ? "border-gain/30 bg-gain/10 text-gain" : "border-loss/30 bg-loss/10 text-loss",
            )}
          >
            <span>{hoverSignal.kind === "buy" ? "▲ Buy Signal" : "▼ Exit Signal"}</span>
            <span className="opacity-75">· {hoverSignal.label}</span>
          </div>
        ) : null}
      </div>

      {/* Interactive Chart Canvas */}
      <div ref={el} className="h-[380px] w-full md:h-[440px]" role="img" aria-label={`${symbol} daily price chart, ${range}`} />

      {/* Strategy Signal Legend and Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-[11.5px] text-muted-foreground border-t border-border/50">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="text-gain font-bold">▲</span>
            <span>Buy signal marker</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-loss font-bold">▼</span>
            <span>Exit signal marker</span>
          </span>
          <span>· Real NSE EOD candles</span>
        </div>
        <div className="num text-[11px] text-muted-foreground/80">
          Powered by TradingView Lightweight Charts SDK
        </div>
      </div>
    </div>
  );
}
