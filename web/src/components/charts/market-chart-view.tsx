"use client";

import { useState } from "react";
import clsx from "clsx";
import { ChartLineUpIcon, LightningIcon } from "@phosphor-icons/react";
import { PriceChart, type ChartMarker } from "@/components/charts/price-chart";
import { TradingViewWidget } from "@/components/charts/tradingview-widget";
import { Empty, Panel } from "@/components/ui/layout";
import type { Candle } from "@/lib/types";

interface MarketChartViewProps {
  candles: Candle[];
  markers: ChartMarker[];
  symbol: string;
  exchange?: string;
}

/**
 * Unified Market Chart panel:
 * 1. "TradingView Signals" — native TradingView Lightweight Charts with verified NSE candles,
 *    strategy Buy/Exit signal markers, SMA 20/50/200 overlays, and range controls.
 * 2. "BSE Live Widget" — official TradingView free embed widget mapped to BSE so it never
 *    defaults to Apple Inc (AAPL).
 */
export function MarketChartView({
  candles,
  markers,
  symbol,
  exchange = "NSE",
}: MarketChartViewProps) {
  const [activeTab, setActiveTab] = useState<"signals" | "tradingview">("signals");

  return (
    <Panel
      title="Price chart"
      meta={
        activeTab === "signals"
          ? `${symbol} · NSE Daily · Buy/Exit signals & SMA overlays`
          : `${symbol} · TradingView BSE interactive widget`
      }
      actions={
        <div role="tablist" aria-label="Chart mode" className="flex rounded-md border border-border p-0.5 bg-muted/20">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "signals"}
            onClick={() => setActiveTab("signals")}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[12px] font-medium transition-colors",
              activeTab === "signals"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <LightningIcon weight={activeTab === "signals" ? "fill" : "regular"} className="h-3.5 w-3.5" />
            <span>TradingView Signals</span>
            {markers.length > 0 ? (
              <span className="num ml-0.5 rounded px-1.5 text-[10.5px] bg-background/20 font-bold">
                {markers.length}
              </span>
            ) : null}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "tradingview"}
            onClick={() => setActiveTab("tradingview")}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[12px] font-medium transition-colors",
              activeTab === "tradingview"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ChartLineUpIcon weight={activeTab === "tradingview" ? "fill" : "regular"} className="h-3.5 w-3.5" />
            <span>BSE Live Widget</span>
            <span
              className={clsx(
                "num ml-0.5 rounded px-1 text-[9.5px] uppercase font-semibold",
                activeTab === "tradingview" ? "bg-background/20" : "bg-gain/15 text-gain",
              )}
            >
              Free
            </span>
          </button>
        </div>
      }
    >
      {activeTab === "signals" ? (
        candles.length ? (
          <PriceChart candles={candles} markers={markers} symbol={symbol} exchange={exchange} />
        ) : (
          <Empty title="No price history yet." />
        )
      ) : (
        <TradingViewWidget symbol={symbol} exchange={exchange} />
      )}
    </Panel>
  );
}
