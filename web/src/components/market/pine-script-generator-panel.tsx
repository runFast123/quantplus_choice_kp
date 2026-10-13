"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { generateCleanPineScript, type PineStrategyMode } from "@/lib/pine-script";

export function PineScriptGeneratorPanel({ initialSymbol = "NIFTY" }: { initialSymbol?: string }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [mode, setMode] = useState<PineStrategyMode>("core");
  const [copied, setCopied] = useState(false);

  const code = generateCleanPineScript(symbol, mode);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    });
  };

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
              <span>Copied to Clipboard!</span>
            </>
          ) : (
            <>
              <CopyIcon size={14} aria-hidden />
              <span>Copy Pine Script</span>
            </>
          )}
        </Button>
      </div>

      <div className="relative">
        <pre className="max-h-56 overflow-x-auto overflow-y-auto rounded-lg border border-border bg-background/80 p-3.5 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
          <code>{code}</code>
        </pre>
      </div>

      <p className="text-[12px] leading-5 text-muted-foreground">
        Paste into TradingView&apos;s <strong>Pine Editor</strong> at the bottom of any chart, then click{" "}
        <strong>&ldquo;Add to chart&rdquo;</strong>. The indicator evaluates signals on confirmed daily candles to prevent repainting.
      </p>
    </div>
  );
}
