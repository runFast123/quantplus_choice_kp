import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { NewsList } from "@/components/news/news-list";
import { FilterBar } from "@/components/market/filter-bar";
import { Empty, PageHeader, Panel } from "@/components/ui/layout";
import { getNews } from "@/server/news-data";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "News" };

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
  const [items, sourcesRes] = await Promise.all([
    getNews(s.supabase, { symbols: mine, tone, kind, before, limit: 40 }),
    s.supabase.from("news_sources").select("name, kind").eq("is_active", true).order("name"),
  ]);
  const last = items[items.length - 1]?.published_at;
  const nextHref = last ? `/app/news?${new URLSearchParams({ ...(scope === "all" ? { scope } : {}), ...(tone ? { tone } : {}), ...(kind ? { kind } : {}), before: last })}` : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Headlines"
        title="News"
        description="Market headlines from public RSS feeds, matched to the stocks we cover and scored for tone with a published word list. We keep the headline and a short summary; the story stays with its publisher."
      />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div role="tablist" className="flex rounded-md border border-border p-0.5 text-[12.5px]">
          {(["mine", "all"] as const).map((k) => (
            <Link
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
        <FilterBar
          filters={[
            { name: "tone", label: "Tone", options: [{ value: "", label: "Any tone" }, { value: "positive", label: "Positive" }, { value: "negative", label: "Negative" }, { value: "neutral", label: "Neutral" }] },
            { name: "kind", label: "Type", options: [{ value: "", label: "News & filings" }, { value: "news", label: "News only" }, { value: "filing", label: "Exchange filings" }] },
          ]}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Panel title={scope === "mine" ? "On your radar and portfolio" : "Whole market"} meta={before ? "older" : "latest"}>
          {items.length === 0 ? (
            <Empty title={scope === "mine" ? "Nothing on your stocks yet." : "No headlines match."}>
              {scope === "mine" ? (
                <>
                  Headlines appear here when a story names a stock on your radar or in your portfolio.{" "}
                  <Link href="/app/news?scope=all" className="text-foreground underline underline-offset-4">
                    See the whole market
                  </Link>
                  .
                </>
              ) : null}
            </Empty>
          ) : (
            <>
              <NewsList items={items} />
              {nextHref && items.length === 40 ? (
                <Link href={nextHref} className="mt-4 inline-block text-[13px] text-muted-foreground underline underline-offset-4 hover:text-foreground">
                  Older headlines
                </Link>
              ) : null}
            </>
          )}
        </Panel>

        <Panel title="How tone is scored">
          <p className="text-[12.5px] leading-6 text-muted-foreground">
            Each headline and summary is checked against two published lists — words like <em>surges, beats estimates, upgrade, record high</em> on one
            side, <em>plunges, misses estimates, probe, 52-week low</em> on the other. Hover a tone badge to see what matched. One word alone is damped,
            so a single &ldquo;gains&rdquo; won&apos;t call a story positive.
          </p>
          <p className="eyebrow mt-5">Sources</p>
          <ul className="mt-2 flex flex-col gap-1 text-[12.5px]">
            {(sourcesRes.data ?? []).map((src) => (
              <li key={src.name} className="flex justify-between gap-2">
                <span>{src.name}</span>
                <span className="text-muted-foreground">{src.kind}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
