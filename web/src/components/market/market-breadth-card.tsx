import Link from "next/link";
import { ArrowUpRightIcon, TrendDownIcon, TrendUpIcon } from "@phosphor-icons/react/ssr";
import { Delta } from "@/components/ui/data";
import { Panel } from "@/components/ui/layout";
import { date, price } from "@/lib/format";
import type { Quote } from "@/lib/types";

export interface MarketBreadthData {
  up: number;
  down: number;
  total: number;
  leaders: Quote[];
  laggards: Quote[];
  asOf: string | null;
}

export function MarketBreadthCard({ breadth }: { breadth: MarketBreadthData }) {
  const { up, down, total, leaders, laggards, asOf } = breadth;
  const validTotal = up + down;
  const upPct = validTotal > 0 ? (up / validTotal) * 100 : 50;
  const downPct = validTotal > 0 ? (down / validTotal) * 100 : 50;
  const ratio = down > 0 ? (up / down).toFixed(2) : "—";

  const sentiment =
    upPct >= 58
      ? { label: "Broad Advance", tone: "gain" as const, glyph: "▲" }
      : downPct >= 58
        ? { label: "Risk-Off Drag", tone: "loss" as const, glyph: "▼" }
        : { label: "Consolidating / Neutral", tone: "neutral" as const, glyph: "⚖" };

  return (
    <Panel
      title="Market Breadth & Movers"
      meta={asOf ? `NSE Cash Market · ${date(asOf)}` : "NSE Cash Market"}
      actions={
        <Link
          href="/app/markets"
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          View all {total > 0 ? total.toLocaleString("en-IN") : ""} listings <ArrowUpRightIcon size={12} aria-hidden />
        </Link>
      }
    >
      <div className="flex flex-col gap-5">
        {/* Breadth Ratio & Sentiment Bar */}
        <div className="rounded-lg border border-border bg-card/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
            <div className="flex items-center gap-3">
              <span className="eyebrow">Advance / Decline Ratio</span>
              <span className="num text-[14px] font-semibold text-foreground">
                {ratio}
                <span className="text-[11px] font-normal text-muted-foreground ml-1">(A/D)</span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium uppercase ${
                  sentiment.tone === "gain"
                    ? "bg-gain-soft text-gain"
                    : sentiment.tone === "loss"
                      ? "bg-loss-soft text-loss"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                <span aria-hidden>{sentiment.glyph}</span>
                <span>{sentiment.label}</span>
              </span>
            </div>
          </div>

          {/* Dual-Color Breadth Ratio Bar */}
          <div className="space-y-1.5">
            <div
              className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/60"
              role="progressbar"
              aria-label={`Market breadth: ${up} advancing, ${down} declining`}
              aria-valuenow={Math.round(upPct)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                style={{ width: `${upPct}%` }}
                className="bg-gain transition-all duration-500 ease-out"
                title={`${up.toLocaleString("en-IN")} Advancing (${upPct.toFixed(1)}%)`}
              />
              <div
                style={{ width: `${downPct}%` }}
                className="bg-loss transition-all duration-500 ease-out"
                title={`${down.toLocaleString("en-IN")} Declining (${downPct.toFixed(1)}%)`}
              />
            </div>

            <div className="flex justify-between text-[11.5px]">
              <span className="num font-medium text-gain flex items-center gap-1">
                <TrendUpIcon size={13} aria-hidden />
                {up.toLocaleString("en-IN")} Advancing ({upPct.toFixed(0)}%)
              </span>
              <span className="num font-medium text-loss flex items-center gap-1">
                <TrendDownIcon size={13} aria-hidden />
                {down.toLocaleString("en-IN")} Declining ({downPct.toFixed(0)}%)
              </span>
            </div>
          </div>
        </div>

        {/* Top Movers (NSE 500 Leaders & Laggards) */}
        {(leaders.length > 0 || laggards.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {/* Leaders */}
            <div className="rounded-lg border border-border p-3.5 bg-card">
              <div className="flex items-center justify-between pb-2 border-b border-border/70">
                <div className="flex items-center gap-1.5 text-gain">
                  <TrendUpIcon size={14} aria-hidden />
                  <span className="eyebrow text-gain font-semibold">NSE 500 Gainers</span>
                </div>
                <span className="eyebrow text-[10.5px]">Last session</span>
              </div>
              <ul className="flex flex-col divide-y divide-border/60">
                {leaders.map((q) => (
                  <li key={q.symbol}>
                    <Link
                      href={`/app/markets/${encodeURIComponent(q.symbol)}`}
                      className="group flex items-center justify-between py-2 text-left transition-colors hover:bg-foreground/[0.03] px-1 rounded"
                    >
                      <div className="min-w-0 pr-2">
                        <span className="num block text-[13px] font-medium text-foreground group-hover:underline">
                          {q.symbol}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground max-w-[150px] sm:max-w-[200px]">
                          {q.name}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="num block text-[12.5px] font-medium text-foreground">
                          {price(q.last_price)}
                        </span>
                        <Delta value={q.change_pct} className="text-[11.5px]" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Laggards */}
            <div className="rounded-lg border border-border p-3.5 bg-card">
              <div className="flex items-center justify-between pb-2 border-b border-border/70">
                <div className="flex items-center gap-1.5 text-loss">
                  <TrendDownIcon size={14} aria-hidden />
                  <span className="eyebrow text-loss font-semibold">NSE 500 Losers</span>
                </div>
                <span className="eyebrow text-[10.5px]">Last session</span>
              </div>
              <ul className="flex flex-col divide-y divide-border/60">
                {laggards.map((q) => (
                  <li key={q.symbol}>
                    <Link
                      href={`/app/markets/${encodeURIComponent(q.symbol)}`}
                      className="group flex items-center justify-between py-2 text-left transition-colors hover:bg-foreground/[0.03] px-1 rounded"
                    >
                      <div className="min-w-0 pr-2">
                        <span className="num block text-[13px] font-medium text-foreground group-hover:underline">
                          {q.symbol}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground max-w-[150px] sm:max-w-[200px]">
                          {q.name}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="num block text-[12.5px] font-medium text-foreground">
                          {price(q.last_price)}
                        </span>
                        <Delta value={q.change_pct} className="text-[11.5px]" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
