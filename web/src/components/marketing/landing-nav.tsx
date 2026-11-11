"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ListNumbersIcon, NotebookIcon, PuzzlePieceIcon, QuestionIcon, TagIcon } from "@phosphor-icons/react";
import { LiquidNavbar, type LiquidNavItem } from "@/components/ui/liquid-glass-navbar";

/**
 * The landing page's floating liquid-glass navbar (ADR-054: the one place glass is allowed). The drop follows the
 * section you are reading; after a click it stays on the clicked section while the page scrolls there. Full labels on
 * wide screens, icons only below 1280 px so it never runs into the logo or the sign-in buttons; hidden on phones, where
 * the header shows the logo and the account buttons only (as before).
 */
const SECTIONS = ["how", "terminal", "pricing", "faq"] as const;
const ITEMS: LiquidNavItem[] = [
  { label: "How it works", href: "/#how", icon: <ListNumbersIcon size={18} />, fx: "glow" },
  { label: "Chrome extension", href: "/#terminal", icon: <PuzzlePieceIcon size={18} />, fx: "spin" },
  { label: "Pricing", href: "/#pricing", icon: <TagIcon size={18} />, fx: "pop" },
  { label: "Questions", href: "/#faq", icon: <QuestionIcon size={18} />, fx: "wave" },
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
  const [active, setActive] = useState(-1);
  const tone = useSyncExternalStore(
    subscribeTheme,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => "light" as const,
  );
  const compact = useSyncExternalStore(subscribeWide, () => !window.matchMedia("(min-width: 1280px)").matches, () => true);
  const lockUntil = useRef(0);

  useEffect(() => {
    const els = SECTIONS.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => e !== null);
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        if (Date.now() < lockUntil.current) return;
        setActive(SECTIONS.findIndex((id) => seen.get(id)));
      },
      // a section counts while it crosses the middle band of the screen
      { rootMargin: "-45% 0px -50% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  return (
    <LiquidNavbar
      items={ITEMS}
      active={active}
      onChange={(i) => {
        if (i < SECTIONS.length) {
          setActive(i);
          lockUntil.current = Date.now() + 1000;
        }
      }}
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
