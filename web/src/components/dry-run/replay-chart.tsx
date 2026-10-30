"use client";

import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import { ColorType, createChart, CrosshairMode, LineSeries, LineStyle, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { date, rupees } from "@/lib/format";
import type { ReplayPoint } from "@/lib/dry-run";

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const PLAY_MS = 2200;

/**
 * The plan's money over the replay, drawn day by day (instantly under reduced motion), with the
 * same money in the NIFTY 50 as a dashed line. Crosshair shows both values for any day.
 */
export function ReplayChart({ points }: { points: ReplayPoint[] }) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const planRef = useRef<ISeriesApi<"Line"> | null>(null);
  const benchRef = useRef<ISeriesApi<"Line"> | null>(null);
  const [theme, setTheme] = useState(0);
  const [run, setRun] = useState(0);
  const [cursor, setCursor] = useState<ReplayPoint | null>(null);

  useEffect(() => {
    const obs = new MutationObserver(() => setTheme((t) => t + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!el.current) return;
    const ink = cssVar("--foreground");
    const muted = cssVar("--muted-foreground");
    const chart = createChart(el.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: muted,
        fontFamily: getComputedStyle(document.body).getPropertyValue("--font-mono") || "monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: cssVar("--border"), style: LineStyle.Dashed } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: muted, width: 1, style: LineStyle.Dotted, labelBackgroundColor: ink },
        horzLine: { color: muted, width: 1, style: LineStyle.Dotted, labelBackgroundColor: ink },
      },
      handleScroll: false,
      handleScale: false,
      localization: { priceFormatter: (v: number) => rupees(v, { decimals: false }) },
    });
    benchRef.current = chart.addSeries(LineSeries, { color: muted, lineWidth: 2, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    planRef.current = chart.addSeries(LineSeries, { color: ink, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    chartRef.current = chart;
    chart.subscribeCrosshairMove((p) => {
      if (!p.time) return setCursor(null);
      const t = String(p.time);
      setCursor(points.find((x) => x.ts === t) ?? null);
    });
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [theme, points]);

  // Draw the line in, day by day.
  useEffect(() => {
    const plan = planRef.current;
    const bench = benchRef.current;
    const chart = chartRef.current;
    if (!plan || !bench || !chart || !points.length) return;
    const planData = points.map((p) => ({ time: p.ts as Time, value: p.value }));
    const benchData = points.filter((p) => p.bench != null).map((p) => ({ time: p.ts as Time, value: p.bench! }));
    if (reducedMotion()) {
      plan.setData(planData);
      bench.setData(benchData);
      chart.timeScale().fitContent();
      return;
    }
    // The benchmark sets the axis for the whole replay first, so the plan's line grows into a still frame.
    plan.setData([]);
    bench.setData(benchData);
    chart.timeScale().fitContent();
    let frame = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const n = Math.max(1, Math.round((Math.min(1, (now - t0) / PLAY_MS)) * planData.length));
      plan.setData(planData.slice(0, n));
      if (n < planData.length) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [points, theme, run]);

  const last = points.at(-1);
  const shown = cursor ?? last;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 rounded-full bg-foreground" /> Your plan
            {shown ? <span className="num text-foreground">{rupees(shown.value, { decimals: false })}</span> : null}
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-0 w-4 border-t-2 border-dashed border-muted-foreground" /> Same money in the NIFTY 50
            {shown?.bench != null ? <span className="num text-foreground">{rupees(shown.bench, { decimals: false })}</span> : null}
          </span>
          {shown ? <span className="num">{date(shown.ts)}</span> : null}
        </div>
        <button
          type="button"
          onClick={() => setRun((r) => r + 1)}
          className="flex items-center gap-1.5 rounded-full bg-muted/50 px-3 py-1 text-[12px] text-foreground transition-colors duration-150 hover:bg-muted"
        >
          <ArrowCounterClockwiseIcon size={13} aria-hidden /> Replay
        </button>
      </div>
      <div
        ref={el}
        role="img"
        aria-label={last ? `Your plan's value from ${date(points[0].ts)} to ${date(last.ts)}: from ${rupees(points[0].value, { decimals: false })} to ${rupees(last.value, { decimals: false })}` : "Replay"}
        className="h-[260px] w-full"
        data-testid="replay-chart"
      />
    </div>
  );
}
