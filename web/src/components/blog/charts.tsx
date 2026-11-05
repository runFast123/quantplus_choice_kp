"use client";

// Interactive charts for the blog: "the usual way" (ochre) against "our rule" (blue), a validated categorical pair
// (--series-usual / --series-ours, light and dark). Every chart has a legend, hover or tap details, and a table view.
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { count, pct, shortDate, signed } from "@/lib/blog/format";
import { HIST_LABELS, type Example, type Side, type Stats } from "@/lib/blog/types";

const USUAL = "var(--series-usual)";
const OURS = "var(--series-ours)";

type Names = { usualName: string; oursName: string };

function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function Legend({ usualName, oursName }: Names) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: USUAL }} aria-hidden />
        {usualName}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: OURS }} aria-hidden />
        {oursName}
      </span>
    </div>
  );
}

function ChartFrame({
  title,
  caption,
  names,
  controls,
  table,
  children,
}: {
  title: string;
  caption: string;
  names: Names;
  controls?: React.ReactNode;
  table: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <figure className="my-8 rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-snug text-foreground">{title}</p>
          <div className="mt-1.5">
            <Legend {...names} />
          </div>
        </div>
        {controls}
      </div>
      <div className="mt-4">{children}</div>
      <figcaption className="mt-3 text-[12.5px] leading-5 text-muted-foreground">{caption}</figcaption>
      <details className="mt-2 text-[12.5px]">
        <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">Show the numbers</summary>
        <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label={`${title}: the numbers`}>
          {table}
        </div>
      </details>
    </figure>
  );
}

const th = "border-b border-border px-2 py-1.5 text-left font-medium text-muted-foreground";
const td = "border-b border-border/60 px-2 py-1.5 num";
const tdText = "border-b border-border/60 px-2 py-1.5";

// ------------------------------------------------------------------------------------------------ periods
type Metric = "made" | "avg" | "median";
const METRICS: { key: Metric; label: string }[] = [
  { key: "made", label: "Made money" },
  { key: "avg", label: "Average trade" },
  { key: "median", label: "Middle trade" },
];
const val = (s: Stats, m: Metric) => (m === "made" ? s.made_money_pct : m === "avg" ? s.avg_pct : s.median_pct);
const fmt = (x: number, m: Metric) => (m === "made" ? pct(x) : signed(x, 2));

