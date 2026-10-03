import "server-only";

import { createHash } from "node:crypto";
import { nseFilingSymbol, normaliseUrl, parseFeed, type FeedItem } from "@/lib/news/feed";
import { SymbolMatcher, stripLegalSuffix, type Match, type SymbolRef } from "@/lib/news/match";
import { scoreTone } from "@/lib/news/tone";
import { serviceRole } from "./service-role";

/**
 * RSS ingestion pipeline (writes global market tables — spec §5.7 says only
 * pipelines with the service role may). Only URLs stored in news_sources are
 * fetched, never user input, so there is no SSRF surface. Keeps headline,
 * short summary and link — never article bodies.
 */
const MAX_AGE_DAYS = 14;
const MAX_BYTES = 3_000_000;
const UA = "Mozilla/5.0 (compatible; QuantsPulseBot/1.0; +https://quantspulse.in/bot)"; // honest bot UA — never a browser string

type Source = { id: number; code: string; name: string; feed_url: string; kind: "news" | "filing" | "search" };
type Candidate = {
  source_id: number;
  url: string;
  url_hash: string;
  title: string;
  summary: string | null;
  category: string | null;
  is_filing: boolean;
  published_at: string;
  tone: number | null;
  tone_label: string | null;
  tone_terms: string[];
  links: Match[] | { symbol: string; exchange: "NSE" | "BSE"; kind: "filing"; text: string }[];
};

export type IngestReport = {
  startedAt: string;
  durationMs: number;
  sources: { code: string; status: string; items: number; fresh: number; error?: string }[];
  inserted: number;
  linked: number;
  researchRows: number | null;
  errors: string[];
};

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5" },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new Error("feed too large");
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error("feed too large");
  return text;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function toCandidate(source: Source, item: FeedItem, links: Candidate["links"], extra: Partial<Candidate> = {}): Candidate | null {
  const published = item.publishedAt ?? new Date();
  if (Date.now() - published.getTime() > MAX_AGE_DAYS * 86400000) return null;
  if (published.getTime() - Date.now() > 3600000) return null; // future-dated junk
  const url = normaliseUrl(item.link);
  const tone = source.kind === "filing" ? null : scoreTone(`${item.title}. ${item.summary ?? ""}`);
  return {
    source_id: source.id,
    url,
    url_hash: sha(url),
    title: item.title.slice(0, 400),
    summary: item.summary?.slice(0, 600) ?? null,
    category: null,
    is_filing: source.kind === "filing",
    published_at: published.toISOString(),
    tone: tone?.score ?? null,
    tone_label: tone?.label ?? null,
    tone_terms: tone?.terms ?? [],
    links,
    ...extra,
  };
}

/**
 * Fetch every active feed, plus per-company search for the `searchSymbols`
 * stalest symbols, then store new items and refresh research notes.
 */
