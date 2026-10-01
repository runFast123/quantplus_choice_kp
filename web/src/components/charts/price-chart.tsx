"use client";

import clsx from "clsx";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { price as fmtPrice, volume as fmtVolume } from "@/lib/format";
import type { Candle } from "@/lib/types";

export type ChartMarker = { ts: string; kind: "buy" | "exit"; label: string };

const RANGES = [
  { key: "3M", days: 92 },
  { key: "6M", days: 183 },
  { key: "1Y", days: 365 },
  { key: "2Y", days: 731 },
] as const;

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const toTime = (ts: string) => Math.floor(new Date(ts).getTime() / 1000) as UTCTimestamp;

/**
 * Daily candles + volume band + signal markers. Colors come from the theme
 * tokens at runtime, so light/dark each use their own validated gain/loss.
 */
export function PriceChart({ candles, markers, symbol }: { candles: Candle[]; markers: ChartMarker[]; symbol: string }) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("1Y");
  const [theme, setTheme] = useState(0);
  const [hover, setHover] = useState<Candle | null>(null);

  const visible = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)!.days;
    if (!candles.length) return candles;
    // Anchor to the latest session, not the wall clock: data is end-of-day.
    const cutoff = new Date(candles[candles.length - 1].ts).getTime() - days * 86400000;
    return candles.filter((c) => new Date(c.ts).getTime() >= cutoff);
  }, [candles, range]);

  // Re-render when the theme class on <html> flips.
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
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.26 } },
      timeScale: { borderVisible: false, rightOffset: 4, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: muted, width: 1, style: 3, labelBackgroundColor: ink },
        horzLine: { color: muted, width: 1, style: 3, labelBackgroundColor: ink },
      },
      handleScale: { axisPressedMouseMove: false },
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: gain,
      downColor: loss,
      borderUpColor: gain,
      borderDownColor: loss,
      wickUpColor: gain,
      wickDownColor: loss,
      priceLineColor: ink,
      priceLineStyle: 2,
    });
    series.setData(visible.map((c) => ({ time: toTime(c.ts), open: c.open, high: c.high, low: c.low, close: c.close })));

    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    vol.setData(
      visible.map((c, i) => ({
        time: toTime(c.ts),
        value: c.volume,
        color: (i === 0 || c.close >= visible[i - 1].close ? gain : loss) + "40",
      })),
    );

    const first = new Date(visible[0].ts).getTime();
    createSeriesMarkers(
      series,
      markers
        .filter((m) => new Date(m.ts).getTime() >= first)
        .map((m) => {
          // Snap to the candle on/before the signal time.
          const t = toTime(m.ts);
          const bar = [...visible].reverse().find((c) => toTime(c.ts) <= t) ?? visible[0];
          return {
            time: toTime(bar.ts),
            position: m.kind === "buy" ? ("belowBar" as const) : ("aboveBar" as const),
            shape: m.kind === "buy" ? ("arrowUp" as const) : ("arrowDown" as const),
            color: m.kind === "buy" ? gain : loss,
            text: m.label,
            size: 1,
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
  }, [visible, markers, theme]);

  const shown = hover ?? visible[visible.length - 1];
  const prev = shown ? visible[visible.indexOf(shown) - 1] : undefined;
  const chg = shown && prev ? ((shown.close - prev.close) / prev.close) * 100 : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        {/* Crosshair readout doubles as the tooltip: OHLC for the hovered session. */}
        <dl className="num flex flex-wrap gap-x-4 gap-y-1 text-[12px]" aria-live="polite">
          {shown ? (
            <>
              <div className="text-muted-foreground">{new Date(shown.ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}</div>
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
              {chg != null ? <div className={chg >= 0 ? "text-gain" : "text-loss"}>{chg >= 0 ? "▲ +" : "▼ −"}{Math.abs(chg).toFixed(2)}%</div> : null}
            </>
          ) : null}
        </dl>
        <div role="tablist" aria-label="Chart range" className="flex rounded-md border border-border p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              role="tab"
              type="button"
              aria-selected={range === r.key}
              onClick={() => setRange(r.key)}
              className={clsx(
                "num h-7 rounded-[5px] px-2.5 text-[12px] transition-colors",
                range === r.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.key}
            </button>
          ))}
        </div>
      </div>
      <div ref={el} className="h-[360px] w-full md:h-[420px]" role="img" aria-label={`${symbol} daily price chart, ${range}`} />
      <p className="mt-2 flex flex-wrap gap-4 text-[11.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-gain">▲</span> Buy signal
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-loss">▼</span> Exit signal
        </span>
        <span>Volume in the lower band · candles are end-of-day</span>
      </p>
    </div>
  );
}
