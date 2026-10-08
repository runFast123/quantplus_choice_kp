/**
 * Finds which covered stocks a headline is about.
 *  - name:   the listed name minus "Limited/Ltd", case-insensitive
 *  - alias:  curated (news_symbol_aliases); case-sensitive when the alias is
 *            ALL CAPS ("ITC", "L&T") so ordinary words don't match
 *  - ticker: NSE symbol, case-sensitive, only when ≥ 4 characters
 * All matches respect word boundaries (letters/digits on either side block it).
 * A hit followed by a word that names a *different* listed entity is skipped:
 * "NTPC Green", "SBI Life", "ITC Hotels", "L&T Finance", "M&M Financial", "Airtel Africa".
 * A hit inside a longer matched name is dropped ("Bank of India" inside "State Bank
 * of India"), and one preceded by a word in PRECEDING_BLOCK is skipped ("Reserve Bank
 * of India" is the central bank). With ~3,600 listed names, `nameRankLimit` keeps
 * automatic name/ticker matching to the largest companies (plus indices); smaller
 * ones are matched through curated aliases and per-company search.
 */
const PRECEDING_BLOCK = new Set(["reserve"]);
const SIBLING_WORDS = new Set([
  "green", "hotels", "life", "card", "cards", "finance", "financial", "technology", "technologies", "tech",
  "africa", "power", "capital", "infra", "invit", "general", "securities", "amc", "housing", "holdings",
  "ventures", "energy", "renewable", "renewables", "gas", "hexacom", "consumer", "mutual",
]);
export type MatchKind = "ticker" | "alias" | "name";
export type SymbolRef = { symbol: string; exchange: "NSE" | "BSE"; name: string; rank?: number | null; segment?: string | null };
export type Match = { symbol: string; exchange: "NSE" | "BSE"; kind: MatchKind; text: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bounded = (s: string, flags: string) => new RegExp(`(?<![A-Za-z0-9])${escape(s)}(?![A-Za-z0-9])`, flags);

export function stripLegalSuffix(name: string): string {
  return name.replace(/\s+(limited|ltd\.?|ltd)$/i, "").trim();
}

type Entry = { re: RegExp; ref: SymbolRef; kind: MatchKind; text: string };

export class SymbolMatcher {
  private entries: Entry[] = [];

  constructor(symbols: SymbolRef[], aliases: { symbol: string; exchange: string; alias: string }[], opts: { nameRankLimit?: number } = {}) {
    const bySym = new Map(symbols.map((s) => [`${s.exchange}:${s.symbol}`, s]));
    const limit = opts.nameRankLimit;
    for (const s of symbols) {
      if (s.segment === "etf") continue;
      if (limit != null && s.segment !== "index" && !(s.rank != null && s.rank <= limit)) continue;
      const name = stripLegalSuffix(s.name);
      if (name.length >= 4) this.entries.push({ re: bounded(name, "i"), ref: s, kind: "name", text: name });
      if (s.symbol.length >= 4 && /^[A-Z0-9&-]+$/.test(s.symbol)) {
        this.entries.push({ re: bounded(s.symbol, ""), ref: s, kind: "ticker", text: s.symbol });
      }
    }
    for (const a of aliases) {
      const ref = bySym.get(`${a.exchange}:${a.symbol}`);
      if (!ref) continue;
      const caseSensitive = a.alias === a.alias.toUpperCase();
      this.entries.push({ re: bounded(a.alias, caseSensitive ? "" : "i"), ref, kind: "alias", text: a.alias });
    }
    // Longer phrases first so "Tata Consultancy" wins over shorter hits for reporting.
    this.entries.sort((x, y) => y.text.length - x.text.length);
  }

  match(text: string): Match[] {
    const found = new Map<string, { m: Match; spans: [number, number][] }>();
    for (const e of this.entries) {
      const key = `${e.ref.exchange}:${e.ref.symbol}`;
      const spans = this.hits(e, text);
      if (!spans.length) continue;
      const prev = found.get(key);
      if (prev) prev.spans.push(...spans);
      else found.set(key, { m: { symbol: e.ref.symbol, exchange: e.ref.exchange, kind: e.kind, text: e.text }, spans });
    }
    // Drop a symbol whose every hit sits inside a longer hit of another symbol.
    const all = [...found.entries()];
    return all
      .filter(([key, f]) =>
        !f.spans.every(([a, b]) => all.some(([k2, g]) => k2 !== key && g.spans.some(([c, d]) => c <= a && b <= d && d - c > b - a))),
      )
      .map(([, f]) => f.m);
  }

  /** Spans of occurrences not followed by a sibling-company word nor preceded by a blocked word. */
  private hits(e: Entry, text: string): [number, number][] {
    const re = new RegExp(e.re.source, e.re.flags.includes("g") ? e.re.flags : e.re.flags + "g");
    const own = e.text.toLowerCase().split(/\s+/);
    const out: [number, number][] = [];
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      const next = text.slice(end).match(/^\s+([A-Za-z]+)/)?.[1]?.toLowerCase();
      const before = text.slice(0, start).match(/([A-Za-z]+)\s+$/)?.[1]?.toLowerCase();
      if (before && PRECEDING_BLOCK.has(before) && !own.includes(before)) continue;
      if (!next || own.includes(next) || !SIBLING_WORDS.has(next)) out.push([start, end]);
    }
    return out;
  }

  matchesSymbol(text: string, symbol: string): boolean {
    return this.match(text).some((m) => m.symbol === symbol);
  }
}
