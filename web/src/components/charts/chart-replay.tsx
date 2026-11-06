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
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LogicalRange,
  type MouseEventParams,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon, XIcon } from "@phosphor-icons/react";
import { computeSma } from "@/lib/backtest-engine";
import {
  barsDue,
  buy,
  daysBeforeEnd,
  NO_PRACTICE,
  openResult,
  PRACTICE_BUDGET,
  practiceSummary,
  revealedBetween,
  revealedUpTo,
  rewindPractice,
  sell,
  SPEEDS,
  startIndex,
  STARTS,
  type Practice,
  type SpeedKey,
} from "@/lib/chart-replay";
import { date, price as fmtPrice, rupees } from "@/lib/format";
import { ruleTag } from "@/lib/rules";
import { isWinningExit, signalAction } from "@/lib/signal-trade";
import type { RawChartMarker } from "@/lib/trade-plan";
import type { Candle } from "@/lib/types";

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const toTime = (ts: string) => Math.floor(new Date(ts).getTime() / 1000) as UTCTimestamp;
const round2 = (n: number) => Number(n.toFixed(2));
/** Bars on screen when the replay opens (about 9 px a bar: 40 on a phone, 120 on a laptop); the reader can zoom. */
const windowFor = (width: number) => Math.max(40, Math.min(140, Math.round(width / 9)));
/** Below this width, markers are arrows without words (the words overlap); the readout above names each signal. */
const NARROW = 640;
const isUp = (m: RawChartMarker) => ["buy", "cover"].includes(signalAction(m));

type Series = ISeriesApi<SeriesType>;
interface Built {
  chart: IChartApi;
  main: Series;
  smas: { series: Series; values: (number | null)[] }[];
  vol: Series | null;
  markers: ISeriesMarkersPluginApi<Time>;
  /** The last bar index the series hold. */
  shown: number;
}

/**
 * Chart replay (ADR-048), shown in place of the price chart: pick a day, then play the stock forward one trading day at
 * a time. Each new bar is added with series.update (no redraw of the chart), playback is paced by the screen's frames
 * with the remainder carried (an even speed at 60 or 120 Hz), and only this small panel re-renders. The rules' signals
 * appear on the day they happened; practice trades fill at the day's close. Nothing here is saved.
 */
