import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter, SiteNav } from "@/components/marketing/site-nav";

const DOCS = {
  privacy: {
    title: "Privacy Policy",
    sections: [
      ["What we collect", "Your email, name and (optionally) mobile number; the stocks you add to watchlists, portfolios and alerts; consents you give; payment records; a hash of a random per-browser device id; and counts of which features you use — never which stock you used them on."],
      ["Who can see your financial data", "Only you. Organisation admins can see members' names, emails, plans and feature-usage counts, never holdings, watchlists, alerts or keys. This is enforced by row-level security in our database."],
      ["Secrets", "AI API keys you add are encrypted with AES-256-GCM using a key held outside the database, decrypted only at the moment of a call, and never logged. We show you only a status and the last four characters."],
      ["AI processing", "If you add your own AI key and allow AI processing, prompts are sent to that provider under your account. We record that a call happened (tokens, latency) and never store the prompt or response."],
      ["Retention", "Notifications are kept 90 days; usage and AI-call metrics 12 months. Payment records are kept as tax law requires, without your name after account deletion."],
      ["Your rights", "Export everything you've stored, correct your profile, withdraw any optional consent, or delete your account — all from Settings. Withdrawing AI processing removes your keys."],
    ],
  },
  terms: {
    title: "Terms of Service",
    sections: [
      ["The service", "QuantsPulse provides research tools, end-of-day market data, mechanical rule-based signals and tracking for your own investment decisions."],
      ["Not advice", "Signals are the output of published rules applied uniformly to all stocks. They are not personalised recommendations or investment advice. You are responsible for your decisions."],
      ["Plans", "Plans are per person, per workspace, billed yearly. New accounts start on Basic for three months. Features depend on your active plan."],
      ["Acceptable use", "Don't share accounts, scrape the service, or attempt to access other users' data. One device may be active per account at a time."],
      ["Market data", "Prices are end-of-day NSE candles from Yahoo Finance, refreshed each weekday evening after the close. They can be late, revised or missing; check your broker's contract note before you act on a price."],
    ],
  },
} as const;

export async function generateMetadata({ params }: PageProps<"/legal/[doc]">): Promise<Metadata> {
  const doc = DOCS[(await params).doc as keyof typeof DOCS];
  return { title: doc?.title ?? "Legal" };
}

export default async function LegalPage({ params }: PageProps<"/legal/[doc]">) {
  const doc = DOCS[(await params).doc as keyof typeof DOCS];
  if (!doc) notFound();
  return (
    <div className="linen min-h-dvh">
      <SiteNav signedIn={false} />
      <main className="mx-auto max-w-[760px] px-5 pb-20 pt-10">
        <p className="mb-6 rounded-md border border-coral/50 bg-coral/10 px-4 py-3 text-[13px]">
          Draft for legal review — summarises how the product actually handles data, but isn&apos;t final wording.
        </p>
        <h1 className="display text-[44px] leading-tight">{doc.title}</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">Version 2026-10-01</p>
        <div className="mt-10 flex flex-col gap-8">
          {doc.sections.map(([h, body]) => (
            <section key={h}>
              <h2 className="display text-[22px]">{h}</h2>
              <p className="mt-2 text-[15px] leading-7 text-muted-foreground">{body}</p>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
