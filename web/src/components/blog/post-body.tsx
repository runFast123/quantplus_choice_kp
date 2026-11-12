// Renders a blog post's blocks (server). Text supports **bold** and [label](/path).
import Link from "next/link";
import { Fragment } from "react";
import { InfoIcon } from "@phosphor-icons/react/ssr";
import { ExampleChart, PeriodsChart, SpreadChart, YearsChart } from "@/components/blog/charts";
import { CountUp } from "@/components/blog/motion";
import { RuleDiagram } from "@/components/blog/rule-diagram";
import { BLOG_DATA } from "@/lib/blog/data";
import { count, pct, signed } from "@/lib/blog/format";
import type { Block, Post, Stats } from "@/lib/blog/types";

export function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**")) return <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>;
        const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (m) {
          return (
            <Link key={i} href={m[2]} className="font-medium text-coral-ink underline decoration-coral/40 underline-offset-[3px] hover:decoration-coral">
              {m[1]}
            </Link>
          );
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

const tone = (x: number) => (Math.abs(x) < 0.05 ? "text-foreground" : x > 0 ? "text-gain" : "text-loss");

export function StatTiles({ post }: { post: Post }) {
  const d = BLOG_DATA[post.rule];
  const tiles = [
    { label: "Trades that made money", u: pct(d.usual.all.made_money_pct), o: pct(d.ours.all.made_money_pct) },
    {
      label: "The middle trade",
      u: signed(d.usual.all.median_pct),
      o: signed(d.ours.all.median_pct),
      uc: tone(d.usual.all.median_pct),
      oc: tone(d.ours.all.median_pct),
    },
    { label: "Trades a year, 300 stocks", u: count(d.usual.all.per_year), o: count(d.ours.all.per_year) },
  ];
  return (
    <div className="my-8 grid gap-3 sm:grid-cols-3" data-testid="blog-stats">
      {tiles.map((t, k) => (
        // the numbers count up once as the tiles scroll into view; the final value is always the accessible text
        <div key={t.label} className="rounded-xl border border-border bg-card px-4 py-3.5">
          <p className="eyebrow text-[10.5px]">{t.label}</p>
          <div className="mt-2.5 flex items-end justify-between gap-2">
            <div className="min-w-0">
              <p className={`num whitespace-nowrap text-[22px] font-medium leading-none ${t.oc ?? "text-foreground"}`}>
                <CountUp text={t.o} delay={k * 60} />
              </p>
              <p className="mt-1.5 flex items-center gap-1 text-[11.5px] text-muted-foreground">
                <span className="h-2 w-2 shrink-0 rounded-[2px] bg-series-ours" aria-hidden />
                {post.ruleName}
              </p>
            </div>
            <div className="min-w-0 text-right">
              <p className={`num whitespace-nowrap text-[15px] leading-none ${t.uc ?? "text-foreground/80"}`}>
                <CountUp text={t.u} delay={k * 60 + 30} />
              </p>
              <p className="mt-1.5 flex items-center justify-end gap-1 text-[11.5px] text-muted-foreground">
                <span className="h-2 w-2 shrink-0 rounded-[2px] bg-series-usual" aria-hidden />
                {post.usualName}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CompareTable({ post, title }: { post: Post; title: string }) {
  const d = BLOG_DATA[post.rule];
  const cols: { name: string; s: Stats; recent: Stats; ours?: boolean }[] = [
    { name: post.usualName, s: d.usual.all, recent: d.usual.recent },
    ...(d.usualTrail ? [{ name: "Sell under 50 day", s: d.usualTrail.all, recent: d.usualTrail.recent }] : []),
    { name: post.ruleName, s: d.ours.all, recent: d.ours.recent, ours: true },
  ];
  const rows: [string, (c: (typeof cols)[number]) => string, ((c: (typeof cols)[number]) => number)?][] = [
    ["Trades, July 2019 to October 2026", (c) => count(c.s.trades)],
    ["Trades a year", (c) => count(c.s.per_year)],
    ["Trades that made money", (c) => pct(c.s.made_money_pct)],
    ["Average trade", (c) => signed(c.s.avg_pct, 2), (c) => c.s.avg_pct],
    ["Middle trade", (c) => signed(c.s.median_pct, 2), (c) => c.s.median_pct],
    ["Average winning trade", (c) => signed(c.s.avg_win_pct), (c) => c.s.avg_win_pct],
    ["Average losing trade", (c) => signed(c.s.avg_loss_pct), (c) => c.s.avg_loss_pct],
    ["Sessions held, on average", (c) => c.s.avg_days.toFixed(0)],
    ["Made money, 2024 to 2026", (c) => pct(c.recent.made_money_pct)],
    ["Average trade, 2024 to 2026", (c) => signed(c.recent.avg_pct, 2), (c) => c.recent.avg_pct],
  ];
  return (
    <figure className="my-8">
      <figcaption className="mb-2 text-[15px] font-semibold text-foreground">{title}</figcaption>
      <div className="overflow-x-auto rounded-xl border border-border bg-card" tabIndex={0} role="region" aria-label={title}>
        <table className="w-full min-w-[460px] border-collapse text-[13.5px]">
          <thead>
            <tr>
              <th scope="col" className="border-b border-border px-3 py-2.5 text-left font-medium text-muted-foreground">
                After 0.5% costs per trade
              </th>
              {cols.map((c) => (
                <th key={c.name} scope="col" className={`border-b border-border px-3 py-2.5 text-right font-semibold ${c.ours ? "text-series-ours" : "text-foreground"}`}>
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, f, v]) => (
              <tr key={label}>
                <th scope="row" className="border-b border-border/60 px-3 py-2 text-left font-normal text-foreground">
                  {label}
                </th>
                {cols.map((c) => (
                  <td key={c.name} className={`num border-b border-border/60 px-3 py-2 text-right ${v ? tone(v(c)) : c.ours ? "text-foreground" : "text-foreground/80"} ${c.ours ? "font-medium" : ""}`}>
                    {f(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12.5px] text-muted-foreground">
        Each year&apos;s 300 most traded NSE stocks. The middle trade is the one in the middle when all trades are sorted from worst to best.
      </p>
    </figure>
  );
}

function BlockView({ b, post }: { b: Block; post: Post }) {
  const d = BLOG_DATA[post.rule];
  const names = { usualName: post.usualName, oursName: post.ruleName };
  switch (b.type) {
    case "p":
      return (
        <p className="my-5 text-[17px] leading-[1.75] text-foreground/90">
          <Inline text={b.text} />
        </p>
      );
    case "h2":
      return (
        <h2 id={b.id} className="display mt-12 scroll-mt-24 text-[26px] leading-tight text-foreground md:text-[30px]">
          {b.text}
        </h2>
      );
    case "h3":
      return <h3 className="mt-8 text-[19px] font-semibold text-foreground">{b.text}</h3>;
    case "list": {
      const L = b.ordered ? "ol" : "ul";
      return (
        <L className={`my-5 flex flex-col gap-3 pl-6 text-[17px] leading-[1.7] text-foreground/90 ${b.ordered ? "list-decimal" : "list-disc"} marker:text-muted-foreground`}>
          {b.items.map((it, i) => (
            <li key={i} className="pl-1">
              <Inline text={it} />
            </li>
          ))}
        </L>
      );
    }
    case "chart":
      if (b.chart === "periods") return <PeriodsChart usual={d.usual} ours={d.ours} title={b.title} caption={b.caption} {...names} />;
      if (b.chart === "years") return <YearsChart usual={d.usual} ours={d.ours} title={b.title} caption={b.caption} {...names} />;
      if (b.chart === "spread") return <SpreadChart usual={d.usual} ours={d.ours} title={b.title} caption={b.caption} {...names} />;
      return d.example ? <ExampleChart example={d.example} title={b.title} caption={b.caption} {...names} /> : null;
    case "table":
      return <CompareTable post={post} title={b.title} />;
    case "diagram":
      return <RuleDiagram rule={post.rule} caption={b.caption} />;
    case "callout":
      return (
        <aside className="my-6 flex gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
          <InfoIcon size={18} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-[14.5px] font-semibold text-foreground">{b.title}</p>
            <p className="mt-1 text-[14.5px] leading-6 text-foreground/85">
              <Inline text={b.text} />
            </p>
          </div>
        </aside>
      );
    case "stats":
      return <StatTiles post={post} />;
  }
}

export function PostBody({ post }: { post: Post }) {
  return (
    <>
      {post.blocks.map((b, i) =>
        // figures rise in as they scroll into view (ADR-054); running text stays put so reading is never disturbed
        b.type === "p" || b.type === "h2" || b.type === "h3" || b.type === "list" ? (
          <BlockView key={i} b={b} post={post} />
        ) : (
          <div key={i} className="reveal">
            <BlockView b={b} post={post} />
          </div>
        ),
      )}
    </>
  );
}
