"use client";

import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { PriceChart, type ChartMarker } from "@/components/charts/price-chart";
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
 * Unified TradingView Chart:
 * Powered by TradingView's official charting engine. Displays verified Indian equity candles,
 * Buy & Exit strategy signals directly on the bars, interactive SMA 20/50/200 overlays,
 * Volume histogram, and timeline controls in one single, crystal-clear view.
 */
export function MarketChartView({
  candles,
  markers,
  symbol,
  exchange = "NSE",
}: MarketChartViewProps) {
  const tvUrl = `https://in.tradingview.com/chart/?symbol=${encodeURIComponent(toTradingViewSymbol(symbol, exchange))}`;

  return (
    <Panel
      title="TradingView Chart"
      meta={`${symbol} · ${exchange} Daily · Buy & Exit Signals with SMA Overlays`}
      actions={
        <div className="flex items-center gap-2">
          {markers.length > 0 && (
            <span className="num hidden sm:inline-flex items-center gap-1 rounded bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
              <strong className="text-foreground">{markers.length}</strong> signal{markers.length === 1 ? "" : "s"} on chart
            </span>
          )}
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
      {candles.length ? (
        <PriceChart candles={candles} markers={markers} symbol={symbol} exchange={exchange} />
      ) : (
        <Empty title="No price history yet." />
      )}
    </Panel>
  );
}
