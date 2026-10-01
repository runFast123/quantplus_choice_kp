"use client";

import clsx from "clsx";
import { useSyncExternalStore } from "react";
import { nseSession } from "@/lib/market";

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

export function MarketClock() {
  const minute = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Server render has no clock: reserve the space to avoid a layout shift.
  if (!minute) return <span className="hidden h-5 w-[190px] lg:inline-block" />;

  const now = new Date(minute * 60_000);
  const s = nseSession(now);
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  return (
    <span className="hidden items-center gap-2 text-[12px] text-muted-foreground lg:inline-flex">
      <span
        className={clsx("size-1.5 rounded-full", s.state === "open" ? "bg-gain" : s.state === "pre-open" ? "bg-coral" : "bg-muted-foreground/60")}
        aria-hidden
      />
      <span className="text-foreground">NSE</span>
      <span>{s.label}</span>
      <span className="num">{time} IST</span>
    </span>
  );
}
