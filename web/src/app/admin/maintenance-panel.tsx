"use client";

import { useActionState } from "react";
import {
  ArrowsClockwiseIcon,
  ChartLineUpIcon,
  ArticleIcon,
  BellSimpleRingingIcon,
} from "@phosphor-icons/react";
import { FormMessage } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  fetchNewsNow,
  refreshMarketAnalyticsAction,
  refreshResearchNotesAction,
  runEodNotifierAction,
} from "./actions";

export function MaintenanceOperations() {
  const [newsState, newsAction] = useActionState(fetchNewsNow, undefined);
  const [analyticsState, analyticsAction] = useActionState(refreshMarketAnalyticsAction, undefined);
  const [researchState, researchAction] = useActionState(refreshResearchNotesAction, undefined);
  const [notifierState, notifierAction] = useActionState(runEodNotifierAction, undefined);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {/* 1. Recalculate Signals & Analytics */}
      <form action={analyticsAction} className="flex flex-col justify-between rounded-lg border border-border bg-card/60 p-3.5 transition-colors hover:border-foreground/20">
        <div>
          <div className="flex items-center gap-2 text-foreground font-medium text-[13px]">
            <ChartLineUpIcon size={16} className="text-gain shrink-0" aria-hidden />
            <span>Recalculate Signals</span>
          </div>
          <p className="mt-1 text-[11.5px] text-muted-foreground leading-snug">
            Recomputes Wilder RSI(14), exact SMA 20/50, and generates trading signals over candles.
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
  );
}
