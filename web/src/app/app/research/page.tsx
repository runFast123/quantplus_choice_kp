import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { ArrowDownRightIcon, ArrowUpRightIcon, MagnifyingGlassIcon } from "@phosphor-icons/react/ssr";
import { FilterBar } from "@/components/market/filter-bar";
import { ScoreBar, StanceBadge } from "@/components/ui/data";
import { Empty, PageHeader, Panel, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { date, signedInt } from "@/lib/format";
import { Pager, pageParam } from "@/components/ui/pager";
import { normalizeNote, type ResearchNote } from "@/server/news-data";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Research" };

const PAGE_SIZE = 50;
const SORT: Record<string, { col: string; asc: boolean }> = {
  score: { col: "score", asc: false },
  low: { col: "score", asc: true },
  change: { col: "score_change", asc: false },
  news: { col: "news_count", asc: false },
};
// What each stance means, in a few words.
const STANCE_MEANS: Record<string, string> = {
  constructive: "Most signs point up",
  neutral: "Signs are mixed",
  cautious: "Most signs point down",
};

export default async function ResearchPage({ searchParams }: PageProps<"/app/research">) {
  const s = await requireSession();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const scope = str("scope") === "mine" ? "mine" : "all";
  const stance = str("stance");
  const sort = str("sort") || "score";
  // Search by symbol or name: letters, digits, spaces, & and - only (it goes into a PostgREST filter).
  const q = str("q").replace(/[^A-Za-z0-9 &-]/g, "").trim().slice(0, 40);

  let mine: string[] | undefined;
  if (scope === "mine") {
    const [w, h] = await Promise.all([s.supabase.from("watchlist_items").select("symbol"), s.supabase.from("holdings").select("symbol")]);
    mine = [...new Set([...(w.data ?? []), ...(h.data ?? [])].map((r) => r.symbol))];
  }
  const segment = (["sme", "etf", "index", "all"] as const).find((x) => x === str("segment")) ?? "equity";
  const page = pageParam(sp.page);
  const order = SORT[sort] ?? SORT.score;
  const base = (head: boolean, select = "*") => {
    let qb = s.supabase.from("research_latest").select(head ? "symbol" : select, { count: "exact", head });
    if (mine) qb = qb.in("symbol", mine);
    if (segment !== "all") qb = qb.eq("segment", segment);
    if (q) qb = qb.or(`symbol.ilike.%${q}%,name.ilike.%${q}%`);
    return qb;
  };
  const countOf = (k: string) => base(true).eq("stance", k);
  // Stocks whose stance changed at the latest note, biggest scores first.
  const turned = (to: "constructive" | "cautious") =>
    base(false, "symbol, name, score, prev_score, stance, prev_stance")
      .eq("stance", to)
      .not("prev_stance", "is", null)
      .neq("prev_stance", to)
      .order("score", { ascending: to === "cautious" })
      .limit(6);
  const empty = mine !== undefined && mine.length === 0;
  let list = base(false);
  if (stance) list = list.eq("stance", stance);
  const [listRes, c1, c2, c3, upRes, downRes] = empty
    ? [{ data: [], count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }, { data: [] }, { data: [] }]
    : await Promise.all([
        list
          .order(order.col, { ascending: order.asc, nullsFirst: false })
          .order("symbol")
          .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
        countOf("constructive"),
        countOf("neutral"),
        countOf("cautious"),
        turned("constructive"),
        turned("cautious"),
      ]);
  const counts = { constructive: c1.count ?? 0, neutral: c2.count ?? 0, cautious: c3.count ?? 0 } as Record<string, number>;
  const notes = ((listRes.data ?? []) as unknown as Record<string, unknown>[]).map(normalizeNote);
  const total = listRes.count ?? notes.length;
  const delta = (n: ResearchNote) => (n.prev_score == null ? 0 : n.score - n.prev_score);
  const asOf = notes[0]?.as_of;
  const params = Object.fromEntries(["scope", "stance", "sort", "segment", "q"].filter((k) => str(k)).map((k) => [k, str(k)]));
  const keep = (patch: Record<string, string>) =>
    `/app/research?${new URLSearchParams(Object.fromEntries(Object.entries({ ...params, ...patch }).filter(([, v]) => v)))}`;
  type Turn = { symbol: string; name: string; score: number; prev_score: number | null; prev_stance: string };
  const up = (upRes.data ?? []) as unknown as Turn[];
  const down = (downRes.data ?? []) as unknown as Turn[];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={asOf ? `Session of ${date(asOf)} · rebuilt as headlines arrive` : "Rule-based"}
        title="Research desk"
        description="A short note on every stock after each close: is it rising, is it stretched, what our rules say and what the news says. Open a stock to see the reasons."
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <form action="/app/research" className="relative w-full lg:max-w-sm" role="search">
          {Object.entries(params)
            .filter(([k]) => k !== "q")
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          <MagnifyingGlassIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            name="q"
            defaultValue={q}
            aria-label="Find a stock"
            placeholder="Find a stock by name or symbol…"
            className="h-9 w-full rounded-full border border-border bg-card pl-9 pr-3 text-[13px] outline-none focus:ring-2 focus:ring-ring"
          />
        </form>
        <FilterBar
          filters={[
            { name: "scope", label: "Stocks", options: [{ value: "", label: "Everything covered" }, { value: "mine", label: "My radar & portfolio" }] },
            {
              name: "segment",
              label: "Segment",
              options: [
                { value: "", label: "Stocks (main board)" },
                { value: "sme", label: "SME (Emerge)" },
                { value: "etf", label: "ETFs" },
                { value: "index", label: "Indices" },
                { value: "all", label: "Everything" },
              ],
            },
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
      </div>

      <section className="grid grid-cols-3 gap-2.5" aria-label="Stance counts">
        {(["constructive", "neutral", "cautious"] as const).map((k) => (
          <Link
            prefetch={false}
            key={k}
            href={keep({ stance: stance === k ? "" : k, page: "" })}
            aria-current={stance === k ? "true" : undefined}
            className={clsx("panel flex flex-col gap-1 p-3 transition-colors hover:border-muted-foreground/50 sm:p-4", stance === k && "border-foreground")}
          >
            <span className="flex flex-wrap items-baseline justify-between gap-2">
              <StanceBadge stance={k} />
              <span className="num text-[18px] sm:text-[22px]">{counts[k].toLocaleString("en-IN")}</span>
            </span>
            <span className="hidden text-[11.5px] text-muted-foreground sm:block">{STANCE_MEANS[k]}</span>
          </Link>
        ))}
      </section>

      {up.length || down.length ? (
        <section aria-label="What changed" className="grid gap-3 md:grid-cols-2">
          {(
            [
              ["Turned constructive", "Signs turned up at the latest note", up, ArrowUpRightIcon],
              ["Turned cautious", "Signs turned down at the latest note", down, ArrowDownRightIcon],
            ] as const
          ).map(([title, sub, rows, Icon]) => (
            <div key={title} className="panel p-3.5">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Icon size={14} weight="bold" aria-hidden className={title === "Turned constructive" ? "text-gain" : "text-loss"} />
                {title}
                <span className="text-[11.5px] font-normal text-muted-foreground">· {sub}</span>
              </p>
              {rows.length === 0 ? (
                <p className="mt-2 text-[12px] text-muted-foreground">None this session.</p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {rows.map((r) => (
                    <li key={r.symbol}>
                      <Link
                        prefetch={false}
                        href={`/app/markets/${encodeURIComponent(r.symbol)}#research`}
                        title={`${r.name}: was ${r.prev_stance}, score ${signedInt(Number(r.score))}`}
                        className="num inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[12px] hover:border-foreground"
                      >
                        {r.symbol}
                        <span className="text-muted-foreground">{signedInt(Number(r.score))}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      ) : null}

      <Panel title={`${total.toLocaleString("en-IN")} notes`} meta={q ? `matching “${q}”` : stance ? STANCE_MEANS[stance]?.toLowerCase() : undefined}>
        {notes.length === 0 ? (
          <Empty title="No notes match.">
            {q ? (
              <Link prefetch={false} href={keep({ q: "", page: "" })} className="text-foreground underline underline-offset-4">
                Clear the search
              </Link>
            ) : scope === "mine" ? (
              "Add stocks to your radar or portfolio, or switch to everything covered."
            ) : (
              "Notes are rebuilt after each close."
            )}
          </Empty>
        ) : (
          <>
            {/* Phones: one card per stock */}
            <ul className="flex flex-col divide-y divide-border sm:hidden" data-testid="research-cards">
              {notes.map((n) => {
                const d = delta(n);
                return (
                  <li key={n.symbol}>
                    <Link prefetch={false} href={`/app/markets/${encodeURIComponent(n.symbol)}#research`} className="flex flex-col gap-1 py-2.5">
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0">
                          <span className="num font-medium">{n.symbol}</span>{" "}
                          <span className="truncate text-[11.5px] text-muted-foreground">{n.name}</span>
                        </span>
                        <StanceBadge stance={n.stance} />
                      </span>
                      <span className="text-[12.5px] leading-5 text-muted-foreground">{n.headline}</span>
                      <span className="num flex items-center gap-3 text-[11.5px] text-muted-foreground">
                        <span>score {signedInt(n.score)}</span>
                        {d ? <span className={d > 0 ? "text-gain" : "text-loss"}>{d > 0 ? "▲ +" : "▼ −"}{Math.abs(d).toFixed(1)}</span> : null}
                        {n.news_count ? <span>{n.news_count} headlines</span> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* Wider screens: the table */}
            <div className="hidden sm:block">
              <TableWrap>
                <table className="w-full min-w-[760px]">
                  <thead>
                    <tr>
                      <th className={th}>Stock</th>
                      <th className={th}>Stance</th>
                      <th className={th}>Score</th>
                      <th className={thNum}>Change</th>
                      <th className={th}>In short</th>
                      <th className={thNum}>News 14d</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notes.map((n) => {
                      const d = delta(n);
                      return (
                        <tr key={n.symbol} className={tr}>
                          <td className={td}>
                            <Link prefetch={false} href={`/app/markets/${encodeURIComponent(n.symbol)}#research`} className="group block">
                              <span className="num font-medium group-hover:underline">{n.symbol}</span>
                              <span className="block max-w-[180px] truncate text-[11.5px] text-muted-foreground">{n.name}</span>
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
                          <td className={td + " max-w-[380px] whitespace-normal pr-6 text-[12.5px] text-muted-foreground"}>{n.headline}</td>
                          <td className={tdNum}>{n.news_count || <span className="text-muted-foreground">0</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          </>
        )}
        <Pager path="/app/research" params={params} page={page} pageSize={PAGE_SIZE} total={total} />
      </Panel>
      <details className="text-[12px] leading-5 text-muted-foreground">
        <summary className="cursor-pointer select-none text-foreground">How a note is scored</summary>
        <p className="mt-1 max-w-3xl">
          Five signs, each scored from −2 to +2 and weighted: trend 30%, momentum 20%, where it sits in its 52-week range 10%, the
          latest rule signal 15% and news tone 25% (damped below three headlines). The total runs from −100 to +100. Constructive is
          +25 and above, cautious −25 and below. Research notes are mechanical summaries, not recommendations.
        </p>
      </details>
    </div>
  );
}
