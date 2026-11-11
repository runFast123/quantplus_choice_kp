"use client";

import { useEffect, useRef } from "react";

/**
 * The landing hero's 3D scene (ADR-054): a signal chart on a tilted stage with smaller cards floating in front of it at
 * different depths. The stage leans toward the pointer and flattens as the hero scrolls away. CSS 3D only (no library):
 * the pointer and scroll set two CSS variables on the rig, and globals.css (.hero-*) does the rest. With "reduce
 * motion" it stays still at a fixed angle. Prices and names are illustrative, as the caption says.
 */
const CANDLES: [number, number, number, number][] = [
  // open, high, low, close (a dip, then a turn up; the coral mark is the rule's buy)
  [62, 66, 58, 60], [60, 63, 55, 57], [57, 60, 52, 54], [54, 57, 49, 51], [51, 55, 48, 53], [53, 56, 50, 52],
  [52, 58, 51, 57], [57, 61, 55, 60], [60, 63, 57, 59], [59, 65, 58, 64], [64, 68, 62, 67], [67, 70, 64, 66],
  [66, 72, 65, 71], [71, 75, 69, 74], [74, 77, 71, 72], [72, 78, 71, 77], [77, 82, 75, 81], [81, 84, 78, 83],
];

function Chart() {
  const W = 320;
  const H = 130;
  const lo = 45;
  const hi = 86;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const step = W / CANDLES.length;
  const sma = CANDLES.map((_, i) => {
    const w = CANDLES.slice(Math.max(0, i - 4), i + 1);
    return w.reduce((a, c) => a + c[3], 0) / w.length;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-hidden>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className="stroke-border" strokeDasharray="2 4" />
      ))}
      {CANDLES.map(([o, h, l, c], i) => {
        const x = i * step + step / 2;
        const up = c >= o;
        return (
          <g key={i} className={up ? "text-gain" : "text-loss"}>
            <line x1={x} x2={x} y1={y(h)} y2={y(l)} stroke="currentColor" strokeWidth="1" />
            <rect x={x - step * 0.3} width={step * 0.6} y={y(Math.max(o, c))} height={Math.max(1.5, Math.abs(y(o) - y(c)))} rx="1" fill="currentColor" />
          </g>
        );
      })}
      <path
        d={sma.map((v, i) => `${i ? "L" : "M"}${(i * step + step / 2).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")}
        fill="none"
        className="stroke-foreground"
        strokeWidth="1.4"
        strokeDasharray="4 3"
      />
      <circle cx={6 * step + step / 2} cy={y(57) - 10} r="4.5" className="fill-coral" />
    </svg>
  );
}

export function HeroScene() {
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (still.matches) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    let raf = 0;
    let px = 0;
    let py = 0;
    const apply = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      // 0 while the stage is in full view, 1 once it has scrolled away
      const sp = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height)));
      el.style.setProperty("--px", px.toFixed(3));
      el.style.setProperty("--py", py.toFixed(3));
      el.style.setProperty("--sp", sp.toFixed(3));
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      px = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      py = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
      queue();
    };
    const onLeave = () => {
      px = 0;
      py = 0;
      queue();
    };
    const host = el.closest("section") ?? el;
    if (fine) {
      host.addEventListener("pointermove", onMove as EventListener);
      host.addEventListener("pointerleave", onLeave);
    }
    window.addEventListener("scroll", queue, { passive: true });
    queue();
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener("pointermove", onMove as EventListener);
      host.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", queue);
    };
  }, []);

  return (
    <figure className="relative self-center">
      <div ref={stage} className="hero-stage">
        <div className="hero-rig">
          <div className="hero-shadow" aria-hidden />

          {/* the base plane: the chart */}
          <div className="hero-layer" style={{ "--z": "0px" } as React.CSSProperties}>
            <div className="panel p-5 md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="eyebrow">Signal · specimen</p>
                  <p className="num mt-2 text-[22px] font-medium">HDFCBANK</p>
                  <p className="text-[12.5px] text-muted-foreground">HDFC Bank · Banking</p>
                </div>
                <span className="rounded-[4px] bg-gain-soft px-2 py-1 text-[11px] font-semibold tracking-wide text-gain">BUY</span>
              </div>
              <div className="mt-4">
                <Chart />
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4 text-[12px]">
                <div>
                  <dt className="eyebrow">Rule</dt>
                  <dd className="mt-1">SMA 20/50 trend</dd>
                </div>
                <div>
                  <dt className="eyebrow">Fired at</dt>
                  <dd className="num mt-1">₹1,642.30</dd>
                </div>
                <div>
                  <dt className="eyebrow">Stop / review</dt>
                  <dd className="num mt-1">1,527 · 60 days</dd>
                </div>
              </dl>
            </div>
          </div>

          {/* floating cards, nearer the eye */}
          <div className="hero-layer hero-float-a absolute -left-6 -top-7 hidden sm:block" style={{ "--z": "70px" } as React.CSSProperties} aria-hidden>
            <div className="panel flex items-center gap-2 px-3 py-2 text-[12px] shadow-pop">
              <span className="size-2 rounded-full bg-gain" />
              <span className="font-medium">Buy · SMA 20/50 trend</span>
            </div>
          </div>
          <div className="hero-layer hero-float-b absolute -right-5 top-16 hidden w-44 sm:block" style={{ "--z": "110px" } as React.CSSProperties} aria-hidden>
            <div className="panel p-3 text-[11.5px] shadow-pop">
              <p className="eyebrow">Market Radar</p>
              {(
                [
                  ["TCS", "▲ +0.84%", true],
                  ["LT", "▲ +1.92%", true],
                  ["ITC", "▼ −0.31%", false],
                ] as const
              ).map(([s, c, up]) => (
                <p key={s} className="num mt-1.5 flex justify-between">
                  <span className="font-medium">{s}</span>
                  <span className={up ? "text-gain" : "text-loss"}>{c}</span>
                </p>
              ))}
            </div>
          </div>
          <div className="hero-layer hero-float-c absolute -bottom-6 left-10 hidden sm:block" style={{ "--z": "90px" } as React.CSSProperties} aria-hidden>
            <div className="panel px-3 py-2 text-[11.5px] shadow-pop">
              <span className="text-muted-foreground">Safety stop</span> <span className="num font-medium text-loss">▼ ₹1,527.00</span>
            </div>
          </div>
          <div className="hero-layer hero-float-a absolute -bottom-4 -right-3 hidden md:block" style={{ "--z": "140px" } as React.CSSProperties} aria-hidden>
            <div className="panel px-3 py-2 text-[11.5px] shadow-pop">
              <span className="text-muted-foreground">Rule health</span> <span className="font-medium">within its normal range</span>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-8 flex items-start gap-3 pl-2 text-[12.5px] leading-5 text-muted-foreground">
        <span className="mt-2 h-px w-8 shrink-0 bg-coral" aria-hidden />
        Illustrative. The coral mark is where the 20-day average turned above the 50-day — the rule&apos;s signal, visible on the chart.
      </figcaption>
    </figure>
  );
}
