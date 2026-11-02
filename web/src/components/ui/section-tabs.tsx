"use client";

import clsx from "clsx";
import { useEffect, useState, type ReactNode } from "react";

export interface SectionTab {
  /** The panel's id; a link to #id opens this tab. */
  id: string;
  label: ReactNode;
  /** Other #hashes that open this tab (old in-page anchors). */
  aliases?: string[];
  content: ReactNode;
}

/**
 * One section of a long page at a time. The first tab shows on load; a #hash in the URL (or a later hash change)
 * opens the matching tab, and choosing a tab updates the hash so the link can be shared. A panel mounts the first
 * time it is opened and stays mounted, so charts inside measure their real width.
 */
export function SectionTabs({ tabs, label, className }: { tabs: SectionTab[]; label: string; className?: string }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const [seen, setSeen] = useState<Set<string>>(() => new Set(tabs[0] ? [tabs[0].id] : []));

  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      const t = tabs.find((x) => x.id === h || x.aliases?.includes(h));
      if (!t) return;
      setActive(t.id);
      setSeen((s) => (s.has(t.id) ? s : new Set(s).add(t.id)));
      requestAnimationFrame(() => document.getElementById(`tabs-${label}`)?.scrollIntoView({ block: "start" }));
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tabs, label]);

  const open = (id: string) => {
    setActive(id);
    setSeen((s) => (s.has(id) ? s : new Set(s).add(id)));
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <div id={`tabs-${label}`} className={clsx("flex scroll-mt-28 flex-col gap-4", className)}>
      <div role="tablist" aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1 no-scrollbar">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={t.id}
            onClick={() => open(t.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              const i = tabs.findIndex((x) => x.id === active);
              const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
              open(next.id);
              document.getElementById(`tab-${next.id}`)?.focus();
            }}
            tabIndex={active === t.id ? 0 : -1}
            className={clsx(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] transition-colors duration-150",
              active === t.id ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={t.id} aria-labelledby={`tab-${t.id}`} hidden={active !== t.id} className="min-w-0">
          {seen.has(t.id) ? t.content : null}
        </div>
      ))}
    </div>
  );
}
