import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type NewsItem = {
  id: number;
  title: string;
  url: string;
  summary: string | null;
  published_at: string;
  tone: number | null;
  tone_label: string | null;
  tone_terms: string[];
  is_filing: boolean;
  category: string | null;
  source: string;
  symbols: string[];
};

export type ResearchFactor = { key: string; label: string; weight: number; score: number; detail: string; top_headline?: string | null };
export type ResearchNote = {
  symbol: string;
  exchange: "NSE" | "BSE";
  name: string;
  sector: string | null;
  as_of: string;
  score: number;
  stance: "constructive" | "neutral" | "cautious";
  prev_stance: string | null;
  prev_score: number | null;
  headline: string;
  factors: ResearchFactor[];
  news_count: number;
  filing_count: number;
  generated_at: string;
};

type Row = {
  id: number; title: string; url: string; summary: string | null; published_at: string; tone: number | null;
  tone_label: string | null; tone_terms: string[]; is_filing: boolean; category: string | null;
  news_sources: { name: string } | null; news_article_symbols: { symbol: string }[];
};

const SELECT = "id, title, url, summary, published_at, tone, tone_label, tone_terms, is_filing, category, news_sources(name), news_article_symbols(symbol)";

function toItem(r: Row): NewsItem {
  return {
    id: r.id, title: r.title, url: r.url, summary: r.summary, published_at: r.published_at,
    tone: r.tone == null ? null : Number(r.tone), tone_label: r.tone_label, tone_terms: r.tone_terms ?? [],
    is_filing: r.is_filing, category: r.category, source: r.news_sources?.name ?? "—",
    symbols: [...new Set((r.news_article_symbols ?? []).map((s) => s.symbol))],
  };
}

/**
 * Headlines, newest first. `symbols` restricts to articles linked to those
 * stocks (empty array → none); omit for the whole market feed.
 */
export async function getNews(
  db: SupabaseClient,
  opts: { symbols?: string[]; tone?: string; kind?: "news" | "filing"; limit?: number; before?: string } = {},
): Promise<NewsItem[]> {
  const limit = opts.limit ?? 40;
  if (opts.symbols && !opts.symbols.length) return [];

  // Filter through an aliased inner embed so ordering + limit apply to the
  // newest matching headlines (a separate id lookup hit max-rows and returned
  // arbitrary rows once a stock had >1000 links). The un-aliased embed still
  // returns every symbol on the article for the chips.
  let q = db
    .from("news_articles")
    .select(opts.symbols ? `${SELECT}, mine:news_article_symbols!inner(symbol)` : SELECT)
    .order("published_at", { ascending: false })
    .limit(limit);
  if (opts.symbols) q = q.in("mine.symbol", opts.symbols);
  if (opts.tone) q = q.eq("tone_label", opts.tone);
  if (opts.kind) q = q.eq("is_filing", opts.kind === "filing");
  if (opts.before) q = q.lt("published_at", opts.before);
  const { data } = await q;
  return ((data ?? []) as unknown as Row[]).map(toItem);
}

export function normalizeNote(r: Record<string, unknown>): ResearchNote {
  return {
    ...(r as unknown as ResearchNote),
    score: Number(r.score),
    prev_score: r.prev_score == null ? null : Number(r.prev_score),
    factors: ((r.factors ?? []) as ResearchFactor[]).map((f) => ({ ...f, score: Number(f.score), weight: Number(f.weight) })),
  };
}

export async function getResearch(db: SupabaseClient, symbols?: string[]): Promise<ResearchNote[]> {
  let q = db.from("research_latest").select("*");
  if (symbols) {
    if (!symbols.length) return [];
    q = q.in("symbol", symbols);
  }
  const { data } = await q;
  return (data ?? []).map(normalizeNote);
}
