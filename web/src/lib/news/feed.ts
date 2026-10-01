import { XMLParser } from "fast-xml-parser";

/** One normalised feed item. RSS 2.0 and Atom are both handled. */
export type FeedItem = { title: string; link: string; summary: string | null; publishedAt: Date | null };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  cdataPropName: false,
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
});

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", rupee: "₹" };

/** Feeds often double-encode ("&amp;#8377;"); decode until stable. */
export function decodeEntities(s: string): string {
  let prev = "";
  let cur = s;
  for (let i = 0; i < 3 && cur !== prev; i++) {
    prev = cur;
    cur = cur
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
  }
  return cur;
}

export function cleanText(v: unknown, max = 400): string {
  const raw = typeof v === "string" ? v : v && typeof v === "object" && "#text" in v ? String((v as Record<string, unknown>)["#text"]) : v == null ? "" : String(v);
  const s = decodeEntities(raw.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** RFC 822 / ISO dates, plus NSE's "01-Oct-2026 10:55:00" (IST, no zone). */
export function parseFeedDate(v: unknown): Date | null {
  const s = cleanText(v, 80);
  if (!s) return null;
  const nse = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (nse) {
    const [, d, mon, y, h, mi, se] = nse;
    const m = MONTHS[mon.toLowerCase()];
    if (m == null) return null;
    // IST = UTC+05:30
    return new Date(Date.UTC(+y, m, +d, +h - 5, +mi - 30, se ? +se : 0));
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

function asArray<T>(v: T | T[] | undefined): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

function linkOf(v: unknown): string {
  if (typeof v === "string") return v.trim();
  for (const l of asArray(v as Record<string, unknown> | Record<string, unknown>[])) {
    if (l && typeof l === "object") {
      if (typeof l["@_href"] === "string" && (!l["@_rel"] || l["@_rel"] === "alternate")) return String(l["@_href"]).trim();
      if (typeof l["#text"] === "string") return String(l["#text"]).trim();
    }
  }
  return "";
}

export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const rssItems = asArray(doc?.rss?.channel?.item ?? doc?.["rdf:RDF"]?.item);
  const atomItems = asArray(doc?.feed?.entry);
  const out: FeedItem[] = [];
  for (const it of rssItems) {
    const title = cleanText(it.title, 400);
    const link = linkOf(it.link) || cleanText(it.guid, 1000);
    if (!title || !/^https?:\/\//.test(link)) continue;
    out.push({ title, link, summary: cleanText(it.description, 600) || null, publishedAt: parseFeedDate(it.pubDate ?? it["dc:date"]) });
  }
  for (const it of atomItems) {
    const title = cleanText(it.title, 400);
    const link = linkOf(it.link);
    if (!title || !/^https?:\/\//.test(link)) continue;
    out.push({ title, link, summary: cleanText(it.summary ?? it.content, 600) || null, publishedAt: parseFeedDate(it.published ?? it.updated) });
  }
  return out;
}

/** Strip tracking params so the same story from two feeds dedupes. */
export function normaliseUrl(u: string): string {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|from|ref)/i.test(k)) url.searchParams.delete(k);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return u.trim();
  }
}

/** NSE announcement links look like /corporate/INFY_01102026105448_Something.pdf */
export function nseFilingSymbol(link: string): string | null {
  const m = link.match(/\/corporate\/([A-Z0-9&-]+?)_\d{8,}/);
  return m ? m[1] : null;
}
