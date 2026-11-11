"use client";

import { useRef } from "react";
import clsx from "clsx";

/**
 * A card that tilts toward the pointer in 3D, with a soft highlight under it (landing page only, ADR-054). Mouse and
 * pen only (touch scrolls as usual); nothing with "reduce motion". The transform is written straight to the element,
 * so moving the pointer does not re-render React.
 */
export function Tilt({ children, className, max = 6 }: { children: React.ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const off = () => typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <div
      ref={ref}
      className={clsx("tilt", className)}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el || e.pointerType === "touch" || off()) return;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        el.style.setProperty("--tx", `${((0.5 - y) * 2 * max).toFixed(2)}deg`);
        el.style.setProperty("--ty", `${((x - 0.5) * 2 * max).toFixed(2)}deg`);
        el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
        el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
        el.dataset.on = "true";
      }}
      onPointerLeave={() => {
        const el = ref.current;
        if (!el) return;
        el.style.setProperty("--tx", "0deg");
        el.style.setProperty("--ty", "0deg");
        el.dataset.on = "false";
      }}
    >
      {children}
    </div>
  );
}
