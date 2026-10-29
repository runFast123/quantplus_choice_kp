import clsx from "clsx";
import Link from "next/link";

/**
 * Mark: a Q whose tail ends in the signal — the one moment a published rule fires.
 * Same geometry as app/icon.svg and the extension icons (scripts/brand-icons.mts).
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={clsx("size-7", className)} aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="7" className="fill-primary" />
      <circle cx="14.5" cy="14.5" r="7.2" fill="none" strokeWidth="2.6" className="stroke-primary-foreground" />
      <path d="M16.6 16.6L22.2 22.2" strokeWidth="2.6" strokeLinecap="round" className="stroke-primary-foreground" />
      <circle cx="24.5" cy="24.5" r="2.7" className="fill-coral" />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={clsx("inline-flex items-center gap-2.5 rounded-md", className)} aria-label="QuantsPulse home">
      <LogoMark />
      <span className="display text-[19px] leading-none text-foreground">
        Quants<span className="italic">Pulse</span>
      </span>
    </Link>
  );
}
