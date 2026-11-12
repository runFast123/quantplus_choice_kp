import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CaretRightIcon, CheckCircleIcon, LightningIcon } from "@phosphor-icons/react/ssr";
import { Inline, PostBody } from "@/components/blog/post-body";
import { ButtonLink } from "@/components/ui/button";
import { BLOG_DATA } from "@/lib/blog/data";
import { longDate, readMinutes } from "@/lib/blog/format";
import { POSTS, postBySlug, postText } from "@/lib/blog/posts";
import { SITE_URL } from "@/lib/env";
import { Tilt } from "@/components/marketing/tilt";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const post = postBySlug((await params).slug);
  if (!post) return { title: "Not found" };
  const url = `/blog/${post.slug}`;
  return {
    title: post.seoTitle,
    description: post.description,
    keywords: post.keywords,
    authors: [{ name: "QuantsPulse Research" }],
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url,
      siteName: "QuantsPulse",
      locale: "en_IN",
      publishedTime: post.published,
      modifiedTime: post.updated,
      authors: ["QuantsPulse Research"],
      tags: post.keywords,
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description },
  };
}

export default async function BlogPost({ params }: PageProps<"/blog/[slug]">) {
  const post = postBySlug((await params).slug);
  if (!post) notFound();
  const words = postText(post).join(" ").split(/\s+/).length;
  const toc = post.blocks.flatMap((b) => (b.type === "h2" ? [b] : []));
  const url = `${SITE_URL}/blog/${post.slug}`;
  const others = POSTS.filter((p) => p.slug !== post.slug);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      description: post.description,
      datePublished: post.published,
      dateModified: post.updated,
      inLanguage: "en-IN",
      wordCount: words,
      keywords: post.keywords.join(", "),
      image: `${url}/opengraph-image`,
      url,
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      author: { "@type": "Organization", name: "QuantsPulse Research", url: SITE_URL },
      publisher: { "@type": "Organization", name: "QuantsPulse", url: SITE_URL, logo: { "@type": "ImageObject", url: `${SITE_URL}/apple-icon.png` } },
      about: [{ "@type": "Thing", name: post.ruleName }, { "@type": "Thing", name: "Technical analysis of NSE stocks" }],
      isBasedOn: { "@type": "Dataset", name: "NSE daily prices, July 2019 to October 2026", description: BLOG_DATA.method },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: post.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Research notes", item: `${SITE_URL}/blog` },
        { "@type": "ListItem", position: 3, name: post.title, item: url },
      ],
    },
  ];

  return (
    <main className="mx-auto max-w-[760px] px-5 pb-16 pt-6 md:px-8 md:pt-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      <nav aria-label="Breadcrumb" className="hero-in flex flex-wrap items-center gap-1 text-[12.5px] text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          Home
        </Link>
        <CaretRightIcon size={11} aria-hidden />
        <Link href="/blog" className="hover:text-foreground">
          Research notes
        </Link>
      </nav>

      <article className="mt-5">
        <header>
          <h1 className="hero-in display text-[32px] leading-[1.12] text-foreground md:text-[44px]" style={{ "--d": "80ms" } as React.CSSProperties}>
            {post.title}
          </h1>
          <p className="hero-in mt-4 text-[13px] text-muted-foreground" style={{ "--d": "180ms" } as React.CSSProperties}>
            By QuantsPulse Research · <time dateTime={post.published}>{longDate(post.published)}</time> · {readMinutes(words)} min read
          </p>
        </header>

        <section aria-label="The short answer" className="hero-in mt-7 rounded-2xl border border-border bg-card px-5 py-4 md:px-6 md:py-5"
          style={{ "--d": "280ms" } as React.CSSProperties}
          data-testid="blog-answer">
          <p className="eyebrow flex items-center gap-1.5 text-[10.5px]">
            <LightningIcon size={13} aria-hidden /> The short answer
          </p>
          <p className="mt-2 text-[16.5px] leading-[1.7] text-foreground">{post.answer}</p>
        </section>

        <nav aria-label="On this page" className="mt-6 rounded-xl border border-border/70 px-5 py-4">
          <p className="eyebrow text-[10.5px]">On this page</p>
          <ol className="mt-2 grid gap-1.5 text-[14px] sm:grid-cols-2">
            {toc.map((b) => (
              <li key={b.id}>
                <a href={`#${b.id}`} className="text-foreground/85 hover:text-foreground hover:underline">
                  {b.text}
                </a>
              </li>
            ))}
            <li>
              <a href="#takeaways" className="text-foreground/85 hover:text-foreground hover:underline">
                Key takeaways
              </a>
            </li>
            <li>
              <a href="#questions" className="text-foreground/85 hover:text-foreground hover:underline">
                Questions people ask
              </a>
            </li>
          </ol>
        </nav>

        <PostBody post={post} />

        <h2 id="takeaways" className="display mt-12 scroll-mt-24 text-[26px] leading-tight text-foreground md:text-[30px]">
          Key takeaways
        </h2>
        <ul className="reveal mt-5 flex flex-col gap-3">
          {post.takeaways.map((t) => (
            <li key={t} className="flex gap-3 text-[16.5px] leading-[1.65] text-foreground/90">
              <CheckCircleIcon size={20} weight="fill" className="mt-0.5 shrink-0 text-series-ours" aria-hidden />
              <span>
                <Inline text={t} />
              </span>
            </li>
          ))}
        </ul>

        <h2 id="questions" className="display mt-12 scroll-mt-24 text-[26px] leading-tight text-foreground md:text-[30px]">
          Questions people ask
        </h2>
        <div className="reveal mt-5 divide-y divide-border rounded-xl border border-border bg-card">
          {post.faq.map((f) => (
            <details key={f.q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[16px] font-semibold text-foreground">
                <h3>{f.q}</h3>
                <span className="mt-0.5 text-muted-foreground transition-transform group-open:rotate-45" aria-hidden>
                  +
                </span>
              </summary>
              <p className="mt-3 text-[15.5px] leading-[1.7] text-foreground/85">{f.a}</p>
            </details>
          ))}
        </div>

        <aside className="reveal mt-12 rounded-2xl border border-border bg-card px-5 py-6 md:px-7">
          <p className="display text-[24px] leading-snug text-foreground">See the {post.ruleName} rule on any NSE stock</p>
          <p className="mt-2 text-[15px] leading-[1.65] text-foreground/80">
            Every past trade on the chart, the safety stop of every open signal, and a TradingView script for this rule only.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <ButtonLink href="/signup">Start free for 3 months</ButtonLink>
            <ButtonLink href="/blog" variant="secondary">
              More research notes
            </ButtonLink>
          </div>
        </aside>

        <p className="mt-8 text-[12.5px] leading-5 text-muted-foreground">
          Research, not advice. Signals are the output of fixed rules applied the same way to every stock, tested on past prices;
          past results do not promise future ones. Prices are end of day NSE prices from Yahoo Finance. Investments in securities
          are subject to market risks.
        </p>
      </article>

      <section aria-label="More research notes" className="mt-14">
        <h2 className="display text-[24px] text-foreground">More research notes</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {others.map((p) => (
            <li key={p.slug} className="reveal">
              <Tilt max={6} className="h-full rounded-xl">
                <Link href={`/blog/${p.slug}`} className="block h-full rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/25">
                  <p className="text-[15px] font-semibold leading-snug text-foreground">{p.title}</p>
                  <p className="mt-1.5 text-[13px] text-muted-foreground">{p.ruleName}</p>
                </Link>
              </Tilt>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
