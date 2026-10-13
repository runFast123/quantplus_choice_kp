"use client";

import { useActionState, useState } from "react";
import {
  ArrowsClockwiseIcon,
  ChartLineUpIcon,
  ArticleIcon,
  BellSimpleRingingIcon,
  DatabaseIcon,
  ClockCountdownIcon,
} from "@phosphor-icons/react";
import { FormMessage } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  fetchNewsNow,
  refreshMarketAnalyticsAction,
  refreshResearchNotesAction,
  runEodNotifierAction,
  syncEodMarketPricesAction,
} from "./actions";

export function MaintenanceOperations() {
  const [eodState, eodAction] = useActionState(syncEodMarketPricesAction, undefined);
  const [newsState, newsAction] = useActionState(fetchNewsNow, undefined);
  const [analyticsState, analyticsAction] = useActionState(refreshMarketAnalyticsAction, undefined);
  const [researchState, researchAction] = useActionState(refreshResearchNotesAction, undefined);
  const [notifierState, notifierAction] = useActionState(runEodNotifierAction, undefined);

  const [eodScope, setEodScope] = useState<"active" | "top" | "all" | "custom">("active");

  return (
    <div className="flex flex-col gap-4">
      {/* Primary: EOD Price Ingestion Engine */}
      <form action={eodAction} className="rounded-lg border border-border bg-card/70 p-4 transition-colors hover:border-foreground/20">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-foreground font-semibold text-[14px]">
              <DatabaseIcon size={18} className="text-foreground shrink-0" aria-hidden />
              <span>EOD Market Price Ingestion Engine</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                Yahoo Finance
              </span>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground max-w-2xl leading-normal">
              Fetches final split-adjusted settlement candles directly from Yahoo Finance, writes them to{" "}
              <code className="text-foreground/80 font-mono text-[11px]">market_candles</code>, and automatically triggers
              Wilder RSI recalculation, AI/factor stances, and trailing stop alert dispatching.
            </p>
          </div>
          <div className="flex items-center gap-1.5 rounded border border-border bg-background/50 px-2 py-1 text-[11px] text-muted-foreground shrink-0">
            <ClockCountdownIcon size={13} className="text-coral-ink shrink-0" aria-hidden />
            <span>Auto: 17:00 & 20:00 IST</span>
          </div>
        </div>

        {/* Scope selector */}
        <div className="mt-3.5 flex flex-wrap items-center gap-2 pt-3 border-t border-border/50">
          <input type="hidden" name="scope" value={eodScope} />
          <span className="text-[11.5px] font-medium text-foreground">Sync Target:</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setEodScope("active")}
              className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
                eodScope === "active"
                  ? "bg-foreground text-background font-medium"
                  : "bg-muted/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              Watched & Held (~50–200 Symbols · Recommended)
            </button>
            <button
              type="button"
              onClick={() => setEodScope("top")}
              className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
                eodScope === "top"
                  ? "bg-foreground text-background font-medium"
                  : "bg-muted/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              Top 100 Large Caps + Indices
            </button>
            <button
              type="button"
              onClick={() => setEodScope("all")}
              className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
                eodScope === "all"
                  ? "bg-foreground text-background font-medium"
                  : "bg-muted/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              Full NSE Universe (~3,600 Symbols)
            </button>
            <button
              type="button"
              onClick={() => setEodScope("custom")}
              className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
                eodScope === "custom"
                  ? "bg-foreground text-background font-medium"
                  : "bg-muted/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              Custom Tickers…
            </button>
          </div>
        </div>

        {/* Custom symbols input if selected */}
        {eodScope === "custom" && (
          <div className="mt-2.5">
            <input
              type="text"
              name="customSymbols"
              placeholder="e.g. HDFCBANK, RELIANCE, TCS, INFY, NIFTY"
              className="w-full rounded border border-border bg-background px-3 py-1.5 text-[12px] font-mono text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
            />
          </div>
        )}

        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border/50">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[11.5px] text-muted-foreground">Candle Window:</span>
              <select
                name="days"
                defaultValue="10"
                className="rounded border border-border bg-background px-2 py-1 text-[11.5px] font-mono text-foreground focus:outline-none"
              >
                <option value="5">Last 5 Days (Fast Reconcile)</option>
                <option value="10">Last 10 Days (Standard EOD)</option>
                <option value="30">Last 30 Days (Full Month Backfill)</option>
              </select>
            </div>
            <label className="flex items-center gap-1.5 text-[11.5px] text-foreground/80 cursor-pointer select-none">
              <input
                type="checkbox"
                name="includeToday"
                value="true"
                defaultChecked
                className="rounded border-border accent-foreground"
              />
              <span>Include Today&apos;s Active Trading Bar</span>
            </label>
          </div>
          <div className="w-full sm:w-auto">
            <SubmitButton size="sm" variant="primary" className="w-full sm:w-auto text-[12px] h-8 px-4" pendingLabel="Fetching & Ingesting EOD Data…">
              <ArrowsClockwiseIcon size={13} className="mr-1.5" aria-hidden />
              Sync EOD Market Prices Now
            </SubmitButton>
          </div>
        </div>

        <div className="mt-2 text-[11.5px]">
          <FormMessage state={eodState} />
        </div>
      </form>

      {/* Secondary Downstream Maintenance Tools */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* 1. Recalculate Signals & Analytics */}
        <form action={analyticsAction} className="flex flex-col justify-between rounded-lg border border-border bg-card/60 p-3.5 transition-colors hover:border-foreground/20">
          <div>
            <div className="flex items-center gap-2 text-foreground font-medium text-[13px]">
              <ChartLineUpIcon size={16} className="text-gain shrink-0" aria-hidden />
              <span>Recalculate Signals</span>
            </div>
            <p className="mt-1 text-[11.5px] text-muted-foreground leading-snug">
              Recomputes Wilder RSI(14), exact SMA 20/50, and generates trading signals over existing candles.
            </p>
          </div>
          <div className="mt-3.5 pt-2 border-t border-border/50">
            <SubmitButton size="sm" variant="secondary" className="w-full text-[12px] h-8" pendingLabel="Computing…">
              <ArrowsClockwiseIcon size={12} className="mr-1" aria-hidden />
              Run Analytics Now
            </SubmitButton>
            <div className="mt-2 text-[11px]">
              <FormMessage state={analyticsState} />
            </div>
          </div>
        </form>

        {/* 2. Rebuild Research Notes */}
        <form action={researchAction} className="flex flex-col justify-between rounded-lg border border-border bg-card/60 p-3.5 transition-colors hover:border-foreground/20">
          <div>
            <div className="flex items-center gap-2 text-foreground font-medium text-[13px]">
              <ArticleIcon size={16} className="text-foreground shrink-0" aria-hidden />
              <span>Rebuild Research Notes</span>
            </div>
            <p className="mt-1 text-[11.5px] text-muted-foreground leading-snug">
              Synthesizes multi-factor stance scores, technical summaries, and sector rankings.
            </p>
          </div>
          <div className="mt-3.5 pt-2 border-t border-border/50">
            <SubmitButton size="sm" variant="secondary" className="w-full text-[12px] h-8" pendingLabel="Rebuilding…">
              <ArrowsClockwiseIcon size={12} className="mr-1" aria-hidden />
              Rebuild Stances
            </SubmitButton>
            <div className="mt-2 text-[11px]">
              <FormMessage state={researchState} />
            </div>
          </div>
        </form>

        {/* 3. Dispatch EOD Notifier */}
        <form action={notifierAction} className="flex flex-col justify-between rounded-lg border border-border bg-card/60 p-3.5 transition-colors hover:border-foreground/20">
          <div>
            <div className="flex items-center gap-2 text-foreground font-medium text-[13px]">
              <BellSimpleRingingIcon size={16} className="text-coral-ink shrink-0" aria-hidden />
              <span>Dispatch EOD Notifier</span>
            </div>
            <p className="mt-1 text-[11.5px] text-muted-foreground leading-snug">
              Scans price alert thresholds, checks exit signals on open positions, and sends notifications.
            </p>
          </div>
          <div className="mt-3.5 pt-2 border-t border-border/50">
            <SubmitButton size="sm" variant="secondary" className="w-full text-[12px] h-8" pendingLabel="Dispatching…">
              <ArrowsClockwiseIcon size={12} className="mr-1" aria-hidden />
              Dispatch Alerts
            </SubmitButton>
            <div className="mt-2 text-[11px]">
              <FormMessage state={notifierState} />
            </div>
          </div>
        </form>

        {/* 4. Ingest RSS News Feeds */}
        <form action={newsAction} className="flex flex-col justify-between rounded-lg border border-border bg-card/60 p-3.5 transition-colors hover:border-foreground/20">
          <div>
            <div className="flex items-center gap-2 text-foreground font-medium text-[13px]">
              <ArticleIcon size={16} className="text-muted-foreground shrink-0" aria-hidden />
              <span>Syndicated News Ingest</span>
            </div>
            <p className="mt-1 text-[11.5px] text-muted-foreground leading-snug">
              Fetches Moneycontrol, Business Standard, and Corporate feeds, deduping stories.
            </p>
          </div>
          <div className="mt-3.5 pt-2 border-t border-border/50">
            <SubmitButton size="sm" variant="secondary" className="w-full text-[12px] h-8" pendingLabel="Ingesting…">
              <ArrowsClockwiseIcon size={12} className="mr-1" aria-hidden />
              Fetch News Now
            </SubmitButton>
            <div className="mt-2 text-[11px]">
              <FormMessage state={newsState} />
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
