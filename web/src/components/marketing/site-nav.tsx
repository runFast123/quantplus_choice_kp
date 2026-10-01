import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";

export function SiteNav({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-5 md:px-8">
      <Logo />
      <nav aria-label="Site" className="hidden items-center gap-7 text-[13.5px] text-muted-foreground md:flex">
        <Link href="/#how" className="hover:text-foreground">
          How it works
        </Link>
        <Link href="/#privacy" className="hover:text-foreground">
          Privacy
        </Link>
        <Link href="/#pricing" className="hover:text-foreground">
          Pricing
        </Link>
        <Link href="/#faq" className="hover:text-foreground">
          Questions
        </Link>
      </nav>
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
      <div className="mx-auto grid max-w-[1240px] gap-8 px-5 py-10 md:grid-cols-[1fr_auto] md:px-8">
        <div className="max-w-xl">
          <Logo />
          <p className="mt-4 text-[12px] leading-5 text-muted-foreground">
            QuantsPulse publishes the mechanical output of documented rules and tools to track your own decisions. Signals are not personalised recommendations
            and nothing here is investment advice. Investments in securities are subject to market risks; read all related documents carefully before investing.
            Past performance of a rule does not indicate future returns.
          </p>
        </div>
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
