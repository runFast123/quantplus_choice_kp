import "server-only";

import { createHash } from "node:crypto";
import { isQuotePage, nseFilingSymbol, normaliseUrl, parseFeed, type FeedItem } from "@/lib/news/feed";
import { SymbolMatcher, smallNameForms, stripLegalSuffix, type Match, type SymbolRef } from "@/lib/news/match";
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

/**
 * The largest companies are matched loosely (any case, tickers); every other listed company by its name under stricter
 * rules (`smallNameForms`, ADR-062).
 */
const NAME_RANK_LIMIT = 500;
const matcherFor = (symbols: SymbolRef[], aliases: { symbol: string; exchange: string; alias: string }[]) =>
  new SymbolMatcher(symbols, aliases, { nameRankLimit: NAME_RANK_LIMIT, smallNames: true });

/** Per-company search: this many at once, and the query only asks for the window we keep. */
const SEARCH_CONCURRENCY = 4;
const SEARCH_WINDOW = `when:${MAX_AGE_DAYS}d`;

/** Every active symbol (paged: PostgREST caps responses at 1,000 rows). */
async function activeSymbols(db: ReturnType<typeof serviceRole>): Promise<SymbolRef[]> {
  const out: SymbolRef[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("market_symbols")
      .select("symbol, exchange, name, mcap_rank, segment")
      .eq("is_active", true)
      .order("symbol")
      .range(from, from + 999);
    if (error) throw new Error(`symbols: ${error.message}`);
    out.push(...(data ?? []).map((r) => ({ symbol: r.symbol, exchange: r.exchange, name: r.name, rank: r.mcap_rank, segment: r.segment }) as SymbolRef));
    if (!data || data.length < 1000) return out;
  }
}


