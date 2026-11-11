import Link from "next/link";
import { HeroScene } from "@/components/marketing/hero-scene";
import { LegacyHashRedirect } from "@/components/marketing/legacy-hash";
import { FaqList, MorePages, PrivacyBand } from "@/components/marketing/sections";
import { SiteFooter, SiteNav } from "@/components/marketing/site-nav";
import { ButtonLink } from "@/components/ui/button";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * The home page (ADR-055): the hero, the ticker, a card for each public page, the privacy band and three common
 * questions. How it works, the Chrome extension, pricing and the full FAQ each have their own page, so each can rank
 * for its own searches; old /#section links are forwarded there.
 */
export default async function Home({ searchParams }: PageProps<"/">) {
  const supabase = await supabaseServer();
  const [{ data: claims }, sp] = await Promise.all([supabase.auth.getClaims(), searchParams]);
  const signedIn = Boolean(claims?.claims?.sub);

  return (
    <div className="linen min-h-dvh">
      <LegacyHashRedirect />
      {sp.deleted ? (
        <p role="status" className="bg-primary px-5 py-2 text-center text-[13px] text-primary-foreground">
          Your account and personal workspace have been deleted.
        </p>
      ) : null}
      <SiteNav signedIn={signedIn} />

      <main>
        {/* ---------------- Hero ---------------- */}
        <section className="mx-auto grid max-w-[1240px] gap-14 overflow-x-clip px-5 pb-20 pt-10 md:px-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:pt-20">
          <div>
            <p className="eyebrow hero-in">For people who research Indian stocks themselves</p>
            <h1 className="display mt-5 text-[46px] leading-[1.02] text-foreground sm:text-[60px] lg:text-[72px]">
              <span className="hero-in inline-block" style={{ "--d": "80ms" } as React.CSSProperties}>
                Research on rules
              </span>{" "}
              <br className="hidden sm:block" />
              <span className="hero-in inline-block" style={{ "--d": "200ms" } as React.CSSProperties}>
                you can <em className="relative whitespace-nowrap">read<Underline /></em>.
              </span>
            </h1>
            <p className="hero-in mt-6 max-w-[34rem] text-[17px] leading-8 text-muted-foreground" style={{ "--d": "320ms" } as React.CSSProperties}>
              Keep a radar of the stocks you&apos;re waiting on. QuantsPulse checks each one against six published rules after every close — four trend rules
              (one of them for a long slump that is starting to turn up) and two that buy a sharp dip in a rising stock — plus the price levels you set, and can
              show the signals right on your broker&apos;s chart with our Chrome extension.
            </p>
            <div className="hero-in mt-8 flex flex-wrap items-center gap-3" style={{ "--d": "440ms" } as React.CSSProperties}>
              <ButtonLink href={signedIn ? "/app" : "/signup"} size="lg">
                {signedIn ? "Open the desk" : "Start free for 3 months"}
              </ButtonLink>
              <ButtonLink href="/chrome-extension" size="lg" variant="secondary">
                Chrome extension
              </ButtonLink>
              <ButtonLink href="/how-it-works" size="lg" variant="secondary">
                See how it works
              </ButtonLink>
            </div>
            <p className="mt-4 text-[12.5px] text-muted-foreground">No card needed. Basic covers a 10-stock radar, rule-based signals, and research on every listing.</p>
          </div>

          <HeroScene />
        </section>

        {/* ---------------- Dateline: a slow ticker (static with "reduce motion") ---------------- */}
        <div className="overflow-hidden border-y border-border bg-card/70" data-ticker>
          <p className="sr-only">{DATELINE.join(" / ")}</p>
          <div className="animate-marquee flex w-max" aria-hidden>
            {[0, 1].map((copy) => (
              <p key={copy} className="num flex shrink-0 items-center gap-x-6 py-3 pr-6 text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
                {DATELINE.map((t) => (
                  <span key={t} className="flex items-center gap-6">
                    <span>{t}</span>
                    <span className="text-coral-ink">/</span>
                  </span>
                ))}
              </p>
            ))}
          </div>
        </div>

        {/* ---------------- One page each ---------------- */}
        <section aria-labelledby="explore" className="mx-auto max-w-[1240px] px-5 py-24 md:px-8">
          <div className="reveal grid gap-4 md:grid-cols-[220px_1fr]">
            <p className="eyebrow pt-3">Start here</p>
            <h2 id="explore" className="display max-w-[22ch] text-[36px] leading-[1.1] md:text-[44px]">
              What&apos;s inside, one page each.
            </h2>
          </div>
          <div className="mt-12">
            <MorePages />
          </div>
        </section>

        <PrivacyBand />

        {/* ---------------- A few questions; the rest on /faq ---------------- */}
        <section aria-labelledby="questions" className="mx-auto max-w-[1240px] px-5 py-24 md:px-8">
          <div className="reveal grid gap-4 md:grid-cols-[220px_1fr]">
            <p className="eyebrow pt-3">Questions</p>
            <div>
              <h2 id="questions" className="sr-only">
                Common questions
              </h2>
              <FaqList limit={3} />
              <Link href="/faq" className="mt-6 inline-block text-[14px] font-medium underline decoration-border underline-offset-4 hover:decoration-foreground">
                All questions and answers
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

const DATELINE = [
  "3,600+ NSE listings",
  "Updated each weekday ~17:00 IST",
  "Six published rules",
  "Chrome extension for 20+ brokers",
  "TradingView charts",
  "Holdings import from CSV",
  "Plain-words price mood",
  "Prices in ₹, times in IST",
];

function Underline() {
  return (
    <svg viewBox="0 0 200 14" preserveAspectRatio="none" className="absolute -bottom-1 left-0 h-3 w-full text-coral" aria-hidden>
      <path d="M2 9 C 40 3, 80 12, 120 6 S 180 4, 198 8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export const dynamic = "force-dynamic";