export async function ingestNews(opts: { searchSymbols?: number } = {}): Promise<IngestReport> {
  const started = Date.now();
  const db = serviceRole();
  const searchSymbols = opts.searchSymbols ?? 8;

  const [{ data: sources }, { data: symbols }, { data: aliases }] = await Promise.all([
    db.from("news_sources").select("id, code, name, feed_url, kind").eq("is_active", true).order("id"),
    db.from("market_symbols").select("symbol, exchange, name").eq("is_active", true),
    db.from("news_symbol_aliases").select("symbol, exchange, alias"),
  ]);
  const matcher = new SymbolMatcher((symbols ?? []) as SymbolRef[], aliases ?? []);
  const covered = new Map(((symbols ?? []) as SymbolRef[]).map((s) => [s.symbol, s]));

  const report: IngestReport = { startedAt: new Date(started).toISOString(), durationMs: 0, sources: [], inserted: 0, linked: 0, researchRows: null, errors: [] };
  const candidates = new Map<string, Candidate>();
  const add = (c: Candidate | null) => {
    if (!c) return 0;
    const prev = candidates.get(c.url_hash);
    if (prev) {
      // Same story from two feeds/searches: keep one row, union the symbol links.
      const seen = new Set(prev.links.map((l) => l.symbol));
      prev.links = [...prev.links, ...c.links.filter((l) => !seen.has(l.symbol))] as Candidate["links"];
      return 0;
    }
    candidates.set(c.url_hash, c);
    return 1;
  };

  for (const source of (sources ?? []) as Source[]) {
    if (source.kind === "search") continue;
    try {
      const items = parseFeed(await fetchText(source.feed_url));
      let fresh = 0;
      for (const item of items) {
        if (source.kind === "filing") {
          const sym = nseFilingSymbol(item.link);
          if (!sym || !covered.has(sym)) continue; // only filings for stocks we cover
          const [about, subject] = (item.summary ?? "").split("|SUBJECT:");
          const s = covered.get(sym)!;
          fresh += add(
            toCandidate(source, { ...item, title: `${stripLegalSuffix(s.name)}: ${subject?.trim() || "Exchange filing"}`, summary: about?.trim() || null },
              [{ symbol: sym, exchange: "NSE", kind: "filing", text: sym }], { category: subject?.trim() || null }),
          );
        } else {
          fresh += add(toCandidate(source, item, matcher.match(`${item.title} ${item.summary ?? ""}`)));
        }
      }
      report.sources.push({ code: source.code, status: "ok", items: items.length, fresh });
    } catch (e) {
      report.sources.push({ code: source.code, status: "error", items: 0, fresh: 0, error: (e as Error).message.slice(0, 200) });
    }
  }

  // Per-company search, rotating through the stalest symbols.
  const search = ((sources ?? []) as Source[]).find((s) => s.kind === "search");
  if (search && searchSymbols > 0) {
    const { data: due } = await db
      .from("news_search_cursor")
      .select("symbol, exchange, last_fetched_at")
      .order("last_fetched_at", { ascending: true, nullsFirst: true })
      .limit(searchSymbols);
    let items = 0;
    let fresh = 0;
    const errors: string[] = [];
    for (const d of due ?? []) {
      const s = covered.get(d.symbol);
      if (!s) continue;
      const query = encodeURIComponent(`"${stripLegalSuffix(s.name)}" share OR stock`);
      try {
        const found = parseFeed(await fetchText(search.feed_url.replace("{query}", query))).slice(0, 25);
        items += found.length;
        for (const item of found) {
          // Search results are noisy: keep only headlines that name the company.
          const m = matcher.match(item.title).filter((x) => x.symbol === s.symbol);
          if (!m.length) continue;
          fresh += add(toCandidate(search, item, m));
        }
        await db.from("news_search_cursor").update({ last_fetched_at: new Date().toISOString() }).eq("symbol", d.symbol).eq("exchange", d.exchange);
      } catch (e) {
        errors.push(`${d.symbol}: ${(e as Error).message}`);
      }
    }
    report.sources.push({ code: search.code, status: errors.length ? "partial" : "ok", items, fresh, ...(errors.length ? { error: errors.join("; ").slice(0, 200) } : {}) });
  }

  // Store. svc_store_news_articles skips a story already present under the same
  // URL or the same headline + publish time (Google News re-issues redirect URLs),
  // atomically, so overlapping runs (cron + admin "Fetch now") can't collide. It
  // returns an id for EVERY candidate, so links are written for stories stored
  // earlier too (e.g. a search hit on a story first seen via RSS).
  try {
    const all = [...candidates.values()];
    const idByHash = new Map<string, number>();
    for (let i = 0; i < all.length; i += 100) {
      const batch = all.slice(i, i + 100).map((c) => {
        const row: Partial<Candidate> = { ...c };
        delete row.links;
        return row;
      });
      const { data, error } = await db.rpc("svc_store_news_articles", { p_rows: batch });
      if (error) throw new Error(`news_articles: ${error.message}`);
      for (const r of (data ?? []) as { url_hash: string; article_id: number | null; inserted: boolean }[]) {
        if (r.inserted) report.inserted += 1;
        if (r.article_id != null) idByHash.set(r.url_hash, r.article_id);
      }
    }
    const links = all.flatMap((c) => {
      const id = idByHash.get(c.url_hash);
      return id == null ? [] : c.links.map((l) => ({ article_id: id, symbol: l.symbol, exchange: l.exchange, match_kind: l.kind, matched_text: l.text }));
    });
    for (let i = 0; i < links.length; i += 500) {
      const { error } = await db.from("news_article_symbols").upsert(links.slice(i, i + 500), { onConflict: "article_id,symbol,exchange", ignoreDuplicates: true });
      if (error) throw new Error(`news_article_symbols: ${error.message}`);
    }
    report.linked = links.length;
  } catch (e) {
    // Keep going: feed health and the research refresh still run.
    report.errors.push(`store: ${(e as Error).message}`.slice(0, 300));
  }

  // Record feed health (ops-only columns; members can't read them).
  const now = new Date().toISOString();
  for (const s of report.sources) {
    await db
      .from("news_sources")
      .update({ last_fetched_at: now, last_status: s.status, last_item_count: s.items, last_error: s.error ?? null })
      .eq("code", s.code);
  }

  const { data: researchRows, error: rErr } = await db.rpc("svc_refresh_research");
  if (rErr) report.errors.push(`research: ${rErr.message}`.slice(0, 300));
  report.researchRows = typeof researchRows === "number" ? researchRows : null;
  report.durationMs = Date.now() - started;
  return report;
}

