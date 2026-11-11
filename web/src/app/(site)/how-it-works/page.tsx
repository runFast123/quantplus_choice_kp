import type { Metadata } from "next";
import { HowSteps, JsonLd, MorePages, PageHead } from "@/components/marketing/sections";
import { ButtonLink } from "@/components/ui/button";

const TITLE = "How it works: six rules check your stock radar";
const DESCRIPTION =
  "Build a Market Radar of the NSE stocks you follow. After every close, six published rules check each one, with a safety stop and a plan for every buy, and the Chrome extension shows them on your broker's chart.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/how-it-works" },
  openGraph: { type: "website", title: TITLE, description: DESCRIPTION, url: "/how-it-works", siteName: "QuantsPulse", locale: "en_IN" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const AFTER_CLOSE: [string, string][] = [
  ["About 5 pm IST, each weekday", "The day's end-of-day prices for about 3,600 NSE listings are loaded once the session has settled."],
  ["Right after", "The six rules run on every stock. New buys get a safety stop and a plan for when to sell."],
  ["Then your alerts", "Price alerts check the day's high and low, so a level touched during the day still counts."],
];

export default function HowItWorksPage() {
  return (
    <main className="mx-auto max-w-[1240px] px-5 pb-24 pt-10 md:px-8 md:pt-16">
      <JsonLd name="How it works" path="/how-it-works" />
      <PageHead
        eyebrow="How it works"
        title="A short list, a few rules, and a nudge when they agree."
        lead="QuantsPulse is research for people who pick Indian stocks themselves. You choose the stocks; published rules do the checking after every close; you decide what to do."
      />
      <HowSteps />

      <section aria-labelledby="after-close" className="mt-24 grid gap-4 md:grid-cols-[220px_1fr]">
        <p className="eyebrow pt-3">Every evening</p>
        <div>
          <h2 id="after-close" className="reveal display text-[30px] leading-[1.1] md:text-[36px]">
            What happens after each close
          </h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {AFTER_CLOSE.map(([when, what], i) => (
              <li key={when} className="reveal panel p-5">
                <p className="num text-[12px] text-coral-ink">0{i + 1}</p>
                <h3 className="mt-2 text-[15px] font-semibold">{when}</h3>
                <p className="mt-2 text-[13.5px] leading-6 text-muted-foreground">{what}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 max-w-2xl text-[13px] leading-6 text-muted-foreground">
            There are no live intraday prices. A signal is the output of a fixed rule, not advice: what to buy, how much and when stays your decision.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/signup">Start free for 3 months</ButtonLink>
            <ButtonLink href="/blog" variant="secondary">
              Read how the rules were tested
            </ButtonLink>
          </div>
        </div>
      </section>

      <section aria-label="More pages" className="mt-24">
        <MorePages current="/how-it-works" />
      </section>
    </main>
  );
}
