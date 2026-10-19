"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  ArrowSquareOutIcon,
  CheckIcon,
  CircleNotchIcon,
  CopyIcon,
  CpuIcon,
  DownloadSimpleIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { askPortfolioAi, type PortfolioAiState } from "@/app/app/portfolio/actions";
import {
  calculatePortfolioHealth,
  type HealthPosition,
  type PortfolioDiagnosticFocus,
  type PortfolioHealthReport,
} from "@/lib/portfolio-health";
import { Delta } from "@/components/ui/data";
import { rupees } from "@/lib/format";

interface AiPortfolioDiagnosticProps {
  portfolioId?: string;
  ready: boolean;
  reason?: string;
  positions?: HealthPosition[];
}

const FOCUS_MODES: {
  id: PortfolioDiagnosticFocus;
  label: string;
  shortLabel: string;
  desc: string;
}[] = [
  {
    id: "comprehensive",
    label: "Comprehensive Audit",
    shortLabel: "Comprehensive",
    desc: "Holistic institutional balance, concentration, HHI & macro sensitivities",
  },
  {
    id: "risk_audit",
    label: "Risk & Downside Audit",
    shortLabel: "Risk & Downside",
    desc: "Stress testing, single-stock caps, drawdown exposure & tail-risk containment",
  },
  {
    id: "rebalancing",
    label: "Trimming & Rebalancing",
    shortLabel: "Trimming",
    desc: "Profit locking on RSI exhaustion (≥70), dead-weight capital & risk parity",
  },
  {
    id: "tax_cost_basis",
    label: "Cost-Basis & Gaps",
    shortLabel: "Cost-Basis",
    desc: "Discount gap analysis (>10% below cost), loser retention & tax efficiency",
  },
];