export function PeriodsChart({ usual, ours, title, caption, ...names }: { usual: Side; ours: Side; title: string; caption: string } & Names) {
  const [m, setM] = useState<Metric>("made");
  const rows: { label: string; u: Stats; o: Stats }[] = [
    { label: "All years", u: usual.all, o: ours.all },
    { label: "2019 to 2023", u: usual.early, o: ours.early },
    { label: "2024 to 2026", u: usual.recent, o: ours.recent },
  ];
  const signedScale = m !== "made";
  const max = signedScale ? Math.max(...rows.flatMap((r) => [Math.abs(val(r.u, m)), Math.abs(val(r.o, m))]), 0.5) : 100;

  const bar = (x: number, color: string, label: string) => {
    const w = (Math.abs(x) / max) * (signedScale ? 42 : 100);
    return (
      <div className="relative h-6" title={label}>
        {signedScale ? <div className="absolute inset-y-0 left-1/2 w-px bg-border" aria-hidden /> : null}
        <div
          className="absolute inset-y-0.5 rounded-[4px] transition-[width,left] duration-200"
          style={{ background: color, width: `${w}%`, left: signedScale ? (x >= 0 ? "50%" : `${50 - w}%`) : 0 }}
        />
        <span
          className="num absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[12px] text-foreground"
          style={
            signedScale
              ? x >= 0
                ? { left: `calc(${50 + w}% + 6px)` }
                : { right: `calc(${50 + w}% + 6px)` }
              : { left: `calc(${w}% + 6px)` }
          }
        >
          {fmt(x, m)}
        </span>
      </div>
    );
  };

  return (
    <ChartFrame
      title={m === "made" ? title : m === "avg" ? "The average trade, after costs" : "The middle trade, after costs"}
      caption={caption}
      names={names}
      controls={
        <div role="group" aria-label="Measure" className="flex rounded-lg border border-border bg-background p-0.5">
          {METRICS.map((x) => (
            <button
              key={x.key}
              type="button"
              aria-pressed={m === x.key}
              onClick={() => setM(x.key)}
              className={clsx(
                "rounded-md px-2.5 py-1 text-[12px] transition-colors",
                m === x.key ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
      }
      table={
        <table className="w-full min-w-[420px] border-collapse">
          <thead>
            <tr>
              <th className={th}>Period</th>
              <th className={th}>Version</th>
              <th className={clsx(th, "text-right")}>Trades</th>
              <th className={clsx(th, "text-right")}>Made money</th>
              <th className={clsx(th, "text-right")}>Average</th>
              <th className={clsx(th, "text-right")}>Middle</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((r) =>
              ([
                [names.usualName, r.u],
                [names.oursName, r.o],
              ] as const).map(([n, s]) => (
                <tr key={`${r.label}${n}`}>
                  <td className={tdText}>{r.label}</td>
                  <td className={tdText}>{n}</td>
                  <td className={clsx(td, "text-right")}>{count(s.trades)}</td>
                  <td className={clsx(td, "text-right")}>{pct(s.made_money_pct)}</td>
                  <td className={clsx(td, "text-right")}>{signed(s.avg_pct, 2)}</td>
                  <td className={clsx(td, "text-right")}>{signed(s.median_pct, 2)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      }
    >
      <div className="flex flex-col gap-4">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[84px_1fr] items-center gap-x-3 sm:grid-cols-[110px_1fr]">
            <span className="text-[12.5px] font-medium text-foreground">{r.label}</span>
            <div className={clsx("flex flex-col gap-1", !signedScale && "pr-14")}>
              {bar(val(r.u, m), USUAL, `${names.usualName}: ${fmt(val(r.u, m), m)} over ${count(r.u.trades)} trades`)}
              {bar(val(r.o, m), OURS, `${names.oursName}: ${fmt(val(r.o, m), m)} over ${count(r.o.trades)} trades`)}
            </div>
          </div>
        ))}
      </div>
    </ChartFrame>
  );
}

// ------------------------------------------------------------------------------------------------ years
export function YearsChart({ usual, ours, title, caption, ...names }: { usual: Side; ours: Side; title: string; caption: string } & Names) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const years = [...new Set([...usual.years, ...ours.years].map((y) => y.year))].sort();
  const get = (s: Side, yr: number) => s.years.find((r) => r.year === yr);
  const h = 220, top = 12, bottom = 26, left = 30;
  const plotW = w - left - 4, plotH = h - top - bottom;
  const band = plotW / years.length;
  const bw = Math.max(4, Math.min(26, (band - 10) / 2));
  const y = (v: number) => top + plotH * (1 - v / 100);
  const hv = hover != null ? years[hover] : null;

  return (
    <ChartFrame
      title={title}
      caption={caption}
      names={names}
      table={
        <table className="w-full min-w-[420px] border-collapse">
          <thead>
            <tr>
              <th className={th}>Year</th>
              <th className={clsx(th, "text-right")}>{names.usualName}: made money</th>
              <th className={clsx(th, "text-right")}>average</th>
              <th className={clsx(th, "text-right")}>{names.oursName}: made money</th>
              <th className={clsx(th, "text-right")}>average</th>
            </tr>
          </thead>
          <tbody>
            {years.map((yr) => {
              const a = get(usual, yr), b = get(ours, yr);
              return (
                <tr key={yr}>
                  <td className={td}>{yr}</td>
                  <td className={clsx(td, "text-right")}>{a ? `${pct(a.made_money_pct)} of ${count(a.trades)}` : "none"}</td>
                  <td className={clsx(td, "text-right")}>{a ? signed(a.avg_pct, 2) : ""}</td>
                  <td className={clsx(td, "text-right")}>{b ? `${pct(b.made_money_pct)} of ${count(b.trades)}` : "none"}</td>
                  <td className={clsx(td, "text-right")}>{b ? signed(b.avg_pct, 2) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      }
    >
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        <svg width={w} height={h} role="img" aria-label={`${title}, ${years[0]} to ${years[years.length - 1]}`} className="block">
          {[0, 25, 50, 75, 100].map((g) => (
            <g key={g}>
              <line x1={left} x2={w - 4} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeDasharray={g === 0 ? undefined : "2 3"} />
              <text x={left - 6} y={y(g) + 4} textAnchor="end" className="num" fontSize={10.5} fill="var(--muted-foreground)">
                {g}
              </text>
            </g>
          ))}
          {years.map((yr, i) => {
            const a = get(usual, yr), b = get(ours, yr);
            const cx = left + band * i + band / 2;
            return (
              <g key={yr} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} style={{ cursor: "pointer" }}>
                <rect x={left + band * i} y={top} width={band} height={plotH} fill="var(--foreground)" opacity={hover === i ? 0.05 : 0} />
                {a ? <rect x={cx - bw - 1} y={y(a.made_money_pct)} width={bw} height={y(0) - y(a.made_money_pct)} rx={3} fill={USUAL} /> : null}
                {b ? <rect x={cx + 1} y={y(b.made_money_pct)} width={bw} height={y(0) - y(b.made_money_pct)} rx={3} fill={OURS} /> : null}
                <text x={cx} y={h - 8} textAnchor="middle" className="num" fontSize={11} fill="var(--muted-foreground)">
                  {w < 420 ? `'${String(yr).slice(2)}` : yr}
                </text>
              </g>
            );
          })}
        </svg>
        {hv != null && hover != null ? (
          <div
            className="pointer-events-none absolute top-1 z-10 w-56 rounded-md border border-border bg-popover px-3 py-2 text-[12px] shadow-md"
            style={{ left: Math.min(Math.max(left + band * hover + band / 2 - 112, 0), w - 224) }}
          >
            <p className="num font-semibold text-foreground">{hv}</p>
            {([
              [names.usualName, get(usual, hv), USUAL],
              [names.oursName, get(ours, hv), OURS],
            ] as const).map(([n, r, c]) => (
              <p key={n} className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: c }} aria-hidden />
                <span className="text-foreground">{n}</span>
                {r ? (
                  <span className="num ml-auto text-foreground">
                    {pct(r.made_money_pct, 0)} · {signed(r.avg_pct)}
                  </span>
                ) : (
                  <span className="ml-auto">no trades</span>
                )}
              </p>
            ))}
            <p className="mt-1 text-[11px] text-muted-foreground">Made money · average trade</p>
          </div>
        ) : null}
      </div>
    </ChartFrame>
  );
}

// ------------------------------------------------------------------------------------------------ spread
export function SpreadChart({ usual, ours, title, caption, ...names }: { usual: Side; ours: Side; title: string; caption: string } & Names) {
  const max = Math.max(...usual.hist, ...ours.hist, 1);
  return (
    <ChartFrame
      title={title}
      caption={caption}
      names={names}
      table={
        <table className="w-full min-w-[360px] border-collapse">
          <thead>
            <tr>
              <th className={th}>Result after costs</th>
              <th className={clsx(th, "text-right")}>{names.usualName}</th>
              <th className={clsx(th, "text-right")}>{names.oursName}</th>
            </tr>
          </thead>
          <tbody>
            {HIST_LABELS.map((l, i) => (
              <tr key={l}>
                <td className={tdText}>{l}</td>
                <td className={clsx(td, "text-right")}>{pct(usual.hist[i])}</td>
                <td className={clsx(td, "text-right")}>{pct(ours.hist[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="flex flex-col gap-1">
        {HIST_LABELS.map((l, i) => (
          <div key={l} className="grid grid-cols-[112px_1fr] items-center gap-x-3 rounded-md px-1 py-0.5 hover:bg-foreground/[0.04] sm:grid-cols-[128px_1fr]">
            <span className={clsx("text-[12px]", i < 5 ? "text-loss" : "text-gain")}>
              {i < 5 ? "▼ " : "▲ "}
              {l}
            </span>
            <div className="flex flex-col gap-0.5 pr-10">
              {([
                [usual.hist[i], USUAL, names.usualName],
                [ours.hist[i], OURS, names.oursName],
              ] as const).map(([v, c, n]) => (
                <div key={n} className="relative h-3" title={`${n}: ${pct(v)} of trades`}>
                  <div className="absolute inset-y-0 left-0 rounded-[3px]" style={{ width: `${(v / max) * 100}%`, background: c }} />
                  <span className="num absolute top-1/2 -translate-y-1/2 text-[10.5px] text-muted-foreground" style={{ left: `calc(${(v / max) * 100}% + 4px)` }}>
                    {pct(v, 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ChartFrame>
  );
}

// ------------------------------------------------------------------------------------------------ example
export function ExampleChart({ example, title, caption, ...names }: { example: NonNullable<Example>; title: string; caption: string } & Names) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hx, setHx] = useState<number | null>(null);
  const [pick, setPick] = useState<{ side: "usual" | "ours"; i: number } | null>(null);
  const pts = example.closes;
  const idx = useMemo(() => new Map(pts.map(([d], i) => [d, i])), [pts]);
  const at = (d: string) => {
    const hit = idx.get(d);
    if (hit != null) return hit;
    const i = pts.findIndex(([x]) => x >= d);
    return i < 0 ? pts.length - 1 : i;
  };
  const laneH = 12, laneGap = 18;
  const h = 330, top = 14, bottom = 26 + 2 * laneGap + 8, left = 8, right = 54;
  const plotW = w - left - right, plotH = h - top - bottom;
  const closes = pts.map((p) => p[1]);
  const lo = Math.min(...closes), hi = Math.max(...closes);
  const pad = (hi - lo) * 0.08;
  const x = (i: number) => left + (plotW * i) / (pts.length - 1);
  const y = (v: number) => top + plotH * (1 - (v - lo + pad) / (hi - lo + 2 * pad));
  const path = pts.map(([, c], i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(c).toFixed(1)}`).join("");
  const ticks = [lo, (lo + hi) / 2, hi].map((v) => Math.round(v));
  const months = pts.map(([d], i) => [d, i] as const).filter(([d], i) => i === 0 || d.slice(5, 7) !== pts[i - 1][0].slice(5, 7));
  const every = w < 520 ? 4 : 2;
  const laneY = (side: "usual" | "ours") => top + plotH + 24 + (side === "usual" ? 0 : laneGap);
  const trades = (side: "usual" | "ours") => example[side];
  const chosen = pick ? trades(pick.side)[pick.i] : null;
  const color = (s: "usual" | "ours") => (s === "usual" ? USUAL : OURS);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const py = e.clientY - r.top;
    if (py > top + plotH) return setHx(null);
    const i = Math.round(((e.clientX - r.left - left) / plotW) * (pts.length - 1));
    setHx(i >= 0 && i < pts.length ? i : null);
  };

  return (
    <ChartFrame
      title={title}
      caption={caption}
      names={names}
      table={
        <table className="w-full min-w-[420px] border-collapse">
          <thead>
            <tr>
              <th className={th}>Version</th>
              <th className={th}>Signal</th>
              <th className={th}>Exit</th>
              <th className={clsx(th, "text-right")}>Result after costs</th>
            </tr>
          </thead>
          <tbody>
            {(["usual", "ours"] as const).flatMap((s) =>
              trades(s).map((t) => (
                <tr key={`${s}${t.signal}`}>
                  <td className={tdText}>{s === "usual" ? names.usualName : names.oursName}</td>
                  <td className={td}>{shortDate(t.signal)}</td>
                  <td className={td}>{shortDate(t.exit)}</td>
                  <td className={clsx(td, "text-right", t.result_pct >= 0 ? "text-gain" : "text-loss")}>{signed(t.result_pct)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      }
    >
      <div ref={ref} className="relative">
        <svg
          width={w}
          height={h}
          role="img"
          aria-label={`${example.symbol} daily closes with each version's trades`}
          className="block"
          onMouseMove={onMove}
          onMouseLeave={() => setHx(null)}
        >
          {ticks.map((t, k) => (
            <g key={k}>
              <line x1={left} x2={w - right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray="2 3" />
              <text x={w - right + 6} y={y(t) + 4} className="num" fontSize={10.5} fill="var(--muted-foreground)">
                {t.toLocaleString("en-IN")}
              </text>
            </g>
          ))}
          {months.map(([d, i], k) =>
            k % every === 0 ? (
              <text key={d} x={Math.min(Math.max(x(i), 16), w - right - 16)} y={top + plotH + 14} textAnchor="middle" fontSize={10.5} fill="var(--muted-foreground)">
                {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" })}
              </text>
            ) : null,
          )}
          {(["usual", "ours"] as const).map((s) =>
            trades(s).map((t, i) => {
              const a = at(t.signal), b = at(t.exit);
              const on = pick?.side === s && pick.i === i;
              return on ? (
                <rect key={`band${s}${i}`} x={x(a)} y={top} width={Math.max(x(b) - x(a), 2)} height={plotH} fill={color(s)} opacity={0.12} />
              ) : null;
            }),
          )}
          <path d={path} fill="none" stroke="var(--foreground)" strokeWidth={1.5} strokeLinejoin="round" />
          {(["usual", "ours"] as const).map((s) =>
            trades(s).map((t, i) => {
              const a = at(t.signal);
              const py = y(pts[a][1]) + (s === "usual" ? 8 : 20);
              return (
                <path key={`m${s}${i}`} d={`M${x(a)},${py} l5,9 h-10 z`} fill={color(s)} stroke="var(--card)" strokeWidth={1.5} pointerEvents="none" />
              );
            }),
          )}
          {(["usual", "ours"] as const).map((s) => (
            <g key={s}>
              <line x1={left} x2={w - right} y1={laneY(s) + laneH / 2} y2={laneY(s) + laneH / 2} stroke="var(--border)" />
              <text x={w - right + 6} y={laneY(s) + laneH - 2} fontSize={10} fill="var(--muted-foreground)">
                {s === "usual" ? "Usual" : "Ours"}
              </text>
              {trades(s).map((t, i) => {
                const a = at(t.signal), b = at(t.exit);
                const on = pick?.side === s && pick.i === i;
                return (
                  <rect
                    key={`${s}${i}`}
                    x={x(a)}
                    y={laneY(s)}
                    width={Math.max(x(b) - x(a), 8)}
                    height={laneH}
                    rx={4}
                    fill={color(s)}
                    stroke={on ? "var(--foreground)" : "var(--card)"}
                    strokeWidth={on ? 1.5 : 2}
                    style={{ cursor: "pointer" }}
                    onClick={() => setPick(on ? null : { side: s, i })}
                    onMouseEnter={() => setPick({ side: s, i })}
                  >
                    <title>{`${s === "usual" ? names.usualName : names.oursName}: ${shortDate(t.signal)} to ${shortDate(t.exit)}, ${signed(t.result_pct)}`}</title>
                  </rect>
                );
              })}
            </g>
          ))}
          {hx != null ? (
            <g pointerEvents="none">
              <line x1={x(hx)} x2={x(hx)} y1={top} y2={top + plotH} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
              <circle cx={x(hx)} cy={y(pts[hx][1])} r={4} fill="var(--foreground)" stroke="var(--card)" strokeWidth={2} />
            </g>
          ) : null}
        </svg>
        {hx != null ? (
          <div
            className="pointer-events-none absolute top-1 rounded-md border border-border bg-popover px-2.5 py-1.5 text-[12px] shadow-md"
            style={{ left: Math.min(Math.max(x(hx) - 60, 0), w - 132) }}
          >
            <p className="num text-muted-foreground">{shortDate(pts[hx][0])}</p>
            <p className="num font-medium text-foreground">₹{pts[hx][1].toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
          </div>
        ) : null}
      </div>
      <p className="mt-2 min-h-[20px] text-[12.5px] text-muted-foreground" aria-live="polite">
        {chosen && pick ? (
          <>
            <span className="font-medium text-foreground">{pick.side === "usual" ? names.usualName : names.oursName}:</span> signal{" "}
            <span className="num">{shortDate(chosen.signal)}</span>, out <span className="num">{shortDate(chosen.exit)}</span>,{" "}
            <span className={clsx("num font-medium", chosen.result_pct >= 0 ? "text-gain" : "text-loss")}>{signed(chosen.result_pct)}</span> after costs.
          </>
        ) : (
          "Tap or hover a trade bar under the chart to see how it ended. The triangles mark each signal day."
        )}
      </p>
    </ChartFrame>
  );
}
