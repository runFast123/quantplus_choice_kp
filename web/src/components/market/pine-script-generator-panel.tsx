"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { PINE_RULES, pineRuleLabel, pineScript, type PineRule } from "@/lib/pine-script";

const ABOUT: Record<PineRule, string> = {
  kk_dip: "A push under the 20 day low in a stock above its 200 day average, bought on the next dip, sold on the bounce.",
  sma_trend: "The 20 day average crosses above the 50 day average in a market leader; safety stop and a 60 session review.",
  rsi_dip: "A sharp two day drop (RSI 2 under 10) in a stock above its 200 day average, bought on the next dip, sold on the bounce.",
  strong_trend: "A new 52 week high on twice the usual volume in a sunny market; safety stop and a 60 session review.",
  ma200_trend: "Above a flat or rising 200 day average after a steady climb; safety stop and a 60 session review.",
  secular_trend: "Secular trend (Pring's Special K, 50/50) turning up from below -150 after a long slump; safety stop and a 60 session review.",
};

export function PineScriptGeneratorPanel({ initialSymbol = "NIFTY" }: { initialSymbol?: string }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [rule, setRule] = useState<PineRule>("kk_dip");
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(pineScript(rule, symbol)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    });
  };

  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="pine-sym-input" className="eyebrow text-[11px]">
            Ticker
          </label>
          <input
            id="pine-sym-input"
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase().trim())}
            placeholder="e.g. RELIANCE"
            className="h-8 w-32 rounded border border-border bg-background px-2.5 font-mono text-[12.5px] uppercase text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div role="radiogroup" aria-label="Rule" className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1">
          {PINE_RULES.map((r) => (
            <button
              key={r.key}
              type="button"
              role="radio"
              aria-checked={rule === r.key}
              onClick={() => setRule(r.key)}
              className={`rounded px-2.5 py-1 text-[11.5px] transition-colors ${
                rule === r.key ? "bg-primary font-medium text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <Button type="button" size="sm" variant="primary" onClick={handleCopy} className="ml-auto">
          {copied ? (
            <>
              <CheckIcon size={14} weight="bold" className="text-gain" aria-hidden />
              <span>{pineRuleLabel(rule)} script copied</span>
            </>
          ) : (
            <>
              <CopyIcon size={14} aria-hidden />
              <span>Copy the {pineRuleLabel(rule)} script</span>
            </>
          )}
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-background/60 p-4 text-[12.5px] leading-relaxed">
        <p className="font-medium text-foreground">{pineRuleLabel(rule)}</p>
        <p className="mt-1 text-muted-foreground">{ABOUT[rule]}</p>
        <p className="mt-3 text-muted-foreground">
          One script per rule, so a TradingView chart shows that rule&apos;s buy and exit marks and nothing else, with the same safety stop
          and exit as QuantsPulse. Paste it in TradingView&apos;s <strong>Pine Editor</strong> (bottom bar) and press <strong>Add to chart</strong>,
          on the daily chart of an NSE stock. Small differences can happen where TradingView&apos;s history starts on another day or its prices
          differ from ours.
        </p>
      </div>
    </div>
  );
}
