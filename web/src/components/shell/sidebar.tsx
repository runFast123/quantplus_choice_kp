"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BellRingingIcon,
  BinocularsIcon,
  BriefcaseIcon,
  ChartLineUpIcon,
  CreditCardIcon,
  GearSixIcon,
  LightningIcon,
  NewspaperIcon,
  NotebookIcon,
  PlugsIcon,
  ShieldCheckIcon,
  SquaresFourIcon,
  UsersThreeIcon,
  type Icon,
} from "@phosphor-icons/react";
import { Logo } from "@/components/brand/logo";

type Item = { href: string; label: string; icon: Icon; locked?: boolean; exact?: boolean };

export function Sidebar({
  locked,
  isPlatformAdmin,
  planLabel,
}: {
  locked: { portfolio: boolean; alerts: boolean };
  isPlatformAdmin: boolean;
  planLabel: string;
}) {
  const pathname = usePathname();
  const research: Item[] = [
    { href: "/app", label: "Overview", icon: SquaresFourIcon, exact: true },
    { href: "/app/markets", label: "Markets", icon: ChartLineUpIcon },
    { href: "/app/watchlist", label: "Market Radar", icon: BinocularsIcon },
    { href: "/app/portfolio", label: "Portfolio", icon: BriefcaseIcon, locked: locked.portfolio },
    { href: "/app/alerts", label: "Alerts", icon: BellRingingIcon, locked: locked.alerts },
    { href: "/app/signals", label: "Signals", icon: LightningIcon },
    { href: "/app/research", label: "Research", icon: NotebookIcon },
    { href: "/app/news", label: "News", icon: NewspaperIcon },
  ];
  const account: Item[] = [
    { href: "/app/workspace", label: "Workspace", icon: UsersThreeIcon },
    { href: "/app/integrations", label: "Integrations", icon: PlugsIcon },
    { href: "/app/billing", label: "Plan & billing", icon: CreditCardIcon },
    { href: "/app/settings", label: "Settings", icon: GearSixIcon },
    ...(isPlatformAdmin ? [{ href: "/admin", label: "Platform admin", icon: ShieldCheckIcon }] : []),
  ];

  const isActive = (i: Item) => (i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(i.href + "/"));

  const renderItem = (i: Item) => {
    const active = isActive(i);
    const Icon = i.icon;
    return (
      <li key={i.href}>
        <Link
          href={i.href}
          aria-current={active ? "page" : undefined}
          className={clsx(
            "group flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors duration-150",
            active
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/80 hover:bg-foreground/[0.06] hover:text-sidebar-foreground",
          )}
        >
          <Icon size={17} weight={active ? "fill" : "regular"} aria-hidden />
          <span className="flex-1 truncate">{i.label}</span>
          {i.locked ? (
            <span
              className={clsx(
                "rounded-[3px] px-1 text-[10px] font-semibold uppercase tracking-wider",
                active ? "bg-sidebar-primary-foreground/15" : "bg-foreground/[0.07] text-foreground",
              )}
            >
              Pro
            </span>
          ) : null}
        </Link>
      </li>
    );
  };

  return (
    <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex h-[52px] items-center px-4">
        <Logo href="/app" />
      </div>
      <nav aria-label="Primary" className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 pb-4 pt-3">
        <div>
          <p className="eyebrow mb-1.5 px-2.5">Research</p>
          <ul className="flex flex-col gap-0.5">{research.map(renderItem)}</ul>
        </div>
        <div>
          <p className="eyebrow mb-1.5 px-2.5">Account</p>
          <ul className="flex flex-col gap-0.5">{account.map(renderItem)}</ul>
        </div>
      </nav>
      <div className="m-3 rounded-md border border-sidebar-border px-3 py-2.5">
        <p className="eyebrow">Plan</p>
        <p className="mt-0.5 text-[13px] text-sidebar-foreground">{planLabel}</p>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const items: Item[] = [
    { href: "/app", label: "Overview", icon: SquaresFourIcon, exact: true },
    { href: "/app/markets", label: "Markets", icon: ChartLineUpIcon },
    { href: "/app/watchlist", label: "Radar", icon: BinocularsIcon },
    { href: "/app/portfolio", label: "Portfolio", icon: BriefcaseIcon },
    { href: "/app/settings", label: "Account", icon: GearSixIcon },
  ];
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items.map((i) => {
        const active = i.exact ? pathname === i.href : pathname.startsWith(i.href);
        const Icon = i.icon;
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]",
              active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <Icon size={20} weight={active ? "fill" : "regular"} aria-hidden />
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
