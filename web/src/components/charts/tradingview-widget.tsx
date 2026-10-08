"use client";

import { useEffect, useRef, useState } from "react";
import { toTradingViewSymbol } from "@/lib/market";

interface TradingViewWidgetProps {
  symbol: string;
  exchange?: string;
  className?: string;
}

/**
 * Free TradingView Advanced Real-Time Chart widget.
 * Features 100+ technical indicators, drawing tools, multi-timeframe analysis,
 * and live/delayed NSE/BSE feeds directly from TradingView at zero cost.
 */
export function TradingViewWidget({ symbol, exchange = "NSE", className }: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDark, setIsDark] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Synchronize theme with html class (Zen Linen theme switcher)
  useEffect(() => {
    const updateTheme = () => {
      setIsDark(document.documentElement.classList.contains("dark"));
    };
    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const tvSymbol = toTradingViewSymbol(symbol, exchange);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setIsLoading(true);
    container.innerHTML = "";

    const widgetContainer = document.createElement("div");
    widgetContainer.className = "tradingview-widget-container";
    widgetContainer.style.height = "100%";
    widgetContainer.style.width = "100%";

    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    widgetDiv.style.height = "calc(100% - 32px)";
    widgetDiv.style.width = "100%";
    widgetContainer.appendChild(widgetDiv);

    const copyrightDiv = document.createElement("div");
    copyrightDiv.className = "tradingview-widget-copyright flex items-center justify-between px-2 pt-2 text-[11px] text-muted-foreground";
    copyrightDiv.innerHTML = `
      <a href="https://in.tradingview.com/symbols/${encodeURIComponent(tvSymbol)}/" rel="noopener nofollow" target="_blank" class="hover:text-foreground hover:underline transition-colors">
        <span class="num font-medium">${tvSymbol}</span> chart on TradingView
      </a>
      <span class="num text-[10.5px] opacity-70">Interactive · Free Technical Analysis</span>
    `;
    widgetContainer.appendChild(copyrightDiv);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: "D",
      timezone: "Asia/Kolkata",
      theme: isDark ? "dark" : "light",
      style: "1",
      locale: "in",
      enable_publishing: false,
      allow_symbol_change: false,
      calendar: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      withdateranges: true,
      hide_side_toolbar: false,
      support_host: "https://www.tradingview.com",
    });

    script.onload = () => {
      setIsLoading(false);
    };

    widgetContainer.appendChild(script);
    container.appendChild(widgetContainer);

    // Timeout safety fallback for loader
    const timer = setTimeout(() => setIsLoading(false), 1200);

    return () => {
      clearTimeout(timer);
      if (container) {
        container.innerHTML = "";
      }
    };
  }, [tvSymbol, isDark]);

  return (
    <div className={`relative w-full h-[480px] md:h-[560px] overflow-hidden rounded-md border border-border bg-card ${className ?? ""}`}>
      {isLoading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-card/80 backdrop-blur-xs text-muted-foreground">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="num mt-2 text-[12px]">Loading TradingView chart for {tvSymbol}…</span>
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
