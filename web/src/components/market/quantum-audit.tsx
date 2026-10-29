"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { CaretDownIcon } from "@phosphor-icons/react";
import { Delta } from "@/components/ui/data";
import { price } from "@/lib/format";
import {
  auditStockSentiment,
  type ExitLogEntry,
  type QuantumAuditItem,
  type SentimentZone,
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

type Group = "all" | "stretched" | "rising" | "calm" | "beaten";

const GROUPS: { key: Exclude<Group, "all">; label: string; zones: SentimentZone[] }[] = [
  { key: "stretched", label: "Stretched up", zones: ["sentiment_peak", "overbought"] },
  { key: "rising", label: "Rising steadily", zones: ["momentum"] },
  { key: "calm", label: "Calm", zones: ["equilibrium"] },
  { key: "beaten", label: "Beaten down", zones: ["oversold"] },
];

const inGroup = (item: QuantumAuditItem, g: Group) =>
  g === "all" || (item.sentiment != null && GROUPS.find((x) => x.key === g)!.zones.includes(item.sentiment.zone));

/** RSI on a 0–100 track, with the 30 and 70 lines a beginner can read as "fell hard" / "ran up fast". */
function RsiGauge({ rsi }: { rsi: number }) {
  const at = Math.max(0, Math.min(100, rsi));
  return (
    <div>
      <div role="img" aria-label={`RSI ${rsi.toFixed(0)} out of 100`} className="relative h-1.5 rounded-full bg-foreground/10">
        <span className="absolute inset-y-0 left-0 w-[30%] rounded-l-full bg-foreground/[0.06]" />
        <span className="absolute inset-y-0 right-0 w-[30%] rounded-r-full bg-foreground/[0.06]" />
        <span className="absolute -top-0.5 h-2.5 w-px bg-foreground/30" style={{ left: "30%" }} />
        <span className="absolute -top-0.5 h-2.5 w-px bg-foreground/30" style={{ left: "70%" }} />
        <span
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground"
          style={{ left: `${at}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] text-muted-foreground">
        <span>Fell hard</span>
        <span className="num">RSI {rsi.toFixed(0)}</span>
        <span>Ran up fast</span>
      </div>
    </div>
  );
}

/**
 * "How stretched are your stocks?": each holding or radar stock's RSI as a plain-words zone, a
 * 0–100 gauge, and (folded away) the stop and target prices from the trade plan. Describes the
 * recent past only; it never says what to do.
 */
export function QuantumAudit({ stocks, defaultSource = "all" }: QuantumAuditProps) {
  const [sourceFilter, setSourceFilter] = useState<"holding" | "radar" | "all">(defaultSource);
  const [group, setGroup] = useState<Group>("all");
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);

  const auditedItems: QuantumAuditItem[] = useMemo(
    () =>
      stocks.map((s) =>
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
      ),
    [stocks],
  );

  const holdingCount = auditedItems.filter((i) => i.source === "holding").length;
  const radarCount = auditedItems.filter((i) => i.source === "radar").length;
  const bySource = auditedItems.filter((i) => sourceFilter === "all" || !i.source || i.source === sourceFilter);
  const filteredItems = bySource.filter((i) => inGroup(i, group));

  const chip = (active: boolean) =>
    clsx(
      "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition-colors duration-150",
      active ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {holdingCount > 0 && radarCount > 0 ? (
          <div role="radiogroup" aria-label="Show stocks from" className="mr-2 flex rounded-full bg-muted/50 p-0.5 text-[12px]">
            {(
              [
                ["all", `All ${auditedItems.length}`],
                ["holding", `Portfolio ${holdingCount}`],
                ["radar", `Radar ${radarCount}`],
              ] as const
            ).map(([key, text]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={sourceFilter === key}
                onClick={() => setSourceFilter(key)}
                className={clsx(
                  "rounded-full px-2.5 py-1 transition-colors duration-150",
                  sourceFilter === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {text}
              </button>
            ))}
          </div>
        ) : null}

        <div role="group" aria-label="Filter by how stretched" className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={group === "all"} onClick={() => setGroup("all")} className={chip(group === "all")}>
            All <span className="num">{bySource.length}</span>
          </button>
          {GROUPS.map((g) => {
            const n = bySource.filter((i) => inGroup(i, g.key)).length;
            return (
              <button key={g.key} type="button" aria-pressed={group === g.key} onClick={() => setGroup(g.key)} className={chip(group === g.key)}>
                {g.label} <span className="num">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
          No stocks in this group right now.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filteredItems.map((item) => {
            const isExpanded = expandedSymbol === item.symbol;
            const sentiment = item.sentiment;
            const held = item.source !== "radar";
            const panelId = `levels-${item.symbol}`;

            return (
              <div key={item.symbol} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/app/markets/${encodeURIComponent(item.symbol)}`} className="num text-[15px] font-semibold text-foreground hover:underline">
                      {item.symbol}
                    </Link>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {held ? (
                        <>
                          Bought at <span className="num">₹{price(item.entryBase)}</span> · now <span className="num text-foreground">₹{price(item.lastPrice)}</span>
                        </>
                      ) : (
                        <>
                          Last close <span className="num text-foreground">₹{price(item.lastPrice)}</span>
                          {item.entryDate ? ` · on radar since ${item.entryDate}` : ""}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={clsx(
                        "rounded-full px-2.5 py-0.5 text-[11.5px] font-medium",
                        sentiment?.tone === "loss" ? "bg-loss-soft text-loss" : sentiment?.tone === "gain" ? "bg-gain-soft text-gain" : "bg-muted text-foreground",
                      )}
                    >
                      {sentiment?.label ?? "No RSI yet"}
                    </span>
                    {held ? <Delta value={item.pnlPct} /> : null}
                  </div>
                </div>

                {item.rsi != null ? <RsiGauge rsi={item.rsi} /> : null}

                <p className="text-[12.5px] leading-relaxed text-muted-foreground">{item.actionGuidance}</p>

                <div>
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={panelId}
                    onClick={() => setExpandedSymbol(isExpanded ? null : item.symbol)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground"
                  >
                    <span>{isExpanded ? "Hide stop and targets" : "Show stop and targets"}</span>
                    <CaretDownIcon size={13} aria-hidden className={clsx("transition-transform duration-150", isExpanded && "rotate-180")} />
                  </button>

                  {isExpanded ? (
                    <div id={panelId} className="mt-2 flex flex-col gap-2 rounded-lg bg-muted/30 p-3 text-[12px] animate-fadeIn">
                      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                        <li>
                          <span className="block text-[11px] text-muted-foreground">Stop</span>
                          <span className="num font-medium text-loss">₹{price(item.plan.stop)}</span>{" "}
                          <span className="num text-[11px] text-muted-foreground">−{item.plan.riskPercent.toFixed(1)}%</span>
                        </li>
                        {(
                          [
                            ["Target 1", item.plan.t1, 0.75],
                            ["Target 2", item.plan.t2, 2],
                            ["Target 3", item.plan.t3, 3],
                          ] as const
                        ).map(([label, p, m]) => (
                          <li key={label}>
                            <span className="block text-[11px] text-muted-foreground">{label}</span>
                            <span className="num font-medium text-foreground">₹{price(p)}</span>{" "}
                            <span className="num text-[11px] text-muted-foreground">+{(item.plan.riskPercent * m).toFixed(1)}%</span>
                          </li>
                        ))}
                      </ul>
                      <p className="text-[11px] text-muted-foreground">
                        Worked out from {held ? "your buy price" : "the last close"}: the stop sits ₹{price(item.plan.riskPerShare)} a share below it, and the
                        targets are ¾, 2 and 3 times that distance above it.
                      </p>
                      {item.lastPrice <= item.plan.stop ? (
                        <p className="text-[11.5px] font-medium text-loss">▼ The price is already below this stop.</p>
                      ) : null}

                      {item.exitLogs && item.exitLogs.length > 0 ? (
                        <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
                          <span className="text-[11px] font-medium text-foreground">Past exit points ({item.exitLogs.length})</span>
                          {item.exitLogs.map((log, idx) => (
                            <div key={idx} className="flex items-center justify-between rounded-md bg-card px-2 py-1 text-[11px]">
                              <span className="text-muted-foreground">
                                {log.date} · {log.alphaLabel}
                              </span>
                              <span className="num text-foreground">
                                ₹{price(log.price)} <Delta value={log.pnlPct} />
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
