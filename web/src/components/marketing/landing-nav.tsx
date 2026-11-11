"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { ListNumbersIcon, NotebookIcon, PuzzlePieceIcon, QuestionIcon, TagIcon } from "@phosphor-icons/react";
import { LiquidNavbar, type LiquidNavItem } from "@/components/ui/liquid-glass-navbar";

/**
 * The public site's floating liquid-glass navbar (ADR-054: glass is allowed on the public pages only). Each item is
 * its own page (ADR-055), and the drop sits on the page you are on, read from the URL; on the home page no item is
 * lit. Full labels on wide screens, icons only below 1280 px so it never runs into the logo or the sign-in buttons;
 * hidden on phones, where the header shows the logo and the account buttons and the footer lists the pages.
 */
const ITEMS: LiquidNavItem[] = [
  { label: "How it works", href: "/how-it-works", icon: <ListNumbersIcon size={18} />, fx: "glow" },
  { label: "Chrome extension", href: "/chrome-extension", icon: <PuzzlePieceIcon size={18} />, fx: "spin" },
  { label: "Pricing", href: "/pricing", icon: <TagIcon size={18} />, fx: "pop" },
  { label: "Questions", href: "/faq", icon: <QuestionIcon size={18} />, fx: "wave" },
  { label: "Research", href: "/blog", icon: <NotebookIcon size={18} />, fx: "plane" },
];

// The theme is the <html> class (set from the qp_theme cookie); full labels from 1280 px.
const subscribeTheme = (cb: () => void) => {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
};
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia("(min-width: 1280px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export function LandingNav() {
  const path = usePathname();
  const active = ITEMS.findIndex((p) => p.href && (path === p.href || path.startsWith(`${p.href}/`)));
  const tone = useSyncExternalStore(
    subscribeTheme,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => "light" as const,
  );
  const compact = useSyncExternalStore(subscribeWide, () => !window.matchMedia("(min-width: 1280px)").matches, () => true);

  return (
    <LiquidNavbar
      items={ITEMS}
      active={active}
      tone={tone}
      compact={compact}
      ariaLabel="Site"
      // Ink from the theme; the glass is tinted with the page background (80 %) so the labels stay readable over the
      // dark Privacy band and busy text, in both themes.
      style={
        {
          "--n-fg": "var(--foreground)",
          "--n-fg-soft": "var(--muted-foreground)",
          "--n-tint": "color-mix(in oklab, var(--background) 80%, transparent)",
        } as React.CSSProperties
      }
    />
  );
}
