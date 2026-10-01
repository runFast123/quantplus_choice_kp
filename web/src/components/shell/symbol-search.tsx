"use client";

import clsx from "clsx";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

type Sym = { symbol: string; name: string; exchange: string };

/** Ticker/company search. "/" focuses it from anywhere. */
export function SymbolSearch({ symbols }: { symbols: Sym[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);

  const results = useMemo(() => {
    const term = q.trim().toUpperCase();
    if (!term) return [];
    const starts = symbols.filter((s) => s.symbol.startsWith(term));
    const contains = symbols.filter(
      (s) => !s.symbol.startsWith(term) && (s.symbol.includes(term) || s.name.toUpperCase().includes(term)),
    );
    return [...starts, ...contains].slice(0, 8);
  }, [q, symbols]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const go = (s: Sym) => {
    setQ("");
    setOpen(false);
    inputRef.current?.blur();
    router.push(`/app/markets/${encodeURIComponent(s.symbol)}`);
  };

  return (
    <div className="relative w-full max-w-[340px]">
      <MagnifyingGlassIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[cursor] ? `${listId}-${cursor}` : undefined}
        aria-label="Search stocks"
        placeholder="Search NSE stocks"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setCursor(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor((c) => Math.max(0, Math.min(c + 1, results.length - 1)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (e.key === "Enter" && results[cursor]) {
            e.preventDefault();
            go(results[cursor]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="h-9 w-full rounded-md border border-border bg-card pl-8 pr-9 text-[13px] placeholder:text-muted-foreground/80 focus:border-foreground focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      <kbd className="num pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 text-[10px] text-muted-foreground sm:block">
        /
      </kbd>
      {open && results.length > 0 ? (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-11 z-40 rounded-lg border border-border bg-popover p-1 shadow-pop">
          {results.map((s, i) => (
            <li
              key={s.exchange + s.symbol}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === cursor}
              onMouseDown={(e) => {
                e.preventDefault();
                go(s);
              }}
              onMouseEnter={() => setCursor(i)}
              className={clsx("flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2", i === cursor && "bg-foreground/[0.06]")}
            >
              <span className="num w-[92px] shrink-0 text-[12.5px] font-medium">{s.symbol}</span>
              <span className="flex-1 truncate text-[12.5px] text-muted-foreground">{s.name}</span>
              <span className="text-[10px] text-muted-foreground">{s.exchange}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