/**
 * Recompute symbol links for recent non-filing headlines with the current
 * matcher (run after improving aliases or matching rules).
 */
export async function relinkRecentArticles(days = MAX_AGE_DAYS) {
  const db = serviceRole();
  const [{ data: symbols }, { data: aliases }] = await Promise.all([
    db.from("market_symbols").select("symbol, exchange, name").eq("is_active", true),
    db.from("news_symbol_aliases").select("symbol, exchange, alias"),
  ]);
  const matcher = new SymbolMatcher((symbols ?? []) as SymbolRef[], aliases ?? []);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  // Page through everything (PostgREST caps responses at 1000 rows).
  const articles: { id: number; title: string; summary: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("news_articles")
      .select("id, title, summary")
      .eq("is_filing", false)
      .gte("published_at", since)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`relink read: ${error.message}`);
    articles.push(...((data ?? []) as typeof articles));
    if (!data || data.length < 1000) break;
  }

  // Add the new links first, then remove stale ones: articles are never left unlinked.
  const want = new Map<number, Set<string>>();
  const links = articles.flatMap((a) =>
    matcher.match(`${a.title} ${a.summary ?? ""}`).map((m) => {
      (want.get(a.id) ?? want.set(a.id, new Set()).get(a.id)!).add(`${m.exchange}:${m.symbol}`);
      return { article_id: a.id, symbol: m.symbol, exchange: m.exchange, match_kind: m.kind, matched_text: m.text };
    }),
  );
  for (let i = 0; i < links.length; i += 500) {
    const { error } = await db.from("news_article_symbols").upsert(links.slice(i, i + 500), { onConflict: "article_id,symbol,exchange" });
    if (error) throw new Error(`relink write: ${error.message}`);
  }
  let removed = 0;
  for (let i = 0; i < articles.length; i += 200) {
    const ids = articles.slice(i, i + 200).map((a) => a.id);
    const { data: current, error } = await db.from("news_article_symbols").select("article_id, symbol, exchange, match_kind").in("article_id", ids).limit(5000);
    if (error) throw new Error(`relink scan: ${error.message}`);
    for (const l of current ?? []) {
      if (l.match_kind === "filing" || want.get(l.article_id)?.has(`${l.exchange}:${l.symbol}`)) continue;
      const { error: dErr } = await db.from("news_article_symbols").delete().eq("article_id", l.article_id).eq("symbol", l.symbol).eq("exchange", l.exchange);
      if (dErr) throw new Error(`relink delete: ${dErr.message}`);
      removed++;
    }
  }
  const { data: researchRows } = await db.rpc("svc_refresh_research");
  return { articles: articles.length, links: links.length, removed, researchRows };
}

export async function newsSourceHealth() {
  const { data } = await serviceRole()
    .from("news_sources")
    .select("code, name, kind, is_active, last_fetched_at, last_status, last_item_count, last_error")
    .order("id");
  return data ?? [];
}
