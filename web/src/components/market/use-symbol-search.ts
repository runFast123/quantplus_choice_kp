"use client";

import { useEffect, useState } from "react";

export type SymbolHit = {
  symbol: string;
  exchange: string;
  name: string;
  segment: "equity" | "sme" | "etf" | "index";
  last_price: number | string | null;
  change_pct: number | string | null;
};

/** Debounced, cancellable search against /api/symbols (ranked in the database). */
export function useSymbolSearch(query: string, limit = 8) {
  const term = query.trim();
  const [state, setState] = useState<{ term: string; hits: SymbolHit[] }>({ term: "", hits: [] });

  useEffect(() => {
    if (!term) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/symbols?q=${encodeURIComponent(term)}&limit=${limit}`, { signal: ctrl.signal });
        if (res.ok) setState({ term, hits: (await res.json()) as SymbolHit[] });
      } catch {
        // aborted or offline: keep the previous results
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [term, limit]);

  // Keep showing the last results while the next request is in flight.
  return { hits: term ? state.hits : [], pending: !!term && state.term !== term };
}
