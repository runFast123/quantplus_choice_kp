// Inline timing for a chart mark's entrance (read by chart-motion.css). Plain module, so server components such as
// RuleDiagram can use it too. Inert until the chart is armed: the server HTML is always the final drawing.
import type { CSSProperties } from "react";

/** Delay (and optionally duration) in ms for one mark, merged into its existing style. */
export function cm(delayMs: number, style?: CSSProperties, durMs?: number): CSSProperties {
  return {
    ...style,
    "--cm-delay": `${Math.round(delayMs)}ms`,
    ...(durMs != null ? { "--cm-dur": `${Math.round(durMs)}ms` } : {}),
  } as CSSProperties;
}
