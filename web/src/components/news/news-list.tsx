import Link from "next/link";
import { ArrowSquareOutIcon, FileTextIcon } from "@phosphor-icons/react/ssr";
import { Badge, ToneBadge } from "@/components/ui/data";
import { relative } from "@/lib/format";
import { cleanTitle, groupByDay, summaryEchoes } from "@/lib/news/display";
import type { NewsItem } from "@/server/news-data";

/** Headlines link out to the publisher; we only keep title, short summary and link. */
export function NewsList({
  items,
  showSummary = true,
  hideSymbol,
  byDay = false,
}: {
  items: NewsItem[];
  showSummary?: boolean;
  hideSymbol?: string;
  /** Put a Today / Yesterday / date heading over each day's headlines. */
  byDay?: boolean;
}) {
  const groups = byDay ? groupByDay(items) : [{ label: "", items }];
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g.label || "all"} aria-label={g.label || undefined}>
          {g.label ? <h3 className="eyebrow mb-1 border-b border-border pb-1.5">{g.label}</h3> : null}
          <ol className="flex flex-col">
            {g.items.map((n) => {
              const title = cleanTitle(n.title, n.source);
              return (
                <li key={n.id} className="border-b border-border/70 py-3 last:border-0 last:pb-0">
                  <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                    {n.is_filing ? <FileTextIcon size={13} aria-label="Exchange filing" /> : null}
                    <span className="truncate">{n.source}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={n.published_at} className="num shrink-0">
                      {relative(n.published_at)}
                    </time>
                  </div>
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="group mt-1 flex items-start gap-1.5 text-[14px] leading-[1.4] text-foreground hover:underline"
                  >
                    <span>{title}</span>
                    <ArrowSquareOutIcon size={13} className="mt-1 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                    <span className="sr-only">(opens publisher site)</span>
                  </a>
                  {showSummary && !n.is_filing && !summaryEchoes(n.summary, n.title) ? (
                    <p className="mt-1 line-clamp-2 text-[12.5px] leading-5 text-muted-foreground">{n.summary}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {n.is_filing ? <Badge tone="ink">{n.category ?? "Filing"}</Badge> : <ToneBadge label={n.tone_label} terms={n.tone_terms} />}
                    {n.symbols
                      .filter((s) => s !== hideSymbol)
                      .slice(0, 5)
                      .map((s) => (
                        <Link
                          prefetch={false}
                          key={s}
                          href={`/app/markets/${encodeURIComponent(s)}`}
                          className="num rounded-[4px] border border-border px-1.5 text-[11px] leading-5 hover:border-foreground"
                        >
                          {s}
                        </Link>
                      ))}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
