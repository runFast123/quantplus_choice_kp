import type { Metadata } from "next";
import { HowSteps, JsonLd, MorePages, PageHead } from "@/components/marketing/sections";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";

const TITLE = "Method: how six published rules check NSE stocks";
const DESCRIPTION =
  "The QuantsPulse method: after every NSE close, six published rules (four trend rules, two dip rules) check the stocks on your radar. Every buy comes with a safety stop and a plan, and every rule with its tested record.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/method" },
  openGraph: { type: "website", title: TITLE, description: DESCRIPTION, url: "/method", siteName: "QuantsPulse", locale: "en_IN" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// [name, kind, what it reads, research note]: the names match lib/rules.ts; five of the six have a note
const RULE_CARDS: [string, string, string, [string, string] | null][] = [
  ["Strong trend", "Trend", "Buys a new 52-week high made on heavy volume: the classic breakout, with a safety stop under it.", ["/blog/52-week-high-breakout-strong-trend-rule", "The 52-week high breakout, tested"]],
  ["SMA 20/50 trend", "Trend", "Buys when the 20-day average turns above the 50-day in a stock that is leading the market.", ["/blog/sma-20-50-crossover-vs-sma-trend-rule", "The SMA 20/50 crossover, tested"]],
  ["200-day trend", "Trend", "Buys a stock holding above a flat or rising 200-day average after a steady climb.", ["/blog/200-day-moving-average-vs-200-day-trend-rule", "The 200-day average, tested"]],
  ["Secular trend", "Trend", "Buys when a deep, long slump starts to turn up, read from a long-term momentum line well below zero.", null],
  ["RSI dip", "Dip", "Buys a sharp two-day drop in a stock that is still rising, only at a lower price the next day, and sells on the first close above the 5-day average (10 sessions at most).", ["/blog/rsi-oversold-vs-rsi-dip-rule", "RSI oversold, tested"]],
  ["KK dip", "Dip", "Buys a push under the 20-day low in a rising stock, only at a lower price the next day, and sells the same way: the first close above the 5-day average, 10 sessions at most.", ["/blog/buy-the-dip-20-day-low-kk-dip-rule", "Buying the 20-day low, tested"]],
];

const AFTER_CLOSE: [string, string][] = [
  ["About 5 pm IST, each weekday", "The day's end-of-day prices for about 3,600 NSE listings are loaded once the session has settled."],
  ["Right after", "The six rules run on every stock. New buys get a safety stop and a plan for when to sell."],
  ["Then your alerts", "Price alerts check the day's high and low, so a level touched during the day still counts."],
];

export default function HowItWorksPage() {
  return (
    <main className="mx-auto max-w-[1240px] px-5 pb-24 pt-10 md:px-8 md:pt-16">
      <JsonLd name="Method" path="/method" />
      <PageHead
        eyebrow="Method"
        title="Six published rules, checked after every close."
        lead="QuantsPulse is research for people who pick NSE stocks themselves. You choose the stocks; six published rules check each one after every market close; every buy comes with a safety stop and a plan; and you decide what to do."
      />
      <HowSteps />

      <section aria-labelledby="six-rules" className="mt-24 grid gap-4 md:grid-cols-[220px_1fr]">
        <p className="eyebrow pt-3">The rules</p>
        <div>
          <h2 id="six-rules" className="reveal display text-[30px] leading-[1.1] md:text-[36px]">
            The six rules, in plain words
          </h2>
          <p className="mt-4 max-w-2xl text-[14.5px] leading-7 text-muted-foreground">
            Four rules follow a trend and two buy a sharp dip in a rising stock. Each is written out in full, applied to every stock the same way, and
            tested on NSE prices from 2019 to 2026 after costs, with the losing trades kept in the record.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {RULE_CARDS.map(([name, kind, what, note]) => (
              <article key={name} className="reveal panel p-5">
                <p className="eyebrow">{kind}</p>
                <h3 className="display mt-2 text-[22px]">{name}</h3>
                <p className="mt-2 text-[13.5px] leading-6 text-muted-foreground">{what}</p>
                {note ? (
                  <Link href={note[0]} className="mt-3 inline-block text-[13px] font-medium underline decoration-border underline-offset-4 hover:decoration-foreground">
                    {note[1]}
                  </Link>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </section>

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
        <MorePages current="/method" title="Keep reading" />
      </section>
    </main>
  );
}
