import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/ssr";
import { BLOG_DATA } from "@/lib/blog/data";
import { longDate, pct, readMinutes } from "@/lib/blog/format";
import { POSTS, postText } from "@/lib/blog/posts";
import { SITE_URL } from "@/lib/env";

const DESCRIPTION =
  "Five common ways of using indicators on Indian stocks, each tested against a QuantsPulse rule on the same NSE stocks from 2019 to 2026. Plain words, real numbers, and the results that go against us too.";

export const metadata: Metadata = {
  title: "Research notes: indicators tested on NSE stocks",
  description: DESCRIPTION,
  alternates: { canonical: "/blog" },
  openGraph: { type: "website", title: "QuantsPulse research notes", description: DESCRIPTION, url: "/blog", siteName: "QuantsPulse", locale: "en_IN" },
  twitter: { card: "summary_large_image", title: "QuantsPulse research notes", description: DESCRIPTION },
};

export default function BlogIndex() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "QuantsPulse research notes",
    description: DESCRIPTION,
    url: `${SITE_URL}/blog`,
    publisher: { "@type": "Organization", name: "QuantsPulse", url: SITE_URL },
    blogPost: POSTS.map((p) => ({
      "@type": "BlogPosting",
      headline: p.title,
      url: `${SITE_URL}/blog/${p.slug}`,
      datePublished: p.published,
      description: p.description,
    })),
  };
  return (
    <main className="mx-auto max-w-[1080px] px-5 pb-20 pt-8 md:px-8 md:pt-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <p className="eyebrow">Research notes</p>
      <h1 className="display mt-2 max-w-3xl text-[36px] leading-[1.1] text-foreground md:text-[52px]">
        The usual way to use an indicator, and what seven years of NSE prices say about it
      </h1>
      <p className="mt-5 max-w-2xl text-[17px] leading-[1.7] text-foreground/85">
        Each note takes one indicator most traders know, tests the way it is usually used, and tests our rule built on the same
        indicator. Same stocks, same days, same costs. Where the usual way does better on some measure, we say so.
      </p>

      <ul className="mt-12 grid gap-5 md:grid-cols-2" data-testid="blog-list">
        {POSTS.map((p, i) => {
          const d = BLOG_DATA[p.rule];
          const words = postText(p).join(" ").split(/\s+/).length;
          return (
            <li key={p.slug} className={i === 0 ? "md:col-span-2" : undefined}>
              <Link
                href={`/blog/${p.slug}`}
                className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:border-foreground/25 md:p-6"
              >
                <p className="text-[12.5px] text-muted-foreground">
                  {longDate(p.published)} · {readMinutes(words)} min read
                </p>
                <h2 className={`display mt-2 leading-snug text-foreground ${i === 0 ? "text-[26px] md:text-[32px]" : "text-[22px]"}`}>{p.title}</h2>
                <p className="mt-3 text-[15px] leading-[1.65] text-foreground/80">{p.description}</p>
                <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-5">
                  <div className="flex gap-5">
                    <div>
                      <p className="num text-[22px] leading-none text-series-ours">{pct(d.ours.all.made_money_pct, 0)}</p>
                      <p className="mt-1 text-[11.5px] text-muted-foreground">{p.ruleName}: made money</p>
                    </div>
                    <div>
                      <p className="num text-[22px] leading-none text-foreground/70">{pct(d.usual.all.made_money_pct, 0)}</p>
                      <p className="mt-1 text-[11.5px] text-muted-foreground">{p.usualName}</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[13.5px] font-medium text-foreground">
                    Read the test <ArrowRightIcon size={14} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="mt-10 max-w-3xl text-[12.5px] leading-5 text-muted-foreground">
        All tests: {BLOG_DATA.method} Results on past prices are not a promise about the future, and nothing here is investment advice.
      </p>
    </main>
  );
}
