"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CircleNotchIcon,
  CpuIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { askPortfolioAi, type PortfolioAiState } from "@/app/app/portfolio/actions";

interface AiPortfolioDiagnosticProps {
  portfolioId?: string;
  ready: boolean;
  reason?: string;
}

export function AiPortfolioDiagnostic({
  portfolioId,
  ready,
  reason,
}: AiPortfolioDiagnosticProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PortfolioAiState | null>(null);

  const handleRunDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await askPortfolioAi(portfolioId);
      setResult(res);
    } catch (err: unknown) {
      setResult({
        error: err instanceof Error ? err.message : "Couldn't generate diagnostic.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {!ready ? (
        <p className="text-[12.5px] leading-5 text-muted-foreground">
          {reason}{" "}
          <Link
            href="/app/integrations"
            className="text-foreground underline underline-offset-4 hover:text-foreground/80"
          >
            Integrations
          </Link>
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12.5px] text-muted-foreground">
            Quantitative analysis of your portfolio concentration (HHI), sector weights, and RSI alignment using your BYOK key.
          </p>
          <button
            type="button"
            disabled={loading}
            onClick={handleRunDiagnostic}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/[0.04] disabled:opacity-50"
          >
            {loading ? (
              <>
                <CircleNotchIcon size={15} className="animate-spin" aria-hidden />
                <span>Analyzing portfolio…</span>
              </>
            ) : (
              <>
                <CpuIcon size={15} aria-hidden />
                <span>Run portfolio diagnostic</span>
              </>
            )}
          </button>
        </div>
      )}

      {result?.error ? (
        <div className="flex items-center gap-2 rounded-md border border-loss/30 bg-loss-soft/30 p-3 text-[12.5px] text-loss">
          <WarningCircleIcon size={16} aria-hidden />
          <span>{result.error}</span>
        </div>
      ) : null}

      {result?.text ? (
        <figure className="rounded-md border border-border bg-card/60 p-4 animate-fadeIn">
          <div className="whitespace-pre-line text-[13.5px] leading-relaxed text-foreground">
            {result.text}
          </div>
          <figcaption className="mt-3 border-t border-border/60 pt-2.5 text-[11.5px] text-muted-foreground">
            Written by <span className="num font-medium text-foreground">{result.model}</span> using your BYOK key. Not stored or logged. Not financial advice.
          </figcaption>
        </figure>
      ) : null}
    </div>
  );
}
