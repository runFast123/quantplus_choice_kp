/**
 * Finds which covered stocks a headline is about.
 *  - name:   the listed name minus "Limited/Ltd", case-insensitive
 *  - alias:  curated (news_symbol_aliases); case-sensitive when the alias is
 *            ALL CAPS ("ITC", "L&T") so ordinary words don't match
 *  - ticker: NSE symbol, case-sensitive, only when ≥ 4 characters
 * All matches respect word boundaries (letters/digits on either side block it).
 * A hit followed by a word that names a *different* listed entity is skipped:
 * "NTPC Green", "SBI Life", "ITC Hotels", "L&T Finance", "M&M Financial", "Airtel Africa".
 */
const SIBLING_WORDS = new Set([
  "green", "hotels", "life", "card", "cards", "finance", "financial", "technology", "technologies", "tech",
  "africa", "power", "capital", "infra", "invit", "general", "securities", "amc", "housing", "holdings",
  "ventures", "energy", "renewable", "renewables", "gas", "hexacom", "consumer", "mutual",
]);
export type MatchKind = "ticker" | "alias" | "name";
export type SymbolRef = { symbol: string; exchange: "NSE" | "BSE"; name: string };
export type Match = { symbol: string; exchange: "NSE" | "BSE"; kind: MatchKind; text: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bounded = (s: string, flags: string) => new RegExp(`(?<![A-Za-z0-9])${escape(s)}(?![A-Za-z0-9])`, flags);

export function stripLegalSuffix(name: string): string {
  return name.replace(/\s+(limited|ltd\.?|ltd)$/i, "").trim();
}

type Entry = { re: RegExp; ref: SymbolRef; kind: MatchKind; text: string };

export class SymbolMatcher {
  private entries: Entry[] = [];

  constructor(symbols: SymbolRef[], aliases: { symbol: string; exchange: string; alias: string }[]) {
    const bySym = new Map(symbols.map((s) => [`${s.exchange}:${s.symbol}`, s]));
    for (const s of symbols) {
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
    const found = new Map<string, Match>();
    for (const e of this.entries) {
      const key = `${e.ref.exchange}:${e.ref.symbol}`;
      if (found.has(key)) continue;
      if (this.hits(e, text)) found.set(key, { symbol: e.ref.symbol, exchange: e.ref.exchange, kind: e.kind, text: e.text });
    }
    return [...found.values()];
  }

  /** True if any occurrence of the entry is not immediately followed by a sibling-company word. */
  private hits(e: Entry, text: string): boolean {
    const re = new RegExp(e.re.source, e.re.flags.includes("g") ? e.re.flags : e.re.flags + "g");
    for (const m of text.matchAll(re)) {
      const next = text.slice((m.index ?? 0) + m[0].length).match(/^\s+([A-Za-z]+)/)?.[1]?.toLowerCase();
      const own = e.text.toLowerCase().split(/\s+/);
      if (!next || own.includes(next) || !SIBLING_WORDS.has(next)) return true;
    }
    return false;
  }

  matchesSymbol(text: string, symbol: string): boolean {
    return this.match(text).some((m) => m.symbol === symbol);
  }
}