function toCandidate(source: Source, item: FeedItem, links: Candidate["links"], extra: Partial<Candidate> = {}): Candidate | null {
  if (isQuotePage(item.title)) return null; // a quote or chart page, not news
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

type Db = ReturnType<typeof serviceRole>;
type Alias = { symbol: string; exchange: string; alias: string };
type Claimed = { symbol: string; exchange: "NSE" | "BSE"; name: string; mcap_rank: number | null; segment: string };

/** Collects candidates by URL; the same story from two feeds or searches keeps one row with the union of its links. */
class Candidates {
  readonly byHash = new Map<string, Candidate>();
  add(c: Candidate | null): number {
    if (!c) return 0;
    const prev = this.byHash.get(c.url_hash);
    if (prev) {
      const seen = new Set(prev.links.map((l) => l.symbol));
      prev.links = [...prev.links, ...c.links.filter((l) => !seen.has(l.symbol))] as Candidate["links"];
      return 0;
    }
    this.byHash.set(c.url_hash, c);
    return 1;
  }
}

/** The name a company's search asks for: the shorter form headlines use when there is one ("Indo Count"). */
function searchName(s: SymbolRef): string {
  const forms = s.rank != null && s.rank <= NAME_RANK_LIMIT ? [] : smallNameForms(s.name);
  return forms.find((f) => f.exact && f.text.includes(" "))?.text ?? stripLegalSuffix(s.name);
}

/**
 * Google News search for each claimed stock, SEARCH_CONCURRENCY at a time. A result is kept only when its headline
 * names that stock (by the full matcher, so the sibling and look-alike guards apply); other stocks the headline names
 * are linked too. If the site asks us to slow down (429/503) no further searches start, and the stocks not reached
 * go back to the front of the queue.
 */
async function searchCompanies(db: Db, search: Source, due: SymbolRef[], matcher: SymbolMatcher, out: Candidates) {
  let items = 0;
  let fresh = 0;
  const errors: string[] = [];
  const notReached: SymbolRef[] = [];
  let throttled = false;
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < due.length; i = next++) {
      const s = due[i];
      if (throttled) {
        notReached.push(s);
        continue;
      }
      const query = encodeURIComponent(`"${searchName(s)}" share OR stock ${SEARCH_WINDOW}`);
      try {
        const found = parseFeed(await fetchText(search.feed_url.replace("{query}", query))).slice(0, 25);
        items += found.length;
        for (const item of found) {
          const m = matcher.match(item.title);
          if (m.some((x) => x.symbol === s.symbol && x.exchange === s.exchange)) fresh += out.add(toCandidate(search, item, m));
        }
      } catch (e) {
        const msg = (e as Error).message;
        if (/HTTP (429|503)/.test(msg)) throttled = true;
        errors.push(`${s.symbol}: ${msg}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SEARCH_CONCURRENCY, due.length) }, worker));
  if (notReached.length) {
    await db.from("news_search_cursor").update({ last_fetched_at: null }).in("symbol", notReached.map((s) => s.symbol));
  }
  return { code: search.code, status: errors.length ? "partial" : "ok", items, fresh, ...(errors.length ? { error: errors.join("; ").slice(0, 200) } : {}) };
}

/**
 * Store candidates and their links. svc_store_news_articles skips a story already present under the same URL or the
 * same headline + publish time (Google News re-issues redirect URLs), atomically, so overlapping runs (cron + admin
 * "Fetch now" + a stock page) can't collide. It returns an id for EVERY candidate, so links are written for stories
 * stored earlier too (a search hit on a story first seen via RSS). Returns the stocks that got a link.
 */
async function storeCandidates(db: Db, candidates: Candidates, report: { inserted: number; linked: number }): Promise<Set<string>> {
  const all = [...candidates.byHash.values()];
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
  report.linked += links.length;
  return new Set(links.map((l) => l.symbol));
}

const toRef = (c: Claimed): SymbolRef => ({ symbol: c.symbol, exchange: c.exchange, name: c.name, rank: c.mcap_rank, segment: c.segment });

/**
 * Fetch every active feed, plus per-company search for the next `searchSymbols` stocks in the queue
 * (svc_claim_news_search: stocks someone watches or holds first, then never-searched and stalest), then store new
 * items and refresh the research notes of the stocks that got a headline.
 */
export async function ingestNews(opts: { searchSymbols?: number } = {}): Promise<IngestReport> {
  const started = Date.now();
  const db = serviceRole();
  const searchSymbols = opts.searchSymbols ?? 40;

  const [{ data: sources }, symbols, { data: aliases }] = await Promise.all([
    db.from("news_sources").select("id, code, name, feed_url, kind").eq("is_active", true).order("id"),
    activeSymbols(db),
    db.from("news_symbol_aliases").select("symbol, exchange, alias"),
  ]);
  const matcher = matcherFor(symbols, aliases ?? []);
  const covered = new Map(symbols.map((s) => [s.symbol, s]));

  const report: IngestReport = { startedAt: new Date(started).toISOString(), durationMs: 0, sources: [], inserted: 0, linked: 0, researchRows: null, errors: [] };
  const candidates = new Candidates();
  const feeds = ((sources ?? []) as Source[]).filter((s) => s.kind !== "search");
  const search = ((sources ?? []) as Source[]).find((s) => s.kind === "search");

  // Feeds and the per-company search run side by side (different sites; the slowest feed no longer holds up search).
  const readFeeds = Promise.all(
    feeds.map(async (source) => {
      try {
        const items = parseFeed(await fetchText(source.feed_url));
        let fresh = 0;
        for (const item of items) {
          if (source.kind === "filing") {
            const directSym = nseFilingSymbol(item.link);
            if (directSym && covered.has(directSym)) {
              const [about, subject] = (item.summary ?? "").split("|SUBJECT:");
              const s = covered.get(directSym)!;
              fresh += candidates.add(
                toCandidate(
                  source,
                  { ...item, title: `${stripLegalSuffix(s.name)}: ${subject?.trim() || "Exchange filing"}`, summary: about?.trim() || null },
                  [{ symbol: directSym, exchange: "NSE", kind: "filing", text: directSym }],
                  { category: subject?.trim() || "Exchange filing" },
                ),
              );
            } else {
              // Corporate announcements feed: match symbols using company matcher
              const filingLinks = matcher.match(`${item.title} ${item.summary ?? ""}`).map((m) => ({
                symbol: m.symbol,
                exchange: m.exchange,
                kind: "filing" as const,
                text: m.text,
              }));
              fresh += candidates.add(toCandidate(source, item, filingLinks, { category: "Corporate announcement" }));
            }
          } else {
            fresh += candidates.add(toCandidate(source, item, matcher.match(`${item.title} ${item.summary ?? ""}`)));
          }
        }
        return { code: source.code, status: "ok", items: items.length, fresh };
      } catch (e) {
        return { code: source.code, status: "error", items: 0, fresh: 0, error: (e as Error).message.slice(0, 200) };
      }
    }),
  );
  const runSearch = (async () => {
    if (!search || searchSymbols <= 0) return null;
    const { data: due, error } = await db.rpc("svc_claim_news_search", { p_limit: searchSymbols });
    if (error) return { code: search.code, status: "error", items: 0, fresh: 0, error: `claim: ${error.message}`.slice(0, 200) };
    return searchCompanies(db, search, ((due ?? []) as Claimed[]).map(toRef), matcher, candidates);
  })();
  const [feedReports, searchReport] = await Promise.all([readFeeds, runSearch]);
  report.sources.push(...feedReports, ...(searchReport ? [searchReport] : []));

  let touchedSymbols = new Set<string>();
  try {
    touchedSymbols = await storeCandidates(db, candidates, report);
  } catch (e) {
    // Keep going: feed health and the research refresh still run.
    report.errors.push(`store: ${(e as Error).message}`.slice(0, 300));
  }

  // Record feed health (ops-only columns; members can't read them).
  const now = new Date().toISOString();
  await Promise.all(
    report.sources.map((s) =>
      db.from("news_sources").update({ last_fetched_at: now, last_status: s.status, last_item_count: s.items, last_error: s.error ?? null }).eq("code", s.code),
    ),
  );

  // Only the stocks that got a headline in this run: the whole market in one call runs past the API's 8 s statement
  // limit (every run from 9 Nov 2026 was cancelled). The database cron rebuilds every note after each price load.
  try {
    report.researchRows = await refreshResearch(db, touchedSymbols);
  } catch (e) {
    report.errors.push(`research: ${(e as Error).message}`.slice(0, 300));
  }
  report.durationMs = Date.now() - started;
  return report;
}

/** The symbols and aliases a one-stock refresh matches against, kept for an hour per server instance. */
let cachedMatcher: { at: number; matcher: SymbolMatcher; search: Source | null } | null = null;
async function sharedMatcher(db: Db) {
  if (cachedMatcher && Date.now() - cachedMatcher.at < 3600_000) return cachedMatcher;
  const [symbols, { data: aliases }, { data: search }] = await Promise.all([
    activeSymbols(db),
    db.from("news_symbol_aliases").select("symbol, exchange, alias"),
    db.from("news_sources").select("id, code, name, feed_url, kind").eq("kind", "search").eq("is_active", true).limit(1).maybeSingle(),
  ]);
  cachedMatcher = { at: Date.now(), matcher: matcherFor(symbols, (aliases ?? []) as Alias[]), search: (search as Source | null) ?? null };
  return cachedMatcher;
}

/**
 * Fresh headlines for one stock when a member opens its page (run in `after()`, so the page never waits). Searches
 * only when the stock's last search is over 6 hours old and the site isn't busy (svc_claim_news_search), so however
 * many people open the page, the news site sees at most one request per stock per 6 hours. `newest` is the stock's
 * latest stored headline: one from the last 6 hours means nothing to do (no database call). Returns the stories stored.
 */
export async function refreshSymbolNews(symbol: string, newest: string | null = null): Promise<number> {
  if (newest && Date.now() - Date.parse(newest) < 6 * 3600_000) return 0;
  const db = serviceRole();
  const { data: due, error } = await db.rpc("svc_claim_news_search", { p_limit: 1, p_symbols: [symbol] });
  if (error || !due?.length) return 0;
  const { matcher, search } = await sharedMatcher(db);
  if (!search) return 0;
  const candidates = new Candidates();
  await searchCompanies(db, search, (due as Claimed[]).map(toRef), matcher, candidates);
  const report = { inserted: 0, linked: 0 };
  const touched = await storeCandidates(db, candidates, report);
  if (touched.size) await refreshResearch(db, touched);
  return report.inserted;
}

/**
 * Recompute symbol links for recent non-filing headlines with the current
 * matcher (run after improving aliases or matching rules).
 */
export async function relinkRecentArticles(days = MAX_AGE_DAYS) {
  const db = serviceRole();
  const [symbols, { data: aliases }] = await Promise.all([activeSymbols(db), db.from("news_symbol_aliases").select("symbol, exchange, alias")]);
  const matcher = matcherFor(symbols, aliases ?? []);
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
  const changed = new Set<string>(); // stocks whose notes need a rebuild: every link kept, added or removed
  const want = new Map<number, Set<string>>();
  // A quote or chart page stored before isQuotePage existed keeps no links, so it leaves the stock pages.
  const links = articles.flatMap((a) =>
    (isQuotePage(a.title) ? [] : matcher.match(`${a.title} ${a.summary ?? ""}`)).map((m) => {
      (want.get(a.id) ?? want.set(a.id, new Set()).get(a.id)!).add(`${m.exchange}:${m.symbol}`);
      changed.add(m.symbol);
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
      changed.add(l.symbol);
      removed++;
    }
  }
  const researchRows = await refreshResearch(db, [...changed]);
  return { articles: articles.length, links: links.length, removed, researchRows };
}

const RESEARCH_CHUNK = 100; // symbols per call, as in pipelines/eod (300 took 6.5 s on a cold cache)

/**
 * Rebuild the research notes of `symbols`, 100 to a call. A batch that hits the 8 s statement limit (SQLSTATE 57014;
 * the call is one transaction, so nothing of it was kept) is split in half and run again, down to one symbol, which
 * throws. Returns the number of notes written.
 */
export async function refreshResearch(db: ReturnType<typeof serviceRole>, symbols: Iterable<string>): Promise<number> {
  const all = [...new Set(symbols)].sort();
  const run = async (part: string[]): Promise<number> => {
    const { data, error } = await db.rpc("svc_refresh_research", { p_symbols: part });
    if (!error) return typeof data === "number" ? data : 0;
    if (error.code !== "57014" || part.length <= 1) throw new Error(error.message);
    const half = Math.ceil(part.length / 2);
    return (await run(part.slice(0, half))) + (await run(part.slice(half)));
  };
  let rows = 0;
  for (let i = 0; i < all.length; i += RESEARCH_CHUNK) rows += await run(all.slice(i, i + RESEARCH_CHUNK));
  return rows;
}

export async function newsSourceHealth() {
  const { data } = await serviceRole()
    .from("news_sources")
    .select("code, name, kind, is_active, last_fetched_at, last_status, last_item_count, last_error")
    .order("id");
  return data ?? [];
}
