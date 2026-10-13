"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { generateCleanPineScript, type PineStrategyMode } from "@/lib/pine-script";

export function PineScriptGeneratorPanel({ initialSymbol = "NIFTY" }: { initialSymbol?: string }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [mode, setMode] = useState<PineStrategyMode>("core");
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const code = generateCleanPineScript(symbol, mode);
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    });
  };

  const currentSym = symbol.trim() || "NSE Equities";

  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="pine-sym-input" className="eyebrow text-[11px]">
            Ticker
          </label>
          <input
            id="pine-sym-input"
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase().trim())}
            placeholder="e.g. RELIANCE, NIFTY"
            className="h-8 w-32 rounded border border-border bg-background px-2.5 font-mono text-[12.5px] uppercase text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card p-1">
          <button
            type="button"
            onClick={() => setMode("core")}
            className={`rounded px-2.5 py-1 text-[11.5px] transition-colors ${
              mode === "core" ? "bg-primary font-medium text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            QuantsPulse Core
          </button>
          <button
            type="button"
            onClick={() => setMode("swing")}
            className={`rounded px-2.5 py-1 text-[11.5px] transition-colors ${
              mode === "swing" ? "bg-primary font-medium text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Fast Swing (SMA 20)
          </button>
        </div>

        <Button type="button" size="sm" variant="primary" onClick={handleCopy} className="ml-auto">
          {copied ? (
            <>
              <CheckIcon size={14} weight="bold" className="text-gain" aria-hidden />
              <span>Indicator Copied!</span>
            </>
          ) : (
            <>
              <CopyIcon size={14} aria-hidden />
              <span>Copy Indicator to Clipboard</span>
            </>
          )}
        </Button>
      </div>

      {/* Protected Algorithm Card - Core logic is encapsulated and not displayed openly */}
      <div className="rounded-lg border border-border bg-background/60 p-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon size={16} className="text-gain" aria-hidden />
            <span className="font-medium text-foreground">TradingView v5 Indicator Package</span>
          </div>
          <span className="num text-[11.5px] text-muted-foreground uppercase">Protected Platform Asset</span>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3 text-[12px]">
          <div>
            <span className="text-muted-foreground">Active Ticker:</span>{" "}
            <span className="num font-semibold text-foreground">{currentSym}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Engine Mode:</span>{" "}
            <span className="font-medium text-foreground">
              {mode === "core" ? "Core (20/50 Cross + RSI 14)" : "Fast Swing (SMA 20)"}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Execution:</span>{" "}
            <span className="num text-gain">Zero-Repaint (Bar Close)</span>
          </div>
        </div>

        <div className="mt-3 rounded border border-border/70 bg-card/60 p-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
          Core quantitative logic is encapsulated. Click &ldquo;<strong>Copy Indicator to Clipboard</strong>&rdquo; above and paste directly into TradingView&apos;s <strong>Pine Editor</strong> (bottom chart bar) &rarr; &ldquo;<strong>Add to chart</strong>&rdquo; to plot platform signals, 1.0R risk stops, and T1/T2/T3 targets.
        </div>
      </div>
    </div>
  );
}
