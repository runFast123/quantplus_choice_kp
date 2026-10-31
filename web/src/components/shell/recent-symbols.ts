"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * The last few stocks this viewer opened, for the search box. A per-browser convenience kept in
 * localStorage (never sent anywhere); it reads as empty wherever storage is blocked.
 */
export type RecentSymbol = { symbol: string; name: string; segment: string };

const KEY = "qp:recent-symbols";
const MAX = 6;
const EMPTY: RecentSymbol[] = [];
const listeners = new Set<() => void>();
let cache: { raw: string | null; list: RecentSymbol[] } = { raw: null, list: EMPTY };

function read(): RecentSymbol[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cache.raw) return cache.list;
  let list = EMPTY;
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) list = parsed.filter((r) => r && typeof r.symbol === "string").slice(0, MAX);
  } catch {
    // a damaged value reads as no history
  }
  cache = { raw, list };
  return list;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => e.key === KEY && cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useRecentSymbols(): RecentSymbol[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function rememberSymbol(entry: RecentSymbol) {
  const next = [entry, ...read().filter((r) => r.symbol !== entry.symbol)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    return;
  }
  listeners.forEach((cb) => cb());
}

/** Rendered on a stock page: records the visit so the search box can offer it again. */
export function RememberSymbol(props: RecentSymbol) {
  const { symbol, name, segment } = props;
  useEffect(() => rememberSymbol({ symbol, name, segment }), [symbol, name, segment]);
  return null;
}
