import clsx from "clsx";
import Link from "next/link";

/**
 * Mark: a ledger rule broken by one pulse — research that waits for a signal.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={clsx("size-7", className)} aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="7" className="fill-primary" />
      <path
        d="M6 18.5h6.2l2.1-7.5 3.4 11 2.3-6.2 1.3 2.7H26"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-primary-foreground"
      />
      <circle cx="26" cy="18.5" r="2.2" className="fill-coral" />
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
