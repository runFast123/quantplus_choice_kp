"use client";

import clsx from "clsx";
import { useSyncExternalStore } from "react";
import { nextEodUpdate, nseSession } from "@/lib/market";

// A minute-resolution clock shared by every subscriber. The snapshot only
// changes when the minute does, so React re-renders at most once a minute.
let snapshot = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function tick() {
  const minute = Math.floor(Date.now() / 60_000);
  if (minute !== snapshot) {
    snapshot = minute;
    listeners.forEach((l) => l());
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    tick();
    timer = setInterval(tick, 15_000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const getSnapshot = () => snapshot || Math.floor(Date.now() / 60_000);
const getServerSnapshot = () => 0;

/** `asOf`: the latest close on screen. Prices are end-of-day (ADR-026), so say which day and when the next one lands. */
export function MarketClock({ asOf }: { asOf?: string | null }) {
  const minute = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Server render has no clock: reserve the space to avoid a layout shift.
  if (!minute) return <span className="hidden h-5 w-[190px] lg:inline-block" />;

  const now = new Date(minute * 60_000);
  const s = nseSession(now);
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  return (
    <span className="hidden items-center gap-2 text-[12px] text-muted-foreground lg:inline-flex">
      <span className="relative flex size-2 items-center justify-center shrink-0" aria-hidden>
        {s.state === "open" ? (
          <span className="absolute inline-flex size-full animate-ping-soft rounded-full bg-gain/60" />
        ) : s.state === "pre-open" ? (
          <span className="absolute inline-flex size-full animate-ping-soft rounded-full bg-coral/60" />
        ) : null}
        <span
          className={clsx(
            "relative size-1.5 rounded-full transition-colors duration-300",
            s.state === "open" ? "bg-gain" : s.state === "pre-open" ? "bg-coral" : "bg-muted-foreground/60"
          )}
        />
      </span>
      <span className="text-foreground font-medium">NSE</span>
      <span>{s.label}</span>
      <span className="num">{time} IST</span>
      {asOf ? <Freshness asOf={asOf} now={now} /> : null}
    </span>
  );
}

function Freshness({ asOf, now }: { asOf: string; now: Date }) {
  const day = (d: Date | string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  const next = nextEodUpdate(now);
  const nextDay = new Date(`${next.isoDate}T12:00:00+05:30`);
  const when = next.isToday ? "today" : nextDay.toLocaleDateString("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" });
  return (
    <span
      className="num ml-1 rounded border border-border px-1.5 py-0.5 text-[11px]"
      title={`Prices are end-of-day closes from ${day(asOf)}, not live. The next update lands around 17:00 IST ${next.isToday ? "today" : `on ${day(nextDay)}`}.`}
    >
      EOD {day(asOf)} · next {when} 17:00
    </span>
  );
}
