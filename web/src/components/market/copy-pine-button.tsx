"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { CaretDownIcon, CheckIcon, CodeIcon } from "@phosphor-icons/react";
import { PINE_RULES, pineRuleLabel, pineScript, type PineRule } from "@/lib/pine-script";

/**
 * Copies ONE rule's TradingView Pine script: the rule chosen on the chart. With no single rule chosen ("All plans" or
 * "Clean"), the button opens a short list of the five rules so the user picks which one to copy.
 */
export function CopyPineButton({ symbol, rule, className }: { symbol?: string; rule: PineRule | null; className?: string }) {
  const [copied, setCopied] = useState<PineRule | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const copy = (r: PineRule) => {
    setOpen(false);
    navigator.clipboard.writeText(pineScript(r, symbol)).then(() => {
      setCopied(r);
      setTimeout(() => setCopied(null), 2400);
    });
  };

  const face = copied ? (
    <>
      <CheckIcon size={13} weight="bold" className="text-gain" aria-hidden />
      <span className="text-gain">{pineRuleLabel(copied)} script copied</span>
    </>
  ) : (
    <>
      <CodeIcon size={13} aria-hidden />
      <span>{rule ? `Copy ${pineRuleLabel(rule)} Pine script` : "Copy a rule's Pine script"}</span>
      {rule ? null : <CaretDownIcon size={11} aria-hidden />}
    </>
  );
  const btn = clsx(
    "inline-flex h-6 items-center gap-1 rounded border border-border bg-background px-2 text-[10.5px] font-medium text-foreground transition-colors hover:bg-foreground/[0.05]",
    className,
  );

  if (rule) {
    return (
      <button
        type="button"
        onClick={() => copy(rule)}
        className={btn}
        data-testid="copy-pine"
        title={`Copies the ${pineRuleLabel(rule)} rule only, as a TradingView Pine script for ${symbol ?? "this stock"}. Paste it in TradingView's Pine Editor and press Add to chart.`}
      >
        {face}
      </button>
    );
  }
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={btn}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="copy-pine"
        title="Pick the rule whose TradingView Pine script to copy"
      >
        {face}
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-44 rounded-md border border-border bg-popover p-1 shadow-md">
          {PINE_RULES.map((r) => (
            <button
              key={r.key}
              type="button"
              role="menuitem"
              onClick={() => copy(r.key)}
              className="block w-full rounded px-2 py-1.5 text-left text-[12px] text-foreground hover:bg-foreground/[0.06]"
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
