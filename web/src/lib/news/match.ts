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
 * of India" is the central bank). A broker credited after "target of Rs 900:" is the
 * source of the call, not its subject.
 *
 * With ~3,600 listed names, `nameRankLimit` keeps the loose rules (any case, tickers) to the largest companies (plus
 * indices). With `smallNames`, every other listed company is matched more strictly (`smallNameForms`): its full name,
 * a one-word name only in its own capitals and never a common word, a shorter form ("VRL Logistics", "Tata
 * Teleservices") only in its own capitals and only when no other company shares it, and never its ticker.
 */
const PRECEDING_BLOCK = new Set(["reserve"]);
const SIBLING_WORDS = new Set([
  "green", "hotels", "life", "card", "cards", "finance", "financial", "technology", "technologies", "tech",
  "africa", "power", "capital", "infra", "invit", "general", "securities", "amc", "housing", "holdings",
  "ventures", "energy", "renewable", "renewables", "gas", "hexacom", "consumer", "mutual",
]);
/**
 * One-word listed names that are also everyday words, people's names, places, brands of other firms or a whole group
 * of companies: never matched on their own (found on 30 days of headlines, 19 Nov 2026). An alias can still add one.
 */
const COMMON_ONE_WORD = new Set([
  "take", "vera", "premier", "yogi", "suraj", "symphony", "nile", "midwest", "amal", "sonam", "skipper", "vipul",
  "kaya", "linc", "antarctica", "archies", "mazda", "kross", "pakka", "indiabulls", "gloster", "alembic", "kamdhenu",
  "ashima",
]);
/** Corporate words dropped from the end of a name to get the form headlines use ("Indo Count Industries" → "Indo Count"). */
const CORPORATE_TAIL = /\s+(?:\([^)]*\)|india|industries|enterprises|corporation|corp\.?|company|co\.?|international|and|&)$/i;
const BROKER_CREDIT = /\btarget(?: price)? of (?:Rs\.?|₹)\s?[\d,.]+\s*:\s*/gi;

export type MatchKind = "ticker" | "alias" | "name";
export type SymbolRef = { symbol: string; exchange: "NSE" | "BSE"; name: string; rank?: number | null; segment?: string | null };
export type Match = { symbol: string; exchange: "NSE" | "BSE"; kind: MatchKind; text: string };
export type MatcherOptions = { nameRankLimit?: number; smallNames?: boolean };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bounded = (s: string, flags: string) => new RegExp(`(?<![A-Za-z0-9])${escape(s)}(?![A-Za-z0-9])`, flags);

export function stripLegalSuffix(name: string): string {
  return name.replace(/\s+(limited|ltd\.?|ltd|l)$/i, "").trim(); // some listings are cut to "… L"
}

/**
 * The forms a smaller company is matched by (`exact` = only in the listed capitals). Empty for names that can't be
 * matched safely: a one-word name under 4 letters, with digits or odd marks (rights entitlements, InvITs, mislabelled
 * funds, test symbols), or one in COMMON_ONE_WORD.
 */
export function smallNameForms(listed: string): { text: string; exact: boolean }[] {
  const full = stripLegalSuffix(listed);
  const words = full.split(/\s+/);
  if (words.length === 1) {
    if (full.length < 4 || COMMON_ONE_WORD.has(full.toLowerCase())) return [];
    if (!/^[A-Za-z][A-Za-z-]*[A-Za-z](?:\.com)?$/.test(full) || /INVIT|BETA$/.test(full)) return [];
    return [{ text: full, exact: true }];
  }
  const out = [{ text: full, exact: false }];
  if (full === full.toUpperCase()) return out; // ALL-CAPS listing: its capitals say nothing about how headlines write it
  let short = full;
  while (CORPORATE_TAIL.test(short)) short = short.replace(CORPORATE_TAIL, "").trim();
  if (short !== full && short.split(/\s+/).length >= 2 && short.length >= 6) out.push({ text: short, exact: true });
  return out;
}

