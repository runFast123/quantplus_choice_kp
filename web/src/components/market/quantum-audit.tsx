"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  CaretDownIcon,
  CaretUpIcon,
  CrosshairIcon,
  TrendUpIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { Delta } from "@/components/ui/data";
import { price } from "@/lib/format";
import {
  auditStockSentiment,
  type ExitLogEntry,
  type QuantumAuditItem,
} from "@/lib/trade-plan";

export interface QuantumAuditStockInput {
  symbol: string;
  name?: string;
  entryBase: number;
  entryDate?: string | null;
  lastPrice: number;
  rsi?: number | null;
  stop?: number | null;
  quantity?: number | null;
  source?: "holding" | "radar";
  exitLogs?: ExitLogEntry[];
}

export interface QuantumAuditProps {
  stocks: QuantumAuditStockInput[];
  defaultSource?: "holding" | "radar" | "all";
}

export function QuantumAudit({
  stocks,
  defaultSource = "all",
}: QuantumAuditProps) {
  const [sourceFilter, setSourceFilter] = useState<"holding" | "radar" | "all">(
    defaultSource,
  );
  const [nodeFilter, setNodeFilter] = useState<string>("all");
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);

  // Run quantitative audit calculations across all provided stocks
  const auditedItems: QuantumAuditItem[] = useMemo(() => {
    return stocks.map((s) =>
      auditStockSentiment({
        symbol: s.symbol,
        entryBase: s.entryBase,
        entryDate: s.entryDate,
        lastPrice: s.lastPrice,
        rsi: s.rsi,
        stop: s.stop,
        source: s.source,
        exitLogs: s.exitLogs,
      }),
    );
  }, [stocks]);

  // Counts by source
  const holdingCount = useMemo(
    () => auditedItems.filter((i) => i.source === "holding").length,
    [auditedItems],
  );
  const radarCount = useMemo(
    () => auditedItems.filter((i) => i.source === "radar").length,
    [auditedItems],
  );

  // Filter items
  const filteredItems = useMemo(() => {
    return auditedItems.filter((item) => {
      if (sourceFilter !== "all" && item.source && item.source !== sourceFilter) {
        return false;
      }
      if (nodeFilter === "exhaustion") {
        return (
          item.sentiment?.zone === "sentiment_peak" ||
          item.sentiment?.zone === "overbought"
        );
      }
      if (nodeFilter === "momentum") {
        return item.sentiment?.zone === "momentum";
      }
      if (nodeFilter === "oversold") {
        return item.sentiment?.zone === "oversold";
      }
      return true;
    });
  }, [auditedItems, sourceFilter, nodeFilter]);

  // Aggregate KPI metrics
  const peakAlerts = useMemo(
    () => auditedItems.filter((i) => i.sentiment?.zone === "sentiment_peak").length,
    [auditedItems],
  );
  const overboughtCount = useMemo(
    () => auditedItems.filter((i) => i.sentiment?.zone === "overbought").length,
    [auditedItems],
  );
  const momentumCount = useMemo(
    () => auditedItems.filter((i) => i.sentiment?.zone === "momentum").length,
    [auditedItems],
  );
  const oversoldCount = useMemo(
    () => auditedItems.filter((i) => i.sentiment?.zone === "oversold").length,
    [auditedItems],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* KPI Overview Strip */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="rounded-md border border-border bg-card p-3">
          <span className="eyebrow">Audited Stocks</span>
          <p className="num mt-1 text-[18px] font-semibold text-foreground">
            {auditedItems.length}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {holdingCount} held · {radarCount} watched
          </p>
        </div>

        <div className="rounded-md border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 text-loss">
            <WarningCircleIcon size={14} aria-hidden />
            <span className="eyebrow text-loss">Exhaustion Peaks</span>
          </div>
          <p className="num mt-1 text-[18px] font-semibold text-loss">
            {peakAlerts + overboughtCount}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {peakAlerts} Peak (Node 3) · {overboughtCount} Node 2
          </p>
        </div>

        <div className="rounded-md border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 text-gain">
            <TrendUpIcon size={14} aria-hidden />
            <span className="eyebrow text-gain">Momentum Expansion</span>
          </div>
          <p className="num mt-1 text-[18px] font-semibold text-gain">
            {momentumCount}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Node 1 (RSI 60–69) trend runners
          </p>
        </div>

        <div className="rounded-md border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <CrosshairIcon size={14} aria-hidden />
            <span className="eyebrow">Oversold Accumulation</span>
          </div>
          <p className="num mt-1 text-[18px] font-semibold text-foreground">
            {oversoldCount}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Node 0 (RSI ≤ 30) setups
          </p>
        </div>
      </div>

      {/* Filter and Source Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          {/* Source Tabs */}
          {holdingCount > 0 && radarCount > 0 && (
            <div
              role="tablist"
              aria-label="Audit source filter"
              className="flex rounded-md border border-border p-0.5 text-[11px]"
            >
              <button
                type="button"
                onClick={() => setSourceFilter("all")}
                className={clsx(
                  "rounded-[4px] px-2.5 py-1 transition-colors",
                  sourceFilter === "all"
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                All ({auditedItems.length})
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter("holding")}
                className={clsx(
                  "rounded-[4px] px-2.5 py-1 transition-colors",
                  sourceFilter === "holding"
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Portfolio ({holdingCount})
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter("radar")}
                className={clsx(
                  "rounded-[4px] px-2.5 py-1 transition-colors",
                  sourceFilter === "radar"
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Radar ({radarCount})
              </button>
            </div>
          )}

          {/* Node Category Filter */}
          <div
            role="tablist"
            aria-label="Node category filter"
            className="flex rounded-md border border-border p-0.5 text-[11px]"
          >
            {[
              { key: "all", label: "All Nodes" },
              { key: "exhaustion", label: "Exhaustion (Node 2/3)" },
              { key: "momentum", label: "Momentum (Node 1)" },
              { key: "oversold", label: "Oversold (Node 0)" },
            ].map((nf) => (
              <button
                key={nf.key}
                type="button"
                onClick={() => setNodeFilter(nf.key)}
                className={clsx(
                  "rounded-[4px] px-2 py-0.5 transition-colors",
                  nodeFilter === nf.key
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {nf.label}
              </button>
            ))}
          </div>
        </div>

        <span className="text-[12px] text-muted-foreground">
          Showing {filteredItems.length} audited positions
        </span>
      </div>

      {/* Audited Cards Grid */}
      {filteredItems.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
          No positions currently match the selected node filter.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filteredItems.map((item) => {
            const isExpanded = expandedSymbol === item.symbol;
            const sentiment = item.sentiment;
            const isExhausted =
              sentiment?.zone === "sentiment_peak" ||
              sentiment?.zone === "overbought";

            return (
              <div
                key={item.symbol}
                className={clsx(
                  "rounded-md border bg-card p-3.5 transition-all",
                  isExhausted ? "border-loss/40" : "border-border",
                )}
              >
                {/* Header Row */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/app/markets/${encodeURIComponent(item.symbol)}`}
                      className="num text-[15px] font-bold text-foreground hover:underline"
                    >
                      {item.symbol}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span>Base: ₹{price(item.entryBase)}</span>
                      {item.entryDate && <span>· {item.entryDate}</span>}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    {sentiment ? (
                      <span
                        className={clsx(
                          "rounded px-2 py-0.5 text-[10.5px] font-semibold uppercase",
                          sentiment.tone === "loss"
                            ? "bg-loss-soft text-loss border border-loss/20 animate-pulse"
                            : sentiment.tone === "gain"
                              ? "bg-gain-soft text-gain"
                              : "bg-muted text-muted-foreground",
                        )}
                      >
                        {sentiment.label} (Node {sentiment.node})
                      </span>
                    ) : (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
                        Monitoring
                      </span>
                    )}

                    {item.rsi != null && (
                      <span className="num text-[11px] text-muted-foreground">
                        RSI: <strong className="text-foreground">{item.rsi.toFixed(1)}</strong>
                      </span>
                    )}
                  </div>
                </div>

                {/* Price and Delta Metrics */}
                <div className="mt-3 grid grid-cols-2 gap-2 border-y border-border/60 py-2.5 text-[12px]">
                  <div>
                    <span className="eyebrow">Current Close</span>
                    <p className="num mt-0.5 text-[14px] font-semibold text-foreground">
                      ₹{price(item.lastPrice)}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="eyebrow">Delta vs Base</span>
                    <div className="mt-0.5">
                      <Delta value={item.pnlPct} />
                    </div>
                  </div>
                </div>

                {/* Quantitative Action Guidance */}
                <div className="mt-2.5 rounded bg-muted/30 p-2 text-[11.5px] leading-relaxed text-muted-foreground">
                  {item.actionGuidance}
                </div>

                {/* Expand Toggle */}
                <div className="mt-3 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedSymbol(isExpanded ? null : item.symbol)
                    }
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-[11.5px] font-medium text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground"
                  >
                    <span>
                      {isExpanded
                        ? "Hide Target Roadmap"
                        : "View Asymmetric Target Roadmap (0.75R · 2.0R · 3.0R)"}
                    </span>
                    {isExpanded ? (
                      <CaretUpIcon size={14} aria-hidden />
                    ) : (
                      <CaretDownIcon size={14} aria-hidden />
                    )}
                  </button>

                  {/* Expanded Roadmap Drawer */}
                  {isExpanded && (
                    <div className="mt-2.5 flex flex-col gap-2 rounded border border-border/80 bg-card/60 p-2.5 text-[11px] animate-fadeIn">
                      <div className="grid grid-cols-4 gap-2">
                        <div className="rounded border border-border/60 p-1.5 text-center">
                          <span className="eyebrow text-loss">Stop (1R)</span>
                          <p className="num mt-0.5 font-medium text-foreground">
                            ₹{price(item.plan.stop)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            −{item.plan.riskPercent.toFixed(1)}%
                          </p>
                        </div>

                        <div className="rounded border border-border/60 p-1.5 text-center">
                          <span className="eyebrow">Target 1</span>
                          <p className="num mt-0.5 font-medium text-foreground">
                            ₹{price(item.plan.t1)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            +{(item.plan.riskPercent * 0.75).toFixed(1)}%
                          </p>
                        </div>

                        <div className="rounded border border-border/60 p-1.5 text-center">
                          <span className="eyebrow text-gain">Target 2</span>
                          <p className="num mt-0.5 font-medium text-gain">
                            ₹{price(item.plan.t2)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            +{(item.plan.riskPercent * 2.0).toFixed(1)}%
                          </p>
                        </div>

                        <div className="rounded border border-border/60 p-1.5 text-center">
                          <span className="eyebrow text-gain">Target 3</span>
                          <p className="num mt-0.5 font-medium text-gain">
                            ₹{price(item.plan.t3)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            +{(item.plan.riskPercent * 3.0).toFixed(1)}%
                          </p>
                        </div>
                      </div>

                      <div className="mt-1 flex items-center justify-between text-[10.5px] text-muted-foreground">
                        <span>Risk per unit: ₹{price(item.plan.riskPerShare)}</span>
                        <span>Multiples: 0.75R · 2.0R · 3.0R</span>
                      </div>

                      {item.exitLogs && item.exitLogs.length > 0 && (
                        <div className="mt-2 flex flex-col gap-1.5 border-t border-border/60 pt-2">
                          <span className="eyebrow text-muted-foreground">
                            Sentiment Exit History ({item.exitLogs.length})
                          </span>
                          <div className="flex flex-col gap-1">
                            {item.exitLogs.map((log, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between rounded bg-muted/40 px-2 py-1 text-[10.5px]"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-foreground">
                                    {log.exitLabel}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">
                                    {log.date}
                                  </span>
                                  <span className="rounded bg-muted px-1.5 py-0.2 text-[9px] font-medium text-muted-foreground">
                                    {log.alphaLabel}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="num font-medium text-foreground">
                                    ₹{price(log.price)}
                                  </span>
                                  <span className="num font-semibold text-gain">
                                    +{log.pnlPct.toFixed(2)}%
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
