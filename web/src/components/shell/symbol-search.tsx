"use client";

import clsx from "clsx";
import {
  BinocularsIcon,
  BriefcaseIcon,
  ChartLineUpIcon,
  FlaskIcon,
  LightningIcon,
  MagnifyingGlassIcon,
  NotebookIcon,
  PlugsIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useSymbolSearch } from "@/components/market/use-symbol-search";
import { price } from "@/lib/format";
import { SEGMENT_LABEL } from "@/lib/market";

interface QuickLink {
  href: string;
  label: string;
  sub: string;
  icon: typeof ChartLineUpIcon;
  badge?: string;
}

const QUICK_BENCHMARKS = [
  { symbol: "NIFTY", name: "Nifty 50 Index", segment: "index" },
  { symbol: "BANKNIFTY", name: "Nifty Bank Index", segment: "index" },
  { symbol: "NIFTYFINSERV", name: "Nifty Financial Services", segment: "index" },
  { symbol: "RELIANCE", name: "Reliance Industries", segment: "equity" },
  { symbol: "TCS", name: "Tata Consultancy Services", segment: "equity" },
  { symbol: "HDFCBANK", name: "HDFC Bank Limited", segment: "equity" },
];

const QUICK_NAV: QuickLink[] = [
  { href: "/app/watchlist", label: "Market Radar", sub: "Watchlists & alerts", icon: BinocularsIcon },
  { href: "/app/signals", label: "Signals Desk", sub: "Active rule triggers", icon: LightningIcon },
  { href: "/app/dry-run", label: "Dry Run", sub: "Try a plan on past prices", icon: FlaskIcon },
  { href: "/app/portfolio", label: "Portfolio", sub: "Holdings & P&L", icon: BriefcaseIcon },
  { href: "/app/research", label: "Research Desk", sub: "Stances & factor scores", icon: NotebookIcon },
  { href: "/app/integrations", label: "Integrations & Terminal", sub: "Chrome extension & TV", icon: PlugsIcon },
];

const noopSubscribe = () => () => {};
const getIsMacSnapshot = () => /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);
const getIsMacServerSnapshot = () => false;

