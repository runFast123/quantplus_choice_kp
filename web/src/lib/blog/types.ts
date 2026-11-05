// Types for the blog (/blog): the tested numbers (data.ts, generated) and the posts (posts.ts).

export type Stats = {
  trades: number;
  per_year: number;
  made_money_pct: number;
  avg_pct: number;
  median_pct: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  worst10_pct: number;
  best10_pct: number;
  avg_days: number;
};

export type YearRow = { year: number; trades: number; made_money_pct: number; avg_pct: number };

export type Side = { all: Stats; early: Stats; recent: Stats; years: YearRow[]; hist: number[] };

export type ExampleTrade = { signal: string; exit: string; result_pct: number };

export type Example = {
  symbol: string;
  closes: [string, number][];
  usual: ExampleTrade[];
  ours: ExampleTrade[];
} | null;

export type RuleKey = "sma" | "rsi" | "kk" | "strong" | "ma200";

export type RuleData = { usual: Side; ours: Side; example: Example; usualTrail?: Side };

export type BlogData = { method: string; firstDay: string; lastDay: string } & Record<RuleKey, RuleData>;

/** The result buckets of the spread chart, in order (from blog_compare.json's BINS), in words. */
export const HIST_LABELS = [
  "Lost 20% or more",
  "Lost 10 to 20%",
  "Lost 5 to 10%",
  "Lost 2 to 5%",
  "Lost up to 2%",
  "Made up to 2%",
  "Made 2 to 5%",
  "Made 5 to 10%",
  "Made 10 to 20%",
  "Made 20 to 40%",
  "Made 40% or more",
] as const;

export type ChartKind = "periods" | "years" | "spread" | "example";

/** A post is a list of blocks; text supports **bold** and [label](/path). */
export type Block =
  | { type: "p"; text: string }
  | { type: "h2"; id: string; text: string }
  | { type: "h3"; text: string }
  | { type: "list"; items: string[]; ordered?: boolean }
  | { type: "chart"; chart: ChartKind; title: string; caption: string }
  | { type: "table"; title: string }
  | { type: "diagram"; caption: string }
  | { type: "callout"; title: string; text: string }
  | { type: "stats" };

export type Post = {
  slug: string;
  rule: RuleKey;
  /** The rule's name, written without hyphens for the blog. */
  ruleName: string;
  /** What the usual way is called in the charts. */
  usualName: string;
  title: string;
  /** The <title> tag (the layout adds " · QuantsPulse"); under 60 characters. */
  seoTitle: string;
  description: string;
  keywords: string[];
  published: string;
  updated: string;
  /** The direct answer at the top (answer engines quote this). */
  answer: string;
  takeaways: string[];
  blocks: Block[];
  faq: { q: string; a: string }[];
};
