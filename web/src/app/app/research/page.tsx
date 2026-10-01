import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { FilterBar } from "@/components/market/filter-bar";
import { ScoreBar, StanceBadge } from "@/components/ui/data";
import { Empty, PageHeader, Panel, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { date, factorScore } from "@/lib/format";
import { getResearch, type ResearchNote } from "@/server/news-data";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Research" };

const FACTOR_KEYS = ["trend", "momentum", "range", "signal", "news"] as const;
const FACTOR_SHORT: Record<string, string> = { trend: "T", momentum: "M", range: "R", signal: "S", news: "N" };

export default async function ResearchPage({ searchParams }: PageProps<"/app/research">) {
  const s = await requireSession();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const scope = str("scope") === "mine" ? "mine" : "all";
  const stance = str("stance");
  const sort = str("sort") || "score";

  let mine: string[] | undefined;
  if (scope === "mine") {
    const [w, h] = await Promise.all([s.supabase.from("watchlist_items").select("symbol"), s.supabase.from("holdings").select("symbol")]);
    mine = [...new Set([...(w.data ?? []), ...(h.data ?? [])].map((r) => r.symbol))];
  }
  const all = await getResearch(s.supabase, mine);
  const counts = { constructive: 0, neutral: 0, cautious: 0 } as Record<string, number>;
  for (const n of all) counts[n.stance]++;
  const notes = stance ? all.filter((n) => n.stance === stance) : all;
  const delta = (n: ResearchNote) => (n.prev_score == null ? 0 : n.score - n.prev_score);
  notes.sort((a, b) =>
    sort === "change" ? Math.abs(delta(b)) - Math.abs(delta(a)) : sort === "news" ? b.news_count - a.news_count : sort === "low" ? a.score - b.score : b.score - a.score,
  );
  const asOf = notes[0]?.as_of;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={asOf ? `Session of ${date(asOf)} · rebuilt as headlines arrive` : "Rule-based"}
        title="Research desk"
        description="Every stock gets one note per session: trend, momentum, where it sits in its range, the latest rule signal and the tone of its headlines — each scored, weighted and explained. Open a stock to see the reasoning and the news behind it."
      />

      <section className="grid grid-cols-3 gap-3" aria-label="Stance counts">
        {(["constructive", "neutral", "cautious"] as const).map((k) => (
          <Link
            key={k}
            href={`/app/research?${new URLSearchParams({ ...(scope === "mine" ? { scope } : {}), ...(stance === k ? {} : { stance: k }) })}`}
            aria-current={stance === k ? "true" : undefined}
            className={clsx("panel flex items-baseline justify-between gap-2 p-4 transition-colors hover:border-muted-foreground/50", stance === k && "border-foreground")}
          >
            <StanceBadge stance={k} />
            <span className="num text-[22px]">{counts[k]}</span>
          </Link>
        ))}
      </section>

      <FilterBar
        filters={[
          { name: "scope", label: "Stocks", options: [{ value: "", label: "Everything covered" }, { value: "mine", label: "My radar & portfolio" }] },
          {
            name: "sort",
            label: "Sort",
            options: [
              { value: "", label: "Score, high → low" },
              { value: "low", label: "Score, low → high" },
              { value: "change", label: "Biggest change" },
              { value: "news", label: "Most headlines" },
            ],
          },
        ]}
      />

      <Panel title={`${notes.length} notes`} meta="T trend · M momentum · R range · S signal · N news">
        {notes.length === 0 ? (
          <Empty title="No notes match.">
            {scope === "mine" ? "Add stocks to your radar or portfolio, or switch to everything covered." : "Notes are rebuilt after each close."}
          </Empty>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[960px]">
              <thead>
                <tr>
                  <th className={th}>Stock</th>
                  <th className={th}>Stance</th>
                  <th className={th}>Score</th>
                  <th className={thNum}>Change</th>
                  <th className={th}>Factors</th>
                  <th className={th}>Note</th>
                  <th className={thNum}>News 14d</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((n) => {
                  const d = delta(n);
                  return (
                    <tr key={n.symbol} className={tr}>
                      <td className={td}>
                        <Link href={`/app/markets/${encodeURIComponent(n.symbol)}#research`} className="group block">
                          <span className="num font-medium group-hover:underline">{n.symbol}</span>
                          <span className="block max-w-[170px] truncate text-[11.5px] text-muted-foreground">{n.name}</span>
                        </Link>
                      </td>
                      <td className={td}>
                        <StanceBadge stance={n.stance} />
                        {n.prev_stance && n.prev_stance !== n.stance ? (
                          <span className="mt-0.5 block text-[10.5px] text-muted-foreground">was {n.prev_stance}</span>
                        ) : null}
                      </td>
                      <td className={td}>
                        <ScoreBar score={n.score} width={96} />
                      </td>
                      <td className={tdNum}>
                        {n.prev_score == null ? (
                          <span className="text-muted-foreground">new</span>
                        ) : (
                          <span className={d > 0 ? "text-gain" : d < 0 ? "text-loss" : "text-muted-foreground"}>
                            {d > 0 ? "▲ +" : d < 0 ? "▼ −" : ""}
                            {Math.abs(d).toFixed(1)}
                          </span>
                        )}
                      </td>
                      <td className={td}>
                        <span className="inline-flex gap-1" aria-label="Factor scores">
                          {FACTOR_KEYS.map((k) => {
                            const f = n.factors.find((x) => x.key === k);
                            const v = f?.score ?? 0;
                            return (
                              <span
                                key={k}
                                role="img"
                                aria-label={`${f?.label ?? k} ${factorScore(v)}`}
                                title={`${f?.label}: ${factorScore(v)} — ${f?.detail ?? ""}`}
                                className={clsx(
                                  "num inline-flex h-6 min-w-6 items-center justify-center gap-px rounded-[4px] px-1 text-[10.5px]",
                                  v > 0 ? "bg-gain-soft text-gain" : v < 0 ? "bg-loss-soft text-loss" : "bg-foreground/[0.05] text-muted-foreground",
                                )}
                              >
                                {FACTOR_SHORT[k]}
                                <span aria-hidden className="text-[8px]">{v > 0 ? "▲" : v < 0 ? "▼" : ""}</span>
                              </span>
                            );
                          })}
                        </span>
                      </td>
                      <td className={td + " max-w-[320px] whitespace-normal pr-6 text-[12.5px] text-muted-foreground"}>{n.headline}</td>
                      <td className={tdNum}>{n.news_count || <span className="text-muted-foreground">0</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
      <p className="text-[12px] leading-5 text-muted-foreground">
        Weights: trend 30%, momentum 20%, 52-week range 10%, latest signal 15%, news tone 25% (damped below three headlines). Stance is constructive at
        +25 and above, cautious at −25 and below. Research notes are mechanical summaries, not recommendations.
      </p>
    </div>
  );
}
