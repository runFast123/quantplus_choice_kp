"use client";

import { useState } from "react";
import clsx from "clsx";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { PriceChart, type ChartMarker } from "@/components/charts/price-chart";
import { TradingViewWidget } from "@/components/charts/tradingview-widget";
import { Empty, Panel } from "@/components/ui/layout";
import { toTradingViewSymbol } from "@/lib/market";
import type { Candle } from "@/lib/types";

interface MarketChartViewProps {
  candles: Candle[];
  markers: ChartMarker[];
  symbol: string;
  exchange?: string;
}

/**
 * Unified Market Chart View:
 * Switches seamlessly between QuantsPulse's native Signals Chart (verified NSE EOD candles,
 * non-overlapping Buy/Exit markers, full-history SMA 20/50/200, and OHLCV data table)
 * and TradingView Pro's multi-indicator workstation.
 */
export function MarketChartView({
  candles,
  markers,
  symbol,
  exchange = "NSE",
}: MarketChartViewProps) {
  const [viewMode, setViewMode] = useState<"signals" | "tradingview">("signals");
  const tvUrl = `https://in.tradingview.com/chart/?symbol=${encodeURIComponent(toTradingViewSymbol(symbol, exchange))}`;

  return (
    <Panel
      title="TradingView Chart"
      meta={`${symbol} · ${exchange} Daily · Strategy Signals (KK Breakout, SMA, RSI) & Overlays`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Chart engine" className="inline-flex rounded-md border border-border bg-background/60 p-0.5 text-[11.5px]">
            <button
              type="button"
              aria-pressed={viewMode === "signals"}
              onClick={() => setViewMode("signals")}
              className={clsx(
                "rounded-[4px] px-2.5 py-0.5 font-medium transition-colors",
                viewMode === "signals"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Signals Chart
            </button>
            <button
              type="button"
              aria-pressed={viewMode === "tradingview"}
              onClick={() => setViewMode("tradingview")}
              className={clsx(
                "rounded-[4px] px-2.5 py-0.5 font-medium transition-colors",
                viewMode === "tradingview"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              TradingView Pro
            </button>
          </div>
          <a
            href={tvUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in full TradingView workstation"
            className="inline-flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
          >
            <span>TradingView Web</span>
            <ArrowSquareOutIcon className="h-3 w-3" aria-hidden />
          </a>
        </div>
      }
    >
      {viewMode === "tradingview" ? (
        <TradingViewWidget symbol={symbol} exchange={exchange} />
      ) : candles.length ? (
        <PriceChart candles={candles} markers={markers} symbol={symbol} exchange={exchange} />
      ) : (
        <Empty title="No price history yet." />
      )}
    </Panel>
  );
}