export function ChartReplay({
  symbol,
  candles,
  markers,
  chartType,
  showSma20,
  showSma50,
  showSma200,
  showVolume,
  onExit,
}: {
  symbol: string;
  candles: Candle[];
  markers: RawChartMarker[];
  chartType: "candles" | "area";
  showSma20: boolean;
  showSma50: boolean;
  showSma200: boolean;
  showVolume: boolean;
  onExit: () => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const narrowRef = useRef(false);
  const built = useRef<Built | null>(null);
  const [phase, setPhase] = useState<"setup" | "replay">("setup");
  const [start, setStartState] = useState(() => startIndex(candles, daysBeforeEnd(candles, 365)));
  // The start as a ref too, so the chart build and the steps read it without rebuilding on every pick.
  const startRef = useRef(start);
  const setStart = useCallback((i: number) => {
    startRef.current = i;
    setStartState(i);
  }, []);
  const [index, setIndex] = useState(start);
  const indexRef = useRef(start);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<SpeedKey>("2x");
  const [pauseAtSignals, setPauseAtSignals] = useState(true);
  const [practice, setPractice] = useState<Practice>(NO_PRACTICE);
  const practiceRef = useRef(practice);
  const [latest, setLatest] = useState<RawChartMarker | null>(null);
  const [theme, setTheme] = useState(0);
  const [shade, setShade] = useState<{ left: number; room: number } | null>(null);
  const last = candles.length - 1;
  const sorted = useMemo(() => [...markers].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)), [markers]);
  // The bar each rule marker sits on (the first session on or after its day).
  const markerBar = useMemo(() => {
    const m = new Map<RawChartMarker, number>();
    let k = 0;
    for (const s of sorted) {
      const day = s.ts.slice(0, 10);
      while (k < candles.length - 1 && candles[k].ts.slice(0, 10) < day) k++;
      m.set(s, k);
    }
    return m;
  }, [sorted, candles]);

  useEffect(() => {
    const obs = new MutationObserver(() => setTheme((t) => t + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // ------------------------------------------------------------------ drawing
  const bar = useCallback(
    (i: number) => {
      const c = candles[i];
      const t = toTime(c.ts);
      return chartType === "area" ? { time: t, value: c.close } : { time: t, open: c.open, high: c.high, low: c.low, close: c.close };
    },
    [candles, chartType],
  );
  const volBar = useCallback(
    (i: number, gain: string, loss: string) => ({
      time: toTime(candles[i].ts),
      value: candles[i].volume,
      color: (i === 0 || candles[i].close >= candles[i - 1].close ? gain : loss) + "40",
    }),
    [candles],
  );

  /** Rule signals and practice trades up to bar `i`. */
  const markersAt = useCallback(
    (i: number, p: Practice): SeriesMarker<Time>[] => {
      const gain = cssVar("--gain");
      const loss = cssVar("--loss");
      const ink = cssVar("--foreground");
      const words = !narrowRef.current;
      const out: SeriesMarker<Time>[] = revealedUpTo(sorted, candles, i).map((m) => {
        const up = isUp(m);
        return {
          time: toTime(candles[markerBar.get(m) ?? 0].ts),
          position: up ? "belowBar" : "aboveBar",
          shape: up ? "arrowUp" : "arrowDown",
          color: up || isWinningExit(m) ? gain : loss,
          text: words ? `${ruleTag(m.strategy)} ${up ? "BUY" : "EXIT"}` : undefined,
          size: 1.2,
        };
      });
      const bought = (at: number) => ({ time: toTime(candles[at].ts), position: "belowBar" as const, shape: "circle" as const, color: ink, text: words ? "You bought" : "B", size: 1 });
      for (const t of p.trades) {
        out.push(bought(t.entryIndex));
        out.push({
          time: toTime(candles[t.exitIndex].ts),
          position: "aboveBar",
          shape: "circle",
          color: t.gain >= 0 ? gain : loss,
          text: words ? `You sold ${t.pct >= 0 ? "+" : "−"}${Math.abs(t.pct).toFixed(1)}%` : "S",
          size: 1,
        });
      }
      if (p.position) out.push(bought(p.position.entryIndex));
      return out.sort((a, b) => (a.time as number) - (b.time as number));
    },
    [sorted, candles, markerBar],
  );

  /** Show bars 0..i: forward by update (one bar at a time, no redraw), back by pop, far jumps by setData. */
  const showTo = useCallback(
    (i: number, p: Practice) => {
      const b = built.current;
      if (!b) return;
      const gain = cssVar("--gain");
      const loss = cssVar("--loss");
      if (b.shown >= 0 && i > b.shown && i - b.shown <= 40) {
        for (let k = b.shown + 1; k <= i; k++) {
          b.main.update(bar(k));
          for (const s of b.smas) if (s.values[k] != null) s.series.update({ time: toTime(candles[k].ts), value: round2(s.values[k]!) });
          b.vol?.update(volBar(k, gain, loss));
        }
      } else if (b.shown >= 0 && i < b.shown && b.shown - i <= 40) {
        b.main.pop(b.shown - i);
        for (const s of b.smas) {
          const drop = s.values.slice(i + 1, b.shown + 1).filter((v) => v != null).length;
          if (drop) s.series.pop(drop);
        }
        b.vol?.pop(b.shown - i);
      } else if (i !== b.shown) {
        b.main.setData(Array.from({ length: i + 1 }, (_, k) => bar(k)));
        for (const s of b.smas)
          s.series.setData(s.values.slice(0, i + 1).flatMap((v, k) => (v == null ? [] : [{ time: toTime(candles[k].ts), value: round2(v) }])));
        b.vol?.setData(Array.from({ length: i + 1 }, (_, k) => volBar(k, gain, loss)));
      }
      b.shown = i;
      b.markers.setMarkers(markersAt(i, p));
    },
    [bar, volBar, candles, markersAt],
  );

  // Build the chart (again when the style, overlays, theme or phase change), showing what the phase allows.
  useEffect(() => {
    if (!el.current || candles.length < 30) return;
    const ink = cssVar("--foreground");
    const muted = cssVar("--muted-foreground");
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
      grid: { vertLines: { visible: false }, horzLines: { color: cssVar("--border"), style: 2 } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderVisible: false, rightOffset: 8, shiftVisibleRangeOnNewBar: true },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: muted, width: 1, style: 3, labelBackgroundColor: ink },
        horzLine: { color: muted, width: 1, style: 3, labelBackgroundColor: ink },
      },
      handleScale: { axisPressedMouseMove: false },
    });
    const main: Series =
      chartType === "area"
        ? chart.addSeries(AreaSeries, { topColor: gain + "40", bottomColor: gain + "05", lineColor: gain, lineWidth: 2, priceLineColor: ink, priceLineStyle: 2 })
        : chart.addSeries(CandlestickSeries, {
            upColor: gain,
            downColor: loss,
            borderUpColor: gain,
            borderDownColor: loss,
            wickUpColor: gain,
            wickDownColor: loss,
            priceLineColor: ink,
            priceLineStyle: 2,
          });
    const closes = candles.map((c) => c.close);
    const smas = (
      [
        [showSma20, 20, "--sma-20", "#D97706"],
        [showSma50, 50, "--sma-50", "#0284C7"],
        [showSma200, 200, "--sma-200", "#7C3AED"],
      ] as const
    )
      .filter(([on]) => on)
      .map(([, period, token, fallback]) => ({
        series: chart.addSeries(LineSeries, { color: cssVar(token) || fallback, lineWidth: 2, title: `SMA ${period}`, priceLineVisible: false, lastValueVisible: false }) as Series,
        values: computeSma(closes, period),
      }));
    let vol: Series | null = null;
    if (showVolume) {
      vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    }
    built.current = { chart, main, smas, vol, markers: createSeriesMarkers(main, []), shown: -1 };
    const width = el.current.clientWidth;
    narrowRef.current = width < NARROW;
    const setup = phase === "setup";
    const upTo = setup ? last : indexRef.current;
    showTo(upTo, setup ? NO_PRACTICE : practiceRef.current);
    if (setup) built.current.markers.setMarkers([]);
    // Setup: the start two thirds across, so the part that will be hidden is in view. Replay: the latest bar at the right.
    const bars = windowFor(width);
    const focus = setup ? startRef.current : upTo;
    chart
      .timeScale()
      .setVisibleLogicalRange(
        (setup ? { from: focus - Math.round(bars * 0.66), to: focus + Math.round(bars * 0.34) } : { from: focus - bars + 8, to: focus + 8 }) as LogicalRange,
      );
    // Crossing the narrow width (a rotated phone, a resized window) switches the marker words.
    const resize = new ResizeObserver(() => {
      const narrow = (el.current?.clientWidth ?? width) < NARROW;
      if (narrow === narrowRef.current || !built.current) return;
      narrowRef.current = narrow;
      if (phase !== "setup") built.current.markers.setMarkers(markersAt(indexRef.current, practiceRef.current));
    });
    resize.observe(el.current);

    // Choosing the start: click a day on the chart; the part after it is shaded (it will be hidden).
    const onClick = (p: MouseEventParams) => {
      if (!setup || p.logical == null) return;
      const i = Math.round(p.logical as number);
      if (i >= 0 && i <= last) setStart(startIndex(candles, candles[i].ts.slice(0, 10)));
    };
    chart.subscribeClick(onClick);
    return () => {
      resize.disconnect();
      chart.unsubscribeClick(onClick);
      chart.remove();
      built.current = null;
    };
  }, [candles, chartType, showSma20, showSma50, showSma200, showVolume, theme, phase, last, showTo, setStart, markersAt]);

  // In setup, the shade over the days the replay will hide follows the chosen start through pans and zooms.
  useEffect(() => {
    if (phase !== "setup") return;
    const chart = built.current?.chart;
    if (!chart) return;
    let raf = 0;
    // Measured once the chart has laid out (its width is 0 in the first frames), and again on every pan, zoom or resize.
    const place = (tries = 0) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const ts = chart.timeScale();
        if (ts.width() === 0 && tries < 30) return place(tries + 1);
        // By the start bar's time, plus half a bar: the line sits just after the start day. (logicalToCoordinate gives 0
        // for a fractional logical index in lightweight-charts 5.2.)
        const at = ts.timeToCoordinate(toTime(candles[start].ts));
        const x = at == null ? null : at + (ts.options().barSpacing ?? 6) / 2;
        setShade(x == null ? null : { left: Math.max(0, Math.min(ts.width(), x)), room: ts.width() - x });
      });
    };
    const onRange = () => place();
    place();
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    const resize = el.current ? new ResizeObserver(onRange) : null;
    if (el.current) resize?.observe(el.current);
    return () => {
      cancelAnimationFrame(raf);
      resize?.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
    };
  }, [phase, start, theme, chartType, showSma20, showSma50, showSma200, showVolume, candles]);

  // ------------------------------------------------------------------ moving through time
  const goTo = useCallback(
    (i: number, announce = true) => {
      const from = indexRef.current;
      const to = Math.max(startRef.current, Math.min(last, i));
      if (to === from) return;
      let p = practiceRef.current;
      if (to < from) {
        p = rewindPractice(p, to);
        practiceRef.current = p;
        setPractice(p);
      }
      indexRef.current = to;
      showTo(to, p);
      setIndex(to);
      if (announce && to > from) {
        const fresh = revealedBetween(sorted, candles, from, to);
        if (fresh.length) setLatest(fresh[fresh.length - 1]);
      }
    },
    [last, showTo, sorted, candles],
  );

  // Playback: frames from requestAnimationFrame, the remainder carried, a pause at a signal when asked.
  useEffect(() => {
    if (!playing) return;
    const perSecond = SPEEDS.find((s) => s.key === speed)!.perSecond;
    let raf = 0;
    let prev = performance.now();
    let carry = 0;
    const frame = (now: number) => {
      const due = barsDue(now - prev, perSecond, carry);
      prev = now;
      carry = due.carryMs;
      if (due.bars) {
        const from = indexRef.current;
        let to = Math.min(last, from + due.bars);
        let stop = to >= last;
        if (pauseAtSignals) {
          const fresh = revealedBetween(sorted, candles, from, to);
          if (fresh.length) {
            to = Math.max(from + 1, Math.min(to, markerBar.get(fresh[0]) ?? to));
            stop = true;
          }
        }
        goTo(to);
        if (stop) {
          setPlaying(false);
          return;
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, pauseAtSignals, last, sorted, candles, goTo, markerBar]);

  const begin = () => {
    indexRef.current = start;
    practiceRef.current = NO_PRACTICE;
    setIndex(start);
    setPractice(NO_PRACTICE);
    setLatest(null);
    setPhase("replay");
  };
  const restart = () => {
    setPlaying(false);
    setLatest(null);
    setPhase("setup");
  };
  const togglePlay = useCallback(() => {
    if (phase === "setup" || indexRef.current >= last) return;
    setPlaying((v) => !v);
  }, [phase, last]);
  const step = useCallback(
    (d: number) => {
      if (phase === "setup") return;
      setPlaying(false);
      goTo(indexRef.current + d);
    },
    [phase, goTo],
  );

  // Space plays and pauses, the arrows step a day (Shift: ten), Escape leaves; not while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      if (e.key === " " && tag !== "BUTTON") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(e.shiftKey ? 10 : 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(e.shiftKey ? -10 : -1);
      } else if (e.key === "Escape") {
        onExit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, step, onExit]);

  // ------------------------------------------------------------------ practice
  const trade = (next: (p: Practice) => Practice) => {
    setPlaying(false);
    const p = next(practiceRef.current);
    practiceRef.current = p;
    setPractice(p);
    built.current?.markers.setMarkers(markersAt(indexRef.current, p));
  };

  if (candles.length < 30) {
    return (
      <div className="rounded-md border border-border p-4 text-[13px] text-muted-foreground">
        There isn&apos;t enough history for {symbol} to replay yet.{" "}
        <button type="button" onClick={onExit} className="underline">
          Back to the chart
        </button>
      </div>
    );
  }

  const shownIndex = phase === "setup" ? start : index;
  const c = candles[shownIndex];
  const prevClose = shownIndex > 0 ? candles[shownIndex - 1].close : null;
  const chg = prevClose ? ((c.close - prevClose) / prevClose) * 100 : null;
  const open = openResult(practice, candles, index);
  const sum = practiceSummary(practice.trades);
  const atEnd = phase === "replay" && index >= last;

  return (
    <section className="flex flex-col gap-2" aria-label={`Chart replay of ${symbol}`} data-testid="chart-replay">
      {phase === "setup" ? (
        <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/15 px-3 py-2.5" data-testid="replay-setup">
          <p className="text-[13px]">
            <span className="font-medium">Where should the replay start?</span>{" "}
            <span className="text-muted-foreground">Pick a time, or click a day on the chart. Everything after it stays hidden until you play.</span>
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {STARTS.map((s) => {
              const i = startIndex(candles, daysBeforeEnd(candles, s.days));
              return (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={start === i}
                  onClick={() => setStart(i)}
                  className={clsx(
                    "h-8 rounded-md border px-2.5 text-[12.5px] transition-colors",
                    start === i ? "border-foreground bg-foreground text-background" : "border-border hover:bg-foreground/[0.04]",
                  )}
                >
                  {s.label}
                </button>
              );
            })}
            <label className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              or from
              <input
                type="date"
                aria-label="Replay start date"
                min={candles[0].ts.slice(0, 10)}
                max={candles[last - 1].ts.slice(0, 10)}
                value={candles[start].ts.slice(0, 10)}
                onChange={(e) => e.target.value && setStart(startIndex(candles, e.target.value))}
                className="num h-8 rounded-md border border-input bg-card px-2 text-[12.5px] text-foreground"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={begin}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-medium text-primary-foreground hover:opacity-90"
            >
              <PlayIcon size={15} weight="fill" aria-hidden /> Start the replay on {date(candles[start].ts)}
            </button>
            <button type="button" onClick={onExit} className="h-9 rounded-md px-2 text-[13px] text-muted-foreground hover:text-foreground">
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* The day on screen */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
        <dl className="num flex flex-wrap gap-x-3.5 gap-y-0.5">
          <div className="flex gap-1">
            <dt className="sr-only">Date</dt>
            <dd className="font-medium text-foreground" data-testid="replay-date">
              {date(c.ts)}
            </dd>
          </div>
          {(["open", "high", "low", "close"] as const).map((k) => (
            <div key={k} className="flex gap-1">
              <dt className="uppercase text-muted-foreground">{k[0]}</dt>
              <dd>{fmtPrice(c[k])}</dd>
            </div>
          ))}
          {chg != null ? (
            <div className={chg >= 0 ? "text-gain font-medium" : "text-loss font-medium"}>
              <dt className="sr-only">Change</dt>
              <dd>
                {chg >= 0 ? "▲ +" : "▼ −"}
                {Math.abs(chg).toFixed(2)}%
              </dd>
            </div>
          ) : null}
        </dl>
        {phase === "replay" ? (
          <span className="num text-muted-foreground" data-testid="replay-progress">
            Day {index - start} of {last - start}
          </span>
        ) : null}
      </div>

      {latest && phase === "replay" ? (
        <p className="num -mt-1 text-[12px]" role="status" data-testid="replay-signal">
          <span className={clsx("font-medium", isUp(latest) ? "text-gain" : "text-loss")}>{isUp(latest) ? "▲ Rule signal:" : "▼ Rule exit:"}</span>{" "}
          <span className="text-foreground">{latest.label}</span>
          {latest.price ? <span className="text-muted-foreground"> at ₹{fmtPrice(latest.price)}</span> : null}
          <span className="text-muted-foreground"> on {date(latest.ts)}</span>
          {latest.pnlPct != null ? (
            <span className={latest.pnlPct >= 0 ? "text-gain" : "text-loss"}>
              {" "}
              ({latest.pnlPct >= 0 ? "▲ +" : "▼ −"}
              {Math.abs(latest.pnlPct).toFixed(1)}%)
            </span>
          ) : null}
        </p>
      ) : null}

      {/* The chart */}
      <div className="relative">
        <div
          ref={el}
          className="h-[380px] w-full rounded border border-border/40 bg-background/50 md:h-[460px] lg:h-[500px]"
          role="img"
          aria-label={phase === "setup" ? `${symbol} chart: choose where the replay starts` : `${symbol} replay, ${date(c.ts)}`}
        />
        {phase === "setup" && shade != null ? (
          <div className="pointer-events-none absolute inset-y-0 right-0 overflow-hidden border-l-2 border-foreground/60 bg-foreground/[0.07]" style={{ left: shade.left }} aria-hidden="true">
            <span className="num absolute left-1.5 top-1.5 whitespace-nowrap rounded bg-card/95 px-1.5 py-0.5 text-[11px] font-medium shadow-xs ring-1 ring-border">
              {shade.room > 150 ? "Hidden in the replay" : "Hidden"}
            </span>
          </div>
        ) : null}
      </div>

      {phase === "replay" ? (
        <>
          {/* Controls */}
          <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/15 px-2.5 py-2" data-testid="replay-controls">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <IconButton label="Back one day" onClick={() => step(-1)} disabled={index <= start}>
                  <SkipBackIcon size={16} weight="fill" aria-hidden />
                </IconButton>
                <button
                  type="button"
                  onClick={togglePlay}
                  disabled={atEnd}
                  aria-label={playing ? "Pause" : "Play"}
                  className="inline-grid size-10 place-items-center rounded-full bg-primary text-primary-foreground transition-transform hover:opacity-90 active:scale-95 disabled:opacity-40"
                >
                  {playing ? <PauseIcon size={18} weight="fill" aria-hidden /> : <PlayIcon size={18} weight="fill" aria-hidden />}
                </button>
                <IconButton label="Forward one day" onClick={() => step(1)} disabled={atEnd}>
                  <SkipForwardIcon size={16} weight="fill" aria-hidden />
                </IconButton>
              </div>

              <div role="radiogroup" aria-label="Speed, trading days a second" className="flex rounded-md border border-border bg-background p-0.5">
                {SPEEDS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    role="radio"
                    aria-checked={speed === s.key}
                    title={`${s.perSecond} trading day${s.perSecond === 1 ? "" : "s"} a second`}
                    onClick={() => setSpeed(s.key)}
                    className={clsx(
                      "num h-8 min-w-9 rounded px-1.5 text-[12px] transition-colors",
                      speed === s.key ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <input type="checkbox" checked={pauseAtSignals} onChange={(e) => setPauseAtSignals(e.target.checked)} className="size-4 accent-primary" />
                Pause at each rule signal
              </label>

              <span className="ml-auto flex items-center gap-1">
                <button type="button" onClick={restart} className="h-8 rounded-md px-2 text-[12.5px] text-muted-foreground hover:text-foreground">
                  New start
                </button>
                <button type="button" onClick={onExit} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-[12.5px] hover:bg-foreground/[0.04]">
                  <XIcon size={13} aria-hidden /> Exit replay
                </button>
              </span>
            </div>
            <input
              type="range"
              min={start}
              max={last}
              step={1}
              value={index}
              aria-label="Replay position"
              aria-valuetext={date(c.ts)}
              onChange={(e) => {
                setPlaying(false);
                goTo(Number(e.target.value), false);
              }}
              className="h-2 w-full cursor-pointer accent-primary"
            />
            <p className="hidden text-[11.5px] text-muted-foreground sm:block">Space plays and pauses · ← and → move a day (with Shift, ten) · Esc leaves the replay</p>
          </div>

          {/* Practice trades */}
          <div className="flex flex-col gap-2 rounded-md border border-border/60 px-3 py-2.5" data-testid="replay-practice">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium">Practise</span>
              <span className="text-[12px] text-muted-foreground">
                with {rupees(PRACTICE_BUDGET, { decimals: false })}, filled at the day&apos;s close. Nothing is saved.
              </span>
              <span className="ml-auto flex gap-1.5">
                <button
                  type="button"
                  onClick={() => trade((p) => buy(p, candles, indexRef.current))}
                  disabled={!!practice.position || atEnd}
                  className="h-9 min-w-16 rounded-md bg-gain px-3.5 text-[13px] font-medium text-primary-foreground disabled:opacity-40"
                >
                  Buy
                </button>
                <button
                  type="button"
                  onClick={() => trade((p) => sell(p, candles, indexRef.current))}
                  disabled={!practice.position || practice.position.entryIndex >= index}
                  className="h-9 min-w-16 rounded-md bg-loss px-3.5 text-[13px] font-medium text-primary-foreground disabled:opacity-40"
                >
                  Sell
                </button>
              </span>
            </div>
            {practice.position && open ? (
              <p className="num text-[12.5px]" data-testid="replay-position">
                You hold {practice.position.shares} shares bought at ₹{fmtPrice(practice.position.entryPrice)} on {date(candles[practice.position.entryIndex].ts)}:{" "}
                <span className={open.gain >= 0 ? "font-medium text-gain" : "font-medium text-loss"}>
                  {open.gain >= 0 ? "▲ +" : "▼ −"}
                  {rupees(Math.abs(open.gain))} ({open.pct >= 0 ? "+" : "−"}
                  {Math.abs(open.pct).toFixed(2)}%)
                </span>{" "}
                <span className="text-muted-foreground">
                  after {open.days} day{open.days === 1 ? "" : "s"}
                </span>
              </p>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">No practice position. Buy where you would have bought, then see how it played out.</p>
            )}
            {sum.count ? (
              <div className="text-[12.5px]" data-testid="replay-trades">
                <p className="num">
                  {sum.count} practice trade{sum.count === 1 ? "" : "s"}, {sum.won} made money:{" "}
                  <span className={sum.gain >= 0 ? "font-medium text-gain" : "font-medium text-loss"}>
                    {sum.gain >= 0 ? "▲ +" : "▼ −"}
                    {rupees(Math.abs(sum.gain))}
                  </span>{" "}
                  <span className="text-muted-foreground">before charges</span>
                </p>
                <ul className="num mt-1 flex flex-col gap-0.5 text-[12px] text-muted-foreground">
                  {[...practice.trades]
                    .reverse()
                    .slice(0, 5)
                    .map((t) => (
                      <li key={`${t.entryIndex}-${t.exitIndex}`}>
                        {date(candles[t.entryIndex].ts)} → {date(candles[t.exitIndex].ts)}: ₹{fmtPrice(t.entryPrice)} → ₹{fmtPrice(t.exitPrice)}{" "}
                        <span className={t.gain >= 0 ? "text-gain" : "text-loss"}>
                          {t.pct >= 0 ? "▲ +" : "▼ −"}
                          {Math.abs(t.pct).toFixed(2)}%
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
            {atEnd ? (
              <p className="text-[12.5px]" role="status">
                You&apos;ve reached the latest day.{" "}
                <button type="button" onClick={restart} className="underline">
                  Start again from another day
                </button>
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-grid size-9 place-items-center rounded-full text-foreground transition-colors hover:bg-foreground/[0.07] active:scale-95 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
