"use client";

import { useState } from "react";
import { CheckIcon, CodeIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { generateCleanPineScript, type PineStrategyMode } from "@/lib/pine-script";

export function CopyPineButton({
  symbol,
  defaultMode = "core",
  className,
}: {
  symbol?: string;
  defaultMode?: PineStrategyMode;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const code = generateCleanPineScript(symbol, defaultMode);
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    });
  };

  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={handleCopy}
        className={className}
        title={`Copy TradingView Pine Script Indicator for ${symbol ?? "NSE Equities"}`}
      >
        {copied ? (
          <>
            <CheckIcon size={14} weight="bold" className="text-gain" aria-hidden />
            <span className="text-gain">Pine Script Copied!</span>
          </>
        ) : (
          <>
            <CodeIcon size={14} aria-hidden />
            <span>Copy Pine Script</span>
          </>
        )}
      </Button>
    </div>
  );
}