/** Ticker/company search & command palette across covered symbols. "/" or "Ctrl+K" / "Cmd+K" opens it. */
export function SymbolSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const isMac = useSyncExternalStore(noopSubscribe, getIsMacSnapshot, getIsMacServerSnapshot);
  const { hits: results, pending } = useSymbolSearch(q, 8);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!inputRef.current || inputRef.current.offsetParent === null) return;
      const t = e.target as HTMLElement;
      const isInput = ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable;
      if (
        (e.key === "/" && !isInput) ||
        ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey))
      ) {
        e.preventDefault();
        inputRef.current.focus();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const isQuickPalette = q.trim() === "";
  const totalItems = isQuickPalette ? QUICK_BENCHMARKS.length + QUICK_NAV.length : results.length;

  const goSymbol = (sym: string) => {
    setQ("");
    setOpen(false);
    inputRef.current?.blur();
    router.push(`/app/markets/${encodeURIComponent(sym)}`);
  };

  const goRoute = (href: string) => {
    setQ("");
    setOpen(false);
    inputRef.current?.blur();
    router.push(href);
  };

  const handleSelectCursor = (idx: number) => {
    if (isQuickPalette) {
      if (idx < QUICK_BENCHMARKS.length) {
        goSymbol(QUICK_BENCHMARKS[idx].symbol);
      } else {
        const navIdx = idx - QUICK_BENCHMARKS.length;
        if (QUICK_NAV[navIdx]) goRoute(QUICK_NAV[navIdx].href);
      }
    } else if (results[idx]) {
      goSymbol(results[idx].symbol);
    }
  };

  return (
    <div className="relative w-full max-w-[340px]">
      <MagnifyingGlassIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-busy={pending || undefined}
        aria-activedescendant={open && totalItems > 0 ? `${listId}-${cursor}` : undefined}
        aria-label="Search stocks or jump to desk"
        placeholder="Search NSE stocks or jump to desk…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setCursor(0);
        }}
        onFocus={() => {
          setOpen(true);
          setCursor(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor((c) => Math.max(0, Math.min(c + 1, totalItems - 1)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            handleSelectCursor(cursor);
          } else if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        className="h-9 w-full rounded-md border border-border bg-card pl-8 pr-12 text-[13px] placeholder:text-muted-foreground/80 focus:border-foreground focus:outline-none transition-colors [&::-webkit-search-cancel-button]:hidden"
      />
      <kbd className="num pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded border border-border px-1.5 text-[10px] text-muted-foreground sm:inline-flex">
        <span>{isMac ? "⌘" : "Ctrl"}</span>
        <span>K</span>
      </kbd>

      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-11 z-50 max-h-[380px] overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-pop animate-fade-in"
        >
          {isQuickPalette ? (
            <div className="flex flex-col gap-2 p-1">
              {/* Quick Benchmarks */}
              <div>
                <p className="eyebrow px-2 py-1 text-[10.5px]">Top Benchmarks & Equities</p>
                <div className="grid grid-cols-2 gap-1 mt-0.5">
                  {QUICK_BENCHMARKS.map((b, i) => {
                    const isSelected = cursor === i;
                    return (
                      <button
                        key={b.symbol}
                        id={`${listId}-${i}`}
                        role="option"
                        aria-selected={isSelected}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          goSymbol(b.symbol);
                        }}
                        onMouseEnter={() => setCursor(i)}
                        className={clsx(
                          "flex items-center justify-between rounded px-2.5 py-1.5 text-left transition-colors",
                          isSelected ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]",
                        )}
                      >
                        <div className="min-w-0">
                          <span className="num block text-[12px] font-semibold text-foreground">{b.symbol}</span>
                          <span className="block truncate text-[10.5px] text-muted-foreground">{b.name}</span>
                        </div>
                        {b.segment === "index" && (
                          <span className="num shrink-0 rounded border border-border px-1 text-[9.5px] text-muted-foreground uppercase">IDX</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quick Navigation Links */}
              <div className="border-t border-border pt-1.5">
                <p className="eyebrow px-2 py-1 text-[10.5px]">Desk Shortcuts</p>
                <ul className="flex flex-col gap-0.5 mt-0.5">
                  {QUICK_NAV.map((nav, i) => {
                    const actualIdx = QUICK_BENCHMARKS.length + i;
                    const isSelected = cursor === actualIdx;
                    const Icon = nav.icon;
                    return (
                      <li key={nav.href} role="presentation">
                        <button
                          id={`${listId}-${actualIdx}`}
                          role="option"
                          aria-selected={isSelected}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            goRoute(nav.href);
                          }}
                          onMouseEnter={() => setCursor(actualIdx)}
                          className={clsx(
                            "flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left transition-colors",
                            isSelected ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]",
                          )}
                        >
                          <Icon size={14} className="text-muted-foreground shrink-0" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <span className="text-[12px] font-medium text-foreground">{nav.label}</span>
                            <span className="ml-2 text-[11px] text-muted-foreground">{nav.sub}</span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ) : results.length > 0 ? (
            <ul>
              {results.map((s, i) => (
                <li
                  key={s.exchange + s.symbol}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === cursor}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    goSymbol(s.symbol);
                  }}
                  onMouseEnter={() => setCursor(i)}
                  className={clsx("flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 transition-colors", i === cursor && "bg-foreground/[0.06]")}
                >
                  <span className="num w-[92px] shrink-0 truncate text-[12.5px] font-medium text-foreground">{s.symbol}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">{s.name}</span>
                  {s.segment !== "equity" ? (
                    <span className="shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground">{SEGMENT_LABEL[s.segment]}</span>
                  ) : null}
                  <span className="num shrink-0 text-[11.5px] text-muted-foreground">{s.last_price != null ? price(Number(s.last_price)) : ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-4 text-center text-[12.5px] text-muted-foreground">
              {pending ? "Searching market universe…" : `No symbol matching "${q}"`}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

