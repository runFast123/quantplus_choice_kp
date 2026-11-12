"use client";

import { useEffect, useRef, useState } from "react";

/**
 * static: the final drawing (the server HTML, reduced motion, no IntersectionObserver, or already on screen when the
 *         page hydrated, so nothing visible ever blinks out).
 * armed:  still below the fold after hydration; marks wait at their start (chart-motion.css).
 * play:   scrolled into view; marks animate in, once.
 */
export type MotionPhase = "static" | "armed" | "play";

/** Watches one element and moves static → armed → play the first time `threshold` of it is in view. */
export function useInView<T extends Element>(threshold = 0.3) {
  const ref = useRef<T>(null);
  const [phase, setPhase] = useState<MotionPhase>("static");

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let first = true;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        if (first) {
          first = false;
          // on screen at hydration: keep the final drawing rather than hide something the reader can see
          if (e.isIntersecting) return io.disconnect();
          setPhase("armed");
          return;
        }
        // a chart taller than the viewport can never reach the ratio; count the share of the screen it fills instead
        const seen =
          e.isIntersecting && (e.intersectionRatio >= threshold || e.intersectionRect.height >= window.innerHeight * threshold);
        if (seen) {
          setPhase("play");
          io.disconnect();
        }
      },
      { threshold: [...new Set([0, 0.1, 0.2, threshold])].sort((a, b) => a - b) },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  return [ref, phase] as const;
}
