import clsx from "clsx";
import type { ReactNode } from "react";
import { pct, signed } from "@/lib/format";

/**
 * Gain/loss is never color-only: sign + glyph + color (design-system rule).
 */
export function Delta({
  value,
  kind = "pct",
  className,
  showGlyph = true,
}: {
  value: number | null | undefined;
  kind?: "pct" | "abs";
  className?: string;
  showGlyph?: boolean;
}) {
  if (value == null || Number.isNaN(value)) return <span className={clsx("num text-muted-foreground", className)}>—</span>;
  const dir = value > 0 ? "up" : value < 0 ? "down" : "flat";
  return (
    <span
      className={clsx(
        "num inline-flex items-center gap-1 whitespace-nowrap",
        dir === "up" && "text-gain",
        dir === "down" && "text-loss",
        dir === "flat" && "text-muted-foreground",
        className,
      )}
    >
      {showGlyph && dir !== "flat" ? (
        <span aria-hidden className="text-[0.7em] leading-none">
          {dir === "up" ? "▲" : "▼"}
        </span>
      ) : null}
      {kind === "pct" ? pct(value) : signed(value)}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "gain" | "loss" | "coral" | "ink";
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[4px] px-1.5 text-[11px] font-medium tracking-wide",
        tone === "neutral" && "bg-foreground/[0.06] text-foreground/75",
        tone === "gain" && "bg-gain-soft text-gain",
        tone === "loss" && "bg-loss-soft text-loss",
        tone === "coral" && "bg-coral/15 text-coral-ink",
        tone === "ink" && "bg-primary text-primary-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex min-w-0 flex-col gap-1", className)}>
      <span className="eyebrow">{label}</span>
      <span className="num truncate text-[22px] leading-7 text-foreground">{value}</span>
      {sub ? <span className="text-[12px] text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

/** Inline SVG sparkline. Ink stroke; the end dot carries direction. */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length < 2) return <span className={clsx("inline-block", className)} style={{ width, height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" className="text-foreground/70" />
      <circle cx={lx} cy={ly} r={2.5} className={up ? "fill-gain" : "fill-loss"} />
    </svg>
  );
}

/** Position of the last price inside the 52-week range. */
export function RangeBar({ low, high, value }: { low: number | null; high: number | null; value: number | null }) {
  if (low == null || high == null || value == null || high <= low) return <span className="text-muted-foreground">—</span>;
  const pos = Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100));
  return (
    <span role="img" className="relative block h-1 w-full rounded-full bg-foreground/10" aria-label={`${pos.toFixed(0)}% of 52-week range`}>
      <span className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground" style={{ left: `${pos}%` }} />
    </span>
  );
}

/**
 * Diverging bar for a −100…+100 score: neutral midpoint, gain/loss hues,
 * and the number printed beside it (never color-only).
 */
export function ScoreBar({ score, width = 120, showValue = true }: { score: number; width?: number; showValue?: boolean }) {
  const pct = Math.min(100, Math.abs(score)) / 2; // half-width each side
  return (
    <span role="img" className="inline-flex items-center gap-2" aria-label={`Score ${score > 0 ? "+" : ""}${Math.round(score)} of ±100`}>
      <span className="relative block h-2 rounded-full bg-foreground/[0.07]" style={{ width }}>
        <span className="absolute inset-y-[-2px] left-1/2 w-px bg-foreground/30" aria-hidden />
        <span
          className={clsx("absolute inset-y-0 rounded-full", score >= 0 ? "bg-gain" : "bg-loss")}
          style={score >= 0 ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }}
          aria-hidden
        />
      </span>
      {showValue ? (
        <span className={clsx("num w-11 text-right text-[12px]", score > 0 ? "text-gain" : score < 0 ? "text-loss" : "text-muted-foreground")}>
          {score > 0 ? "+" : score < 0 ? "−" : ""}
          {Math.abs(score).toFixed(0)}
        </span>
      ) : null}
    </span>
  );
}

export function StanceBadge({ stance }: { stance: "constructive" | "neutral" | "cautious" | string }) {
  return (
    <Badge tone={stance === "constructive" ? "gain" : stance === "cautious" ? "loss" : "neutral"} className="capitalize">
      {stance === "constructive" ? "▲ " : stance === "cautious" ? "▼ " : "■ "}
      {stance}
    </Badge>
  );
}

export function ToneBadge({ label, terms }: { label: string | null; terms?: string[] }) {
  if (!label) return null;
  const title = terms?.length ? `Matched: ${terms.join(", ")}` : "No tone words matched";
  return (
    <span title={title}>
      <Badge tone={label === "positive" ? "gain" : label === "negative" ? "loss" : "neutral"}>
        {label === "positive" ? "+ positive" : label === "negative" ? "− negative" : "neutral"}
      </Badge>
    </span>
  );
}
