import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { LandingNav } from "./landing-nav";

/** The public pages, in nav order (ADR-055): the footer lists them too, for phones and for crawlers. */
export const SITE_PAGES = [
  ["Method", "/method"],
  ["Chrome extension", "/chrome-extension"],
  ["Pricing", "/pricing"],
  ["Questions", "/faq"],
  ["Research notes", "/blog"],
] as const;

export function SiteNav({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-5 md:px-8">
      <Logo />
      {/* a floating liquid-glass pill that stays at the top while you scroll (ADR-054), from md up */}
      <div className="fixed left-1/2 top-[5px] z-40 hidden -translate-x-1/2 md:block">
        <LandingNav />
      </div>
      <div className="flex items-center gap-2">
        {signedIn ? (
          <ButtonLink href="/app" size="sm">
            Open the desk
          </ButtonLink>
        ) : (
          <>
            <ButtonLink href="/login" size="sm" variant="ghost">
              Sign in
            </ButtonLink>
            <ButtonLink href="/signup" size="sm">
              Open an account
            </ButtonLink>
          </>
        )}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-[1240px] gap-8 px-5 py-10 md:grid-cols-[1fr_auto_auto] md:gap-14 md:px-8">
        <div className="max-w-xl">
          <Logo />
          <p className="mt-4 text-[12px] leading-5 text-muted-foreground">
            QuantsPulse publishes the mechanical output of documented rules and tools to track your own decisions. Signals are not personalised recommendations
            and nothing here is investment advice. Investments in securities are subject to market risks; read all related documents carefully before investing.
            Past performance of a rule does not indicate future returns.
          </p>
        </div>
        <nav aria-label="Pages" className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted-foreground md:flex-col md:gap-2">
          {SITE_PAGES.map(([label, href]) => (
            <Link key={href} href={href} className="hover:text-foreground">
              {label}
            </Link>
          ))}
        </nav>
        <nav aria-label="Legal" className="flex gap-6 text-[13px] text-muted-foreground md:flex-col md:gap-2">
          <Link href="/legal/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link href="/legal/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/login" className="hover:text-foreground">
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  );
}