/** First word of a phrase, as `words()` would cut it: an entry whose first word isn't in the text can't match. */
const WORD = /[a-z0-9&]+/g;
const firstWord = (s: string) => s.toLowerCase().match(WORD)?.[0] ?? "";

type Entry = { re: RegExp; ref: SymbolRef; kind: MatchKind; text: string; first: string };

export class SymbolMatcher {
  private entries: Entry[] = [];

  constructor(symbols: SymbolRef[], aliases: { symbol: string; exchange: string; alias: string }[], opts: MatcherOptions = {}) {
    const bySym = new Map(symbols.map((s) => [`${s.exchange}:${s.symbol}`, s]));
    const limit = opts.nameRankLimit;
    const small: { ref: SymbolRef; text: string; exact: boolean }[] = [];
    for (const s of symbols) {
      if (s.segment === "etf") continue;
      if (limit != null && s.segment !== "index" && !(s.rank != null && s.rank <= limit)) {
        if (opts.smallNames) for (const f of smallNameForms(s.name)) small.push({ ref: s, ...f });
        continue;
      }
      const name = stripLegalSuffix(s.name);
      if (name.length >= 4) this.entries.push({ re: bounded(name, "i"), ref: s, kind: "name", text: name, first: firstWord(name) });
      if (s.symbol.length >= 4 && /^[A-Z0-9&-]+$/.test(s.symbol)) {
        this.entries.push({ re: bounded(s.symbol, ""), ref: s, kind: "ticker", text: s.symbol, first: firstWord(s.symbol) });
      }
    }
    // A form two companies share ("Asian Hotels" for North, East and West), or that is another company's name, is
    // nobody's.
    const owners = new Map<string, Set<string>>();
    for (const e of [...this.entries, ...small]) {
      const k = e.text.toLowerCase();
      (owners.get(k) ?? owners.set(k, new Set()).get(k)!).add(`${e.ref.exchange}:${e.ref.symbol}`);
    }
    for (const f of small) {
      if (owners.get(f.text.toLowerCase())!.size > 1) continue;
      this.entries.push({ re: bounded(f.text, f.exact ? "" : "i"), ref: f.ref, kind: "name", text: f.text, first: firstWord(f.text) });
    }
    for (const a of aliases) {
      const ref = bySym.get(`${a.exchange}:${a.symbol}`);
      if (!ref) continue;
      const caseSensitive = a.alias === a.alias.toUpperCase();
      this.entries.push({ re: bounded(a.alias, caseSensitive ? "" : "i"), ref, kind: "alias", text: a.alias, first: firstWord(a.alias) });
    }
    // Longer phrases first so "Tata Consultancy" wins over shorter hits for reporting.
    this.entries.sort((x, y) => y.text.length - x.text.length);
  }

  match(text: string): Match[] {
    const credits = brokerCredits(text);
    const words = new Set(text.toLowerCase().match(WORD) ?? []);
    const found = new Map<string, { m: Match; spans: [number, number][] }>();
    for (const e of this.entries) {
      if (!words.has(e.first)) continue; // cheap pre-check: ~3,600 names, a headline has a few dozen words
      const key = `${e.ref.exchange}:${e.ref.symbol}`;
      const spans = this.hits(e, text).filter(([a, b]) => !credits.some(([c, d]) => c <= a && b <= d));
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

/** "Buy X; target of Rs 900: Choice Institutional Equities - Moneycontrol": the span naming the broker. */
function brokerCredits(text: string): [number, number][] {
  return [...text.matchAll(BROKER_CREDIT)].map((m) => {
    const start = (m.index ?? 0) + m[0].length;
    const rest = text.slice(start, start + 45);
    const stop = rest.search(/\s[-–|]\s|;/);
    return [start, start + (stop < 0 ? rest.length : stop)];
  });
}
