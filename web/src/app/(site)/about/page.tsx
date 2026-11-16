import type { Metadata } from "next";
import Link from "next/link";
import { DEFINITION, JsonLd, MorePages, ORGANIZATION, PageHead } from "@/components/marketing/sections";
import { SITE_URL } from "@/lib/env";

const TITLE = "About QuantsPulse: how every rule is tested";
const DESCRIPTION =
  "What QuantsPulse is, how each of its six rules is tested on NSE prices (the stocks, the years, the costs, the yardsticks), where the data comes from, and what it does not do.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/about" },
  openGraph: { type: "website", title: TITLE, description: DESCRIPTION, url: "/about", siteName: "QuantsPulse", locale: "en_IN" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// How a rule is tested, in the order it happens. Each line is a house rule of research/strategies (README there).
const TESTING: [string, string][] = [
  ["The same stocks for everyone", "Each year's 300 most traded NSE stocks, picked from what was known at the time, so today's winners are not chosen with hindsight."],
  ["Seven years of prices", "July 2019 to 2026, which includes the 2020 crash and the recovery after it."],
  ["Costs taken off", "Every trade pays 0.5% for the round trip. A result is only called a gain if it is above zero after that."],
  ["Chosen on one period, checked on another", "A rule's settings are picked on 2019 to 2023 and then run untouched on 2024 to 2026. Both results are shown."],
  ["Measured against a yardstick", "Each rule is compared with random entries in the same stocks and with the usual way of using its indicator."],
  ["Losing trades stay in", "No signal is dropped from a record. The research notes show the years and measures where the usual way did better."],
];

const NOT: [string, string][] = [
  ["No advice", "A signal is the output of a written rule, the same for every stock. It knows nothing about your money or your goals."],
  ["No orders", "QuantsPulse has no connection to any broker. You place any order yourself."],
  ["No live prices", "Prices are end-of-day closes. Nothing here updates during market hours."],
  ["No promises", "Results are tested on past prices. They say what happened, not what will."],
];

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-[1240px] px-5 pb-24 pt-10 md:px-8 md:pt-16">
      <JsonLd
        name="About"
        path="/about"
        extra={[
          { "@context": "https://schema.org", "@type": "AboutPage", url: `${SITE_URL}/about`, name: TITLE, description: DESCRIPTION, about: { "@id": ORGANIZATION["@id"] } },
          ORGANIZATION,
        ]}
      />
      <PageHead eyebrow="About" title="Research you can check, from people who show their working." lead={DEFINITION} />

      <section aria-labelledby="how-tested" className="mt-20 grid gap-4 md:grid-cols-[220px_1fr]">
        <p className="eyebrow pt-3">The testing</p>
        <div>
          <h2 id="how-tested" className="reveal display text-[30px] leading-[1.1] md:text-[36px]">
            How every rule is tested
          </h2>
          <p className="mt-4 max-w-2xl text-[14.5px] leading-7 text-muted-foreground">
            A rule goes live only after it has been run on years of NSE prices under the same six conditions. They are the reason a record on this
            site can be compared with another.
          </p>
          <ol className="mt-8 grid gap-4 md:grid-cols-2">
            {TESTING.map(([title, body], i) => (
              <li key={title} className="reveal panel p-5">
                <p className="num text-[12px] text-coral-ink">0{i + 1}</p>
                <h3 className="mt-2 text-[15.5px] font-semibold">{title}</h3>
                <p className="mt-2 text-[13.5px] leading-6 text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 max-w-2xl text-[13.5px] leading-6 text-muted-foreground">
            The{" "}
            <Link href="/blog" className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
              research notes
            </Link>{" "}
            show these tests in full, one indicator at a time, and the{" "}
            <Link href="/method" className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
              method page
            </Link>{" "}
            lists the six rules.
          </p>
        </div>
      </section>

      <section aria-labelledby="data" className="mt-24 grid gap-4 md:grid-cols-[220px_1fr]">
        <p className="eyebrow pt-3">The data</p>
        <div>
          <h2 id="data" className="reveal display text-[30px] leading-[1.1] md:text-[36px]">
            Where the prices come from
          </h2>
          <p className="mt-4 max-w-2xl text-[14.5px] leading-7 text-muted-foreground">
            QuantsPulse covers about 3,600 NSE listings: every equity on the main board and the SME board, the major ETFs and the NSE indices. Prices
            are end-of-day closes from Yahoo Finance, loaded each weekday at about 5 pm IST once the session has settled. Every night a separate check
            recomputes the numbers the app shows and compares them with a fresh download; a price that looks wrong is flagged, and the rules read a
            cautious version of that day until it is reviewed.
          </p>
        </div>
      </section>

      <section aria-labelledby="not" className="mt-24 grid gap-4 md:grid-cols-[220px_1fr]">
        <p className="eyebrow pt-3">The limits</p>
        <div>
          <h2 id="not" className="reveal display text-[30px] leading-[1.1] md:text-[36px]">
            What QuantsPulse does not do
          </h2>
          <ul className="mt-8 grid gap-4 md:grid-cols-2">
            {NOT.map(([title, body]) => (
              <li key={title} className="reveal panel p-5">
                <h3 className="text-[15.5px] font-semibold">{title}</h3>
                <p className="mt-2 text-[13.5px] leading-6 text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="who" className="mt-24 grid gap-4 md:grid-cols-[220px_1fr]">
        <p className="eyebrow pt-3">The byline</p>
        <div>
          <h2 id="who" className="reveal display text-[30px] leading-[1.1] md:text-[36px]">
            Who writes the research
          </h2>
          <p className="mt-4 max-w-2xl text-[14.5px] leading-7 text-muted-foreground">
            The research notes are published under the name QuantsPulse Research. Each note states its test period, its stocks and its costs, and
            carries the tables behind its charts, so anyone can check a number against the method on this page.
          </p>
        </div>
      </section>

      <section aria-label="More pages" className="mt-24">
        <MorePages title="Keep reading" />
      </section>
    </main>
  );
}
