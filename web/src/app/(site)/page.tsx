import Link from "next/link";
import type { Metadata } from "next";
import { LegacyHashRedirect } from "@/components/marketing/legacy-hash";
import { DEFINITION, FaqList, MorePages, ORGANIZATION, PrivacyBand } from "@/components/marketing/sections";
import { SignalAnatomy } from "@/components/marketing/signal-anatomy";
import { SITE_URL } from "@/lib/env";
import { ButtonLink } from "@/components/ui/button";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * The home page (ADR-055): the hero, the ticker, a card for each public page, the privacy band and three common
 * questions. The method, the Chrome extension, pricing and the full FAQ each have their own page, so each can rank
 * for its own searches; old /#section links are forwarded there.
 */
const TITLE = "QuantsPulse: rule-based signals for NSE stocks";
const DESCRIPTION =
  "Six published rules check the NSE stocks you follow after every close. Each signal comes with a safety stop, a plan and the rule's tested record. Research, not advice; signals on your broker's chart with the Chrome extension.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { type: "website", title: TITLE, description: DESCRIPTION, url: "/", siteName: "QuantsPulse", locale: "en_IN" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default async function Home({ searchParams }: PageProps<"/">) {
  const supabase = await supabaseServer();
  const [{ data: claims }, sp] = await Promise.all([supabase.auth.getClaims(), searchParams]);
  const signedIn = Boolean(claims?.claims?.sub);

  return (
    <>
      <LegacyHashRedirect />
      {sp.deleted ? (
        <p role="status" className="bg-primary px-5 py-2 text-center text-[13px] text-primary-foreground">
          Your account and personal workspace have been deleted.
        </p>
      ) : null}
      <main>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([
              ORGANIZATION,
              { "@context": "https://schema.org", "@type": "WebSite", "@id": `${SITE_URL}/#site`, name: "QuantsPulse", url: SITE_URL, description: DEFINITION, inLanguage: "en-IN", publisher: { "@id": ORGANIZATION["@id"] } },
            ]).replace(/</g, "\\u003c"),
          }}
        />
        {/* ---------------- Hero ---------------- */}
        <section className="mx-auto grid max-w-[1240px] items-center gap-12 overflow-x-clip px-5 pb-16 pt-10 md:px-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:gap-14 lg:pb-20 lg:pt-16">
          <div>
            <p className="eyebrow hero-in">Research for NSE stocks · updated after every close</p>
            <h1 className="display mt-5 text-[44px] leading-[1.03] text-foreground sm:text-[56px] lg:text-[60px]">
              <span className="hero-in inline-block" style={{ "--d": "80ms" } as React.CSSProperties}>
                NSE stock signals
              </span>{" "}
              <span className="hero-in inline-block" style={{ "--d": "180ms" } as React.CSSProperties}>
                you can <em className="relative whitespace-nowrap">check<Underline /></em>
              </span>{" "}
              <span className="hero-in inline-block lg:whitespace-nowrap" style={{ "--d": "280ms" } as React.CSSProperties}>
                before you trust them.
              </span>
            </h1>
            <p className="hero-in mt-6 max-w-[33rem] text-[17px] leading-8 text-muted-foreground" style={{ "--d": "380ms" } as React.CSSProperties}>
              QuantsPulse runs six published rules on the stocks you follow after every NSE close. Each signal arrives with a safety stop, a plan for when to
              sell, and the rule&apos;s tested record, losing trades included.
            </p>
            <div className="hero-in mt-8 flex flex-wrap items-center gap-3" style={{ "--d": "480ms" } as React.CSSProperties}>
              <ButtonLink href={signedIn ? "/app" : "/signup"} size="lg">
                {signedIn ? "Open the desk" : "Start free for 3 months"}
              </ButtonLink>
              <ButtonLink href="/method" size="lg" variant="secondary">
                See the method
              </ButtonLink>
            </div>
            <p className="mt-4 text-[12.5px] text-muted-foreground">
              No card needed.{" "}
              <Link href="/chrome-extension" className="underline decoration-border underline-offset-4 hover:decoration-foreground">
                Signals on your broker&apos;s chart, with the Chrome extension
              </Link>
              .
            </p>
            <dl className="hero-in mt-10 grid max-w-[33rem] grid-cols-3 gap-4 border-t border-border pt-5" style={{ "--d": "580ms" } as React.CSSProperties}>
              {(
                [
                  ["~3,600", "NSE listings checked each weekday"],
                  ["6", "published rules, each with its record"],
                  ["2019–26", "tested on past prices, after costs"],
                ] as const
              ).map(([n, label]) => (
                <div key={label}>
                  <dt className="sr-only">{label}</dt>
                  <dd className="num text-[24px] leading-none text-foreground">{n}</dd>
                  <dd aria-hidden className="mt-2 text-[12px] leading-5 text-muted-foreground">
                    {label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="hero-in" style={{ "--d": "160ms" } as React.CSSProperties}>
            <SignalAnatomy />
          </div>
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
    </>
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
