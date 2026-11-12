"use client";

import { useRef, useState } from "react";
import "./signal-anatomy.css";

/**
 * The home hero's visual (ADR-056): the parts of one signal on a price chart — the turn the rule reads, the signal,
 * its safety stop and the 60-session plan — drawn in on load, with a scrubber you can drag (or move with the arrow
 * keys) to read any day. The prices are an ILLUSTRATION (a fixed made-up series), and the caption says so: never a
 * real trade, never a recommendation. Motion is transform / stroke only, so text keeps full contrast at every frame;
 * nothing moves with "reduce motion".
 */

const N = 150; // sessions shown
const SIGNAL = 74; // the session the rule fires on
const PLAN = 60; // sessions the plan holds at most

// a deterministic made-up series: a long slide, a flat base, a turn up, a climb with pullbacks
function series(): number[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const out: number[] = [];
  let p = 100;
  for (let i = 0; i < N; i++) {
    const drift = i < 52 ? -0.85 : i < 70 ? 0.02 : i < 118 ? 0.62 : i < 128 ? -0.5 : 0.45;
    p = Math.max(40, p + drift + rnd() * 1.6);
    out.push(Math.round(p * 100) / 100);
  }
  return out;
}

const CLOSES = series();

const W = 560;
const H = 300;
const PAD = { l: 12, r: 64, t: 18, b: 26 };

export function SignalAnatomy() {
  const closes = CLOSES;
  const lo = Math.min(...closes) - 6;
  const hi = Math.max(...closes) + 4;
  const x = (i: number) => PAD.l + (i / (N - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);

  const entry = closes[SIGNAL];
  const baseLow = Math.min(...closes.slice(SIGNAL - 20, SIGNAL + 1));
  const stop = Math.round(baseLow * 0.97 * 100) / 100;
  const exitAt = Math.min(N - 1, SIGNAL + PLAN);
  const exit = closes[exitAt];
  const line = closes.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  const [at, setAt] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pick = (clientX: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const fx = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((fx - PAD.l) / (W - PAD.l - PAD.r)) * (N - 1));
    setAt(Math.max(0, Math.min(N - 1, i)));
  };
  const shown = at ?? exitAt;
  const rupee = (v: number) => `₹${v.toFixed(2)}`;
  const change = (v: number, base: number) => {
    const p = ((v - base) / base) * 100;
    return `${p >= 0 ? "▲ +" : "▼ −"}${Math.abs(p).toFixed(1)}%`;
  };

  return (
    <figure className="sa panel relative overflow-hidden p-4 md:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">Anatomy of a signal</p>
        <p className="num text-[11.5px] text-muted-foreground" aria-live="polite">
          Day {shown + 1} · {rupee(closes[shown])}
          {shown > SIGNAL ? <span className={closes[shown] >= entry ? "text-gain" : "text-loss"}> {change(closes[shown], entry)} from the signal</span> : null}
        </p>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 w-full touch-pan-y select-none rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        role="slider"
        tabIndex={0}
        aria-label="Illustrative price chart; move to read a day"
        aria-valuemin={1}
        aria-valuemax={N}
        aria-valuenow={shown + 1}
        aria-valuetext={`Day ${shown + 1}, ${rupee(closes[shown])}`}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setAt(null)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          setAt((a) => Math.max(0, Math.min(N - 1, (a ?? exitAt) + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 10 : 1))));
        }}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + f * (H - PAD.t - PAD.b)} y2={PAD.t + f * (H - PAD.t - PAD.b)} className="stroke-border" strokeDasharray="2 5" />
        ))}

        {/* the plan: from the signal to the 60th session at most */}
        <g className="sa-plan" style={{ transformOrigin: `${x(SIGNAL)}px 0` }}>
          <rect x={x(SIGNAL)} y={PAD.t} width={x(exitAt) - x(SIGNAL)} height={H - PAD.t - PAD.b} className="fill-foreground/[0.045]" />
          <line x1={x(exitAt)} x2={x(exitAt)} y1={PAD.t} y2={H - PAD.b} className="stroke-foreground/30" strokeDasharray="3 3" />
        </g>

        {/* the safety stop under the base */}
        <line x1={x(SIGNAL)} x2={x(exitAt)} y1={y(stop)} y2={y(stop)} className="sa-stop stroke-loss" strokeWidth="1.5" strokeDasharray="5 4" pathLength={1} />

        {/* the price */}
        <path d={line} fill="none" className="sa-line stroke-foreground" strokeWidth="1.8" strokeLinejoin="round" pathLength={1} />

        {/* the signal */}
        <g className="sa-pop" style={{ transformOrigin: `${x(SIGNAL)}px ${y(entry)}px` }}>
          <circle cx={x(SIGNAL)} cy={y(entry)} r="10" className="fill-coral/20" />
          <circle cx={x(SIGNAL)} cy={y(entry)} r="4.5" className="fill-coral stroke-card" strokeWidth="2" />
        </g>

        {/* right-edge labels, in ink */}
        <g className="num fill-muted-foreground text-[10.5px]">
          <text x={W - PAD.r + 6} y={y(exit) + 4}>{rupee(exit)}</text>
          <text x={W - PAD.r + 6} y={y(stop) + 4} className="fill-loss">
            stop
          </text>
          <text x={x(SIGNAL) + 8} y={y(entry) + 22} className="fill-foreground">
            signal {rupee(entry)}
          </text>
          <text x={x(SIGNAL) + 4} y={H - 8}>
            day {SIGNAL + 1}
          </text>
          <text x={x(exitAt) - 4} y={H - 8} textAnchor="end">
            +{PLAN} sessions
          </text>
        </g>

        {/* the scrubber */}
        {at !== null ? (
          <g pointerEvents="none">
            <line x1={x(at)} x2={x(at)} y1={PAD.t} y2={H - PAD.b} className="stroke-foreground/40" />
            <circle cx={x(at)} cy={y(closes[at])} r="4" className="fill-card stroke-foreground" strokeWidth="1.5" />
          </g>
        ) : null}
      </svg>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 sm:grid-cols-[auto_auto_1fr_auto]">
        {(
          [
            ["Rule", "Secular trend"],
            ["Signal", rupee(entry)],
            ["Safety stop", `${rupee(stop)} · ${change(stop, entry)}`],
            ["Plan", `Up to ${PLAN} sessions`],
          ] as const
        ).map(([k, v], i) => (
          <div key={k} className="sa-rise" style={{ "--d": `${1100 + i * 70}ms` } as React.CSSProperties}>
            <dt className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">{k}</dt>
            <dd className="num mt-1 whitespace-nowrap text-[13px]">{v}</dd>
          </div>
        ))}
      </dl>
      <figcaption className="mt-3 text-[11.5px] leading-5 text-muted-foreground">
        Illustration with made-up prices, to show the parts every signal comes with. Not a real trade and not a recommendation.
      </figcaption>
    </figure>
  );
}
