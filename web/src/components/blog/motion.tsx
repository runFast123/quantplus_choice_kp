"use client";

// Entrance motion for the research notes: a figure that arms its marks below the fold and plays them once in view,
// and a number that counts up. Both render the final state on the server and for reduced motion.
import "./chart-motion.css";
import { useEffect, useMemo, useState } from "react";
import { useInView } from "@/components/blog/use-in-view";

/** A <figure> whose marks (cm-* classes inside) animate in the first time it scrolls into view. */
export function MotionFigure({ className, children }: { className?: string; children: React.ReactNode }) {
  const [ref, phase] = useInView<HTMLElement>();
  return (
    <figure ref={ref} className={className} data-motion={phase === "static" ? undefined : phase}>
      {children}
    </figure>
  );
}

const COUNT_MS = 800;
/** The curve of cubic-bezier(0.16, 1, 0.3, 1), the charts' ease-out. */
const easeOut = (f: number) => (f >= 1 ? 1 : 1 - 2 ** (-10 * f));

/** "▲ 5.6%" → prefix "▲ ", 5.6 with 1 decimal, suffix "%". Null when there is nothing to count. */
function split(text: string) {
  const m = text.match(/^([^\d]*)(\d[\d,]*(?:\.(\d+))?)(.*)$/);
  if (!m) return null;
  const n = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(n) || n === 0) return null;
  const dec = m[3]?.length ?? 0;
  const commas = m[2].includes(",");
  const show = (v: number) =>
    `${m[1]}${commas ? v.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec)}${m[4]}`;
  return { n, show };
}

/**
 * A number that counts up from zero the first time it scrolls into view. The final text is always in the DOM for
 * screen readers and crawlers (sr-only while moving); the moving digits are an aria-hidden copy laid over an invisible
 * sizer, so the layout never jumps. Colour never changes, so contrast holds at every frame.
 */
export function CountUp({ text, delay = 0 }: { text: string; delay?: number }) {
  const [ref, phase] = useInView<HTMLSpanElement>(0.6);
  const parts = useMemo(() => split(text), [text]);
  const [v, setV] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (phase !== "play" || !parts) return;
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (now: number) => {
      const f = Math.max((now - t0) / COUNT_MS, 0);
      if (f >= 1) return setDone(true);
      setV(parts.n * easeOut(f));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, parts, delay]);

  const moving = parts != null && (phase === "armed" || (phase === "play" && !done));
  return (
    <span ref={ref} className={moving ? "relative inline-block" : undefined}>
      {moving ? (
        <>
          <span className="sr-only">{text}</span>
          <span aria-hidden className="invisible">
            {text}
          </span>
          <span aria-hidden className="absolute inset-0">
            {parts.show(v)}
          </span>
        </>
      ) : (
        text
      )}
    </span>
  );
}