export function AiPortfolioDiagnostic({
  portfolioId,
  ready,
  reason,
  positions = [],
}: AiPortfolioDiagnosticProps) {
  const [selectedFocus, setSelectedFocus] = useState<PortfolioDiagnosticFocus>("comprehensive");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>("");
  const [result, setResult] = useState<PortfolioAiState | null>(null);
  const [copied, setCopied] = useState(false);

  // Instant deterministic quantitative metrics
  const health: PortfolioHealthReport = useMemo(() => {
    return calculatePortfolioHealth(positions);
  }, [positions]);

  const activeFocusInfo = FOCUS_MODES.find((m) => m.id === selectedFocus) ?? FOCUS_MODES[0];

  const handleRunDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    setLoadingStep("Computing concentration & HHI matrix…");

    const timer1 = setTimeout(() => {
      setLoadingStep("Evaluating sector exposures & RSI exhaustion nodes…");
    }, 1200);

    const timer2 = setTimeout(() => {
      setLoadingStep("Querying your BYOK key with encrypted in-memory payload…");
    }, 2500);

    try {
      const res = await askPortfolioAi(portfolioId, selectedFocus);
      setResult(res);
    } catch (err: unknown) {
      setResult({
        error: err instanceof Error ? err.message : "Couldn't generate diagnostic.",
        focus: selectedFocus,
      });
    } finally {
      clearTimeout(timer1);
      clearTimeout(timer2);
      setLoading(false);
      setLoadingStep("");
    }
  };

  const handleCopy = async () => {
    if (!result?.text) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback ignore
    }
  };

  const handleExportMarkdown = () => {
    if (!result?.text) return;
    const dateStr = new Date().toISOString().split("T")[0];
    const content = `# QuantsPulse Portfolio Health Diagnostic\nDate: ${dateStr}\nFocus: ${result.focus ?? selectedFocus}\nModel: ${result.model ?? "BYOK"}\n\n---\n\n${result.text}\n\n---\n*Quantitative research only. Not financial advice.*`;
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `portfolio-diagnostic-${dateStr}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Known symbols for clickable inline links
  const portfolioSymbols = useMemo(() => {
    return new Set(positions.map((p) => p.symbol.toUpperCase()));
  }, [positions]);

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Instant Quantitative Health Bar & KPIs */}
      {positions.length > 0 && (
        <div className="rounded-lg border border-border bg-card/60 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-md border border-border bg-foreground/[0.04] text-foreground">
                <ShieldCheckIcon size={20} aria-hidden />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="eyebrow">Portfolio Health Rating</span>
                  <span
                    className={clsx(
                      "rounded px-1.5 py-0.5 text-[10.5px] font-medium tracking-wide",
                      health.scores.overall >= 80
                        ? "bg-gain-soft text-gain"
                        : health.scores.overall >= 60
                          ? "bg-coral/15 text-coral-ink"
                          : "bg-loss-soft text-loss",
                    )}
                  >
                    {health.verdict}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="num text-[20px] font-semibold text-foreground">
                    {health.scores.overall}
                    <span className="text-[13px] font-normal text-muted-foreground">/100</span>
                  </span>
                  <span className="text-[12px] text-muted-foreground">
                    · {health.positionCount} holdings valued at {rupees(health.totalValue, { decimals: false })} (P&amp;L <Delta value={health.totalPnlPct} />)
                  </span>
                </div>
              </div>
            </div>

            {/* Subscore strip */}
            <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-muted-foreground">
              <div className="rounded border border-border bg-card px-2 py-1">
                <span>Diversification: </span>
                <strong className="num text-foreground">{health.scores.diversification}/30</strong>
              </div>
              <div className="rounded border border-border bg-card px-2 py-1">
                <span>Sector Balance: </span>
                <strong className="num text-foreground">{health.scores.sectorBalance}/25</strong>
              </div>
              <div className="rounded border border-border bg-card px-2 py-1">
                <span>Technical/RSI: </span>
                <strong className="num text-foreground">{health.scores.technicalHealth}/25</strong>
              </div>
              <div className="rounded border border-border bg-card px-2 py-1">
                <span>Loss Containment: </span>
                <strong className="num text-foreground">{health.scores.capitalPreservation}/20</strong>
              </div>
            </div>
          </div>

          {/* Institutional KPI Matrix */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-[12.5px]">
            <div className="min-w-0">
              <span className="eyebrow block">Concentration (HHI)</span>
              <p className="num mt-1 text-[16px] font-medium text-foreground">
                {health.hhi.toLocaleString("en-IN")}
              </p>
              <p className="text-[11px] text-muted-foreground truncate capitalize">
                {health.concentrationRating.replace("_", " ")} (N<sub>eff</sub> {health.effectiveN})
              </p>
            </div>

            <div className="min-w-0">
              <span className="eyebrow block">Top Holding</span>
              <p className="num mt-1 text-[16px] font-medium text-foreground truncate">
                {health.topHolding ? `${health.topHolding.symbol} (${health.topHolding.weightPct}%)` : "—"}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                Top 3 Concentration: {health.top3WeightPct}%
              </p>
            </div>

            <div className="min-w-0">
              <span className="eyebrow block">Top Sector</span>
              <p className="mt-1 text-[16px] font-medium text-foreground truncate">
                {health.topSector ? `${health.topSector.sector} (${health.topSector.weightPct}%)` : "—"}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                Spread across {health.sectors.length} sectors
              </p>
            </div>

            <div className="min-w-0">
              <span className="eyebrow block">RSI &amp; Value Dispersion</span>
              <p className="num mt-1 text-[16px] font-medium text-foreground">
                {health.rsiExhaustionCount > 0 ? (
                  <span className="text-coral-ink">{health.rsiExhaustionCount} Overbought</span>
                ) : (
                  <span className="text-gain">Balanced RSI</span>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {health.underwaterCount} stock{health.underwaterCount === 1 ? "" : "s"} &gt;10% below cost
              </p>
            </div>
          </div>

          {/* Quick Risk & Opportunity Pills */}
          {health.riskFlags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/50">
              {health.riskFlags.map((flag) => (
                <div
                  key={flag.id}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border",
                    flag.type === "warning" && "border-coral/40 bg-coral/10 text-coral-ink",
                    flag.type === "caution" && "border-border bg-foreground/[0.04] text-foreground",
                    flag.type === "positive" && "border-gain/40 bg-gain-soft text-gain",
                  )}
                  title={flag.description}
                >
                  <span className="size-1.5 rounded-full bg-current" aria-hidden />
                  <span>{flag.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2. Diagnostic Focus Controls */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="eyebrow">Diagnostic Focus:</span>
            <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Diagnostic focus">
              {FOCUS_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  role="tab"
                  aria-selected={selectedFocus === mode.id}
                  onClick={() => setSelectedFocus(mode.id)}
                  className={clsx(
                    "rounded px-2.5 py-1 text-[12px] font-medium transition-colors",
                    selectedFocus === mode.id
                      ? "bg-foreground text-background"
                      : "border border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {mode.shortLabel}
                </button>
              ))}
            </div>
          </div>

          {ready && (
            <button
              type="button"
              disabled={loading}
              onClick={handleRunDiagnostic}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-foreground text-background px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-foreground/90 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <CircleNotchIcon size={15} className="animate-spin" aria-hidden />
                  <span>Analyzing portfolio…</span>
                </>
              ) : (
                <>
                  <CpuIcon size={15} aria-hidden />
                  <span>Run AI Health Check</span>
                </>
              )}
            </button>
          )}
        </div>

        <p className="text-[12px] text-muted-foreground">
          {activeFocusInfo.desc}. Generates a targeted institutional brief using your BYOK key.
        </p>

        {!ready && (
          <div className="rounded-md border border-border bg-card p-3 text-[12.5px] text-muted-foreground">
            {reason}{" "}
            <Link
              href="/app/integrations"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80 font-medium"
            >
              Integrations
            </Link>
          </div>
        )}
      </div>

      {/* 3. Loading Step Tracker */}
      {loading && (
        <div className="rounded-md border border-border bg-card p-4 space-y-2 animate-pulse">
          <div className="flex items-center gap-2 text-[13px] text-foreground font-medium">
            <CircleNotchIcon size={16} className="animate-spin text-foreground" aria-hidden />
            <span>{loadingStep || "Analyzing portfolio structure…"}</span>
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            Decrypted in memory with AES-256-GCM. Prompts and keys are never stored on our servers.
          </p>
        </div>
      )}

      {/* 4. Error State */}
      {result?.error ? (
        <div className="flex items-center gap-2 rounded-md border border-loss/30 bg-loss-soft/30 p-3 text-[12.5px] text-loss">
          <WarningCircleIcon size={16} aria-hidden />
          <span>{result.error}</span>
        </div>
      ) : null}

      {/* 5. Structured AI Diagnostic Result Card */}
      {result?.text ? (
        <figure className="rounded-lg border border-border bg-card/80 p-5 space-y-4 animate-fadeIn">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
            <div className="flex items-center gap-2">
              <span className="eyebrow">AI Executive Brief</span>
              <span className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-foreground capitalize">
                {result.focus ?? selectedFocus}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                title="Copy diagnostic text"
              >
                {copied ? (
                  <>
                    <CheckIcon size={13} className="text-gain" aria-hidden />
                    <span className="text-gain">Copied</span>
                  </>
                ) : (
                  <>
                    <CopyIcon size={13} aria-hidden />
                    <span>Copy</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleExportMarkdown}
                className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                title="Download report as Markdown"
              >
                <DownloadSimpleIcon size={13} aria-hidden />
                <span>Export .md</span>
              </button>
            </div>
          </div>

          {/* Formatted Text with Interactive Ticker Links */}
          <div className="whitespace-pre-line text-[13.5px] leading-relaxed text-foreground space-y-2">
            {formatDiagnosticText(result.text, portfolioSymbols)}
          </div>

          {/* Footer & Meta */}
          <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-[11.5px] text-muted-foreground">
            <div>
              Generated by <span className="num font-medium text-foreground">{result.model}</span> ({result.provider}) via your BYOK key. Decrypted in memory; not stored.
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/app/markets"
                className="inline-flex items-center gap-1 hover:text-foreground underline underline-offset-4"
              >
                <span>Browse Market Radar</span>
                <ArrowSquareOutIcon size={12} aria-hidden />
              </Link>
              <Link
                href="/app/signals"
                className="inline-flex items-center gap-1 hover:text-foreground underline underline-offset-4"
              >
                <span>Check Signals</span>
                <ArrowSquareOutIcon size={12} aria-hidden />
              </Link>
            </div>
          </figcaption>
        </figure>
      ) : null}
    </div>
  );
}

/**
 * Parses and formats diagnostic text:
 * - Highlights section headers
 * - Converts recognized stock tickers into clickable links to /app/markets/[symbol]
 */
function formatDiagnosticText(text: string, knownSymbols: Set<string>) {
  const lines = text.split("\n");

  return lines.map((line, idx) => {
    // Section headers like "1. Executive Health Verdict:" or "Concentration & Structural Risk:"
    const isHeader = /^(\d+\.|\*|\#\#)\s+([A-Z][A-Za-z\s&–—]+:?)/.test(line.trim());

    if (isHeader) {
      return (
        <div key={idx} className="font-semibold text-foreground pt-1.5 first:pt-0">
          {renderLineWithTickerLinks(line, knownSymbols)}
        </div>
      );
    }

    return (
      <div key={idx}>
        {renderLineWithTickerLinks(line, knownSymbols)}
      </div>
    );
  });
}

function renderLineWithTickerLinks(line: string, knownSymbols: Set<string>) {
  // Regex to match potential ticker symbols (2 to 12 uppercase letters/digits)
  const words = line.split(/(\b[A-Z0-9&\-.]{2,12}\b)/g);

  return words.map((token, i) => {
    const clean = token.trim().toUpperCase();
    if (knownSymbols.has(clean)) {
      return (
        <Link
          key={i}
          href={`/app/markets/${encodeURIComponent(clean)}`}
          className="num font-semibold text-foreground underline decoration-border hover:decoration-foreground hover:text-foreground transition-colors"
          title={`View ${clean} on Market Radar`}
        >
          {token}
        </Link>
      );
    }
    return token;
  });
}
