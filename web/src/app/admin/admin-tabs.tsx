"use client";

import Link, { useLinkStatus } from "next/link";
import { useState } from "react";
import {
  ChartLineUpIcon,
  CreditCardIcon,
  DatabaseIcon,
  NewspaperIcon,
  ShieldCheckIcon,
  SquaresFourIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";

const TABS = [
  { id: "overview", label: "Overview & Operations", icon: SquaresFourIcon },
  { id: "signals", label: "Signals after the close", icon: ChartLineUpIcon },
  { id: "database", label: "Database & Pipelines", icon: DatabaseIcon },
  { id: "accounts", label: "Accounts & Plans", icon: UsersThreeIcon },
  { id: "billing", label: "Financial Ledger", icon: CreditCardIcon },
  { id: "news", label: "News Feeds", icon: NewspaperIcon },
  { id: "audit", label: "Audit & Security", icon: ShieldCheckIcon },
] as const;

/** A fixed-size dot that shows while this tab's page is on its way (no layout shift). */
function Pending() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`size-1.5 rounded-full bg-foreground transition-opacity duration-150 motion-safe:animate-pulse ${pending ? "opacity-70" : "opacity-0"}`}
    />
  );
}

/**
 * The console's tabs. The clicked tab lights up at once (before the server answers) and a dot pulses until it arrives;
 * the tab's content streams in behind a skeleton (page.tsx).
 */
export function AdminTabs({ current, q, users }: { current: string; q: string; users: number }) {
  // The tab the user just clicked, remembered against the tab it was clicked from: once the page moves on, it is stale.
  const [clicked, setClicked] = useState<{ from: string; to: string } | null>(null);
  const active = clicked && clicked.from === current ? clicked.to : current;
  return (
    <nav aria-label="Console sections" className="flex flex-wrap items-center gap-1 border-b border-border pb-1">
      {TABS.map((t) => {
        const Icon = t.icon;
        const on = active === t.id;
        const count = t.id === "accounts" ? users : null;
        return (
          <Link
            key={t.id}
            href={`/admin?tab=${t.id}${q && t.id === "accounts" ? `&q=${encodeURIComponent(q)}` : ""}`}
            aria-current={on ? "page" : undefined}
            onClick={() => setClicked({ from: current, to: t.id })}
            className={`-mb-1 inline-flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-150 ${
              on ? "border-foreground bg-foreground/[0.04] text-foreground" : "border-transparent text-muted-foreground hover:bg-foreground/[0.02] hover:text-foreground"
            }`}
          >
            <Icon size={14} aria-hidden />
            <span>{t.label}</span>
            {count != null ? (
              <span className={`num rounded-full px-1.5 py-0.5 text-[11px] ${on ? "bg-foreground/10 text-foreground" : "bg-muted text-foreground"}`}>
                {count.toLocaleString("en-IN")}
              </span>
            ) : null}
            <Pending />
          </Link>
        );
      })}
    </nav>
  );
}
