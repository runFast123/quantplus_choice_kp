import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { NewsList } from "@/components/news/news-list";
import { Empty, PageHeader, Panel } from "@/components/ui/layout";
import { stocksInNews } from "@/lib/news/display";
import { getNews } from "@/server/news-data";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "News" };

const TONES = [
  { key: "", label: "Any tone" },
  { key: "positive", label: "Positive" },
  { key: "negative", label: "Negative" },
  { key: "neutral", label: "Neutral" },
];
const KINDS = [
  { key: "", label: "News & filings" },
  { key: "news", label: "News" },
  { key: "filing", label: "Filings" },
];

export default async function NewsPage({ searchParams }: PageProps<"/app/news">) {
  const s = await requireSession();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const scope = str("scope") === "all" ? "all" : "mine";
  const tone = ["positive", "negative", "neutral"].includes(str("tone")) ? str("tone") : undefined;
  const kind = str("kind") === "filing" ? "filing" : str("kind") === "news" ? "news" : undefined;
  const before = /^\d{4}-\d{2}-\d{2}T/.test(str("before")) ? str("before") : undefined;

  let mine: string[] | undefined;
  if (scope === "mine") {
    const [w, h] = await Promise.all([s.supabase.from("watchlist_items").select("symbol"), s.supabase.from("holdings").select("symbol")]);
    mine = [...new Set([...(w.data ?? []), ...(h.data ?? [])].map((r) => r.symbol))];
  }
  const [items, recent, sourcesRes] = await Promise.all([
    getNews(s.supabase, { symbols: mine, tone, kind, before, limit: 40 }),
    // The latest 200 headlines in scope, for "Stocks in the news" (not affected by the tone filter).
    getNews(s.supabase, { symbols: mine, limit: 200 }),
    s.supabase.from("news_sources").select("name, kind").eq("is_active", true).order("name"),
  ]);
  const inNews = stocksInNews(recent, 10);
  const top = inNews[0]?.n ?? 1;
  const last = items[items.length - 1]?.published_at;
  const href = (patch: Record<string, string | undefined>) => {
    const p = { ...(scope === "all" ? { scope } : {}), ...(tone ? { tone } : {}), ...(kind ? { kind } : {}), ...patch };
    return `/app/news?${new URLSearchParams(Object.fromEntries(Object.entries(p).filter(([, v]) => v)) as Record<string, string>)}`;
  };
  const nextHref = last ? href({ before: last }) : null;

  const chips = (label: string, param: "tone" | "kind", value: string | undefined, options: { key: string; label: string }[]) => (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <Link
          prefetch={false}
          key={o.key}
          aria-current={(value ?? "") === o.key ? "true" : undefined}
          href={href({ [param]: o.key || undefined })}
          className={clsx(
            "rounded-full border px-3 py-1 text-[12px] transition-colors duration-150",
            (value ?? "") === o.key ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Headlines"
        title="News"
        description="Headlines from public feeds, matched to the stocks they name and marked positive, negative or neutral. Tap a stock to see its chart and note; the story opens on the publisher's site."
        actions={
          <div role="tablist" aria-label="Stocks" className="flex rounded-md border border-border p-0.5 text-[12.5px]">
            {(["mine", "all"] as const).map((k) => (
              <Link
                prefetch={false}
                key={k}
                role="tab"
                aria-selected={scope === k}
                href={`/app/news?${new URLSearchParams({ ...(k === "all" ? { scope: "all" } : {}), ...(tone ? { tone } : {}), ...(kind ? { kind } : {}) })}`}
                className={clsx("rounded-[5px] px-3 py-1.5", scope === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {k === "mine" ? "My stocks" : "Whole market"}
              </Link>
            ))}
          </div>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        {chips("Tone", "tone", tone, TONES)}
        {chips("Type", "kind", kind, KINDS)}
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title={scope === "mine" ? "On your radar and portfolio" : "Whole market"} meta={before ? "older" : "latest first"} className="order-2 xl:col-start-1 xl:row-span-2 xl:row-start-1">
          {items.length === 0 ? (
            <Empty title={scope === "mine" ? "Nothing on your stocks yet." : "No headlines match."}>
              {scope === "mine" ? (
                <>
                  Headlines appear here when a story names a stock on your radar or in your portfolio.{" "}
                  <Link prefetch={false} href="/app/news?scope=all" className="text-foreground underline underline-offset-4">
                    See the whole market
                  </Link>
                  .
                </>
              ) : null}
            </Empty>
          ) : (
            <>
              <NewsList items={items} byDay />
              {nextHref && items.length === 40 ? (
                <Link prefetch={false} href={nextHref} className="mt-4 inline-block text-[13px] text-muted-foreground underline underline-offset-4 hover:text-foreground">
                  Older headlines
                </Link>
              ) : null}
            </>
          )}
        </Panel>

          <Panel title="Stocks in the news" className="order-1 xl:col-start-2 xl:row-start-1" meta={recent.length ? `latest ${recent.length} headlines` : undefined}>
            {inNews.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">No stock named yet.</p>
            ) : (
              <ul className="flex flex-col gap-2 [&>li:nth-child(n+6)]:hidden sm:[&>li:nth-child(n+6)]:block" data-testid="stocks-in-news">
                {inNews.map((x) => (
                  <li key={x.symbol}>
                    <Link prefetch={false} href={`/app/markets/${encodeURIComponent(x.symbol)}#research`} className="group flex flex-col gap-1">
                      <span className="flex items-baseline justify-between gap-2 text-[12.5px]">
                        <span className="num font-medium group-hover:underline">{x.symbol}</span>
                        <span className="num text-[11.5px] text-muted-foreground">
                          {x.n} {x.n === 1 ? "headline" : "headlines"}
                          {x.pos ? <span className="ml-1.5 text-gain">▲{x.pos}</span> : null}
                          {x.neg ? <span className="ml-1.5 text-loss">▼{x.neg}</span> : null}
                        </span>
                      </span>
                      <span className="h-1 rounded-full bg-foreground/[0.07]" aria-hidden>
                        <span className="block h-1 rounded-full bg-foreground/50" style={{ width: `${(100 * x.n) / top}%` }} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11.5px] leading-4 text-muted-foreground">▲ positive and ▼ negative headlines. Many headlines is attention, not a verdict.</p>
          </Panel>

          <Panel title="How tone is scored" className="order-3 xl:col-start-2 xl:row-start-2">
            <p className="text-[12.5px] leading-5 text-muted-foreground">
              Each headline and summary is checked against two published word lists: <em>surges, beats estimates, upgrade</em> on one
              side, <em>plunges, misses estimates, probe</em> on the other. One word alone is damped, so a single &ldquo;gains&rdquo;
              won&apos;t call a story positive. Hover a tone badge to see what matched.
            </p>
            <details className="mt-3">
              <summary className="cursor-pointer select-none text-[12px] text-foreground">Sources ({(sourcesRes.data ?? []).length})</summary>
              <ul className="mt-2 flex flex-col gap-1 text-[12.5px]">
                {(sourcesRes.data ?? []).map((src) => (
                  <li key={src.name} className="flex justify-between gap-2">
                    <span>{src.name}</span>
                    <span className="text-muted-foreground">{src.kind}</span>
                  </li>
                ))}
              </ul>
            </details>
          </Panel>
      </div>
    </div>
  );
}
