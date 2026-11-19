/**
 * The admin Signals tab (ADR-063): what the seven rules did on one session's close, grouped by stock and by rule, with
 * the filters the tab offers. Pure: the page reads the rows (trading_signals, signal_watch, market_snapshot) and hands
 * them here. Tests: admin-signals.test.mts.
 */
import { RULES, isRule, type RuleKey } from "./rules";

/** What a row means for the session after the close:
 * buy   — a rule's buy on this close (trend rules buy at the next open; a dip rule's row is its fill during the day),
 * level — a dip rule's buy level for the next session (bought only if the price trades there),
 * exit  — a rule closed its trade. */
export type SignalKind = "buy" | "level" | "exit";

export type DaySignal = {
  symbol: string;
  strategy: RuleKey;
  kind: SignalKind;
  /** The close the signal was on; for a dip fill, the fill price. */
  close: number | null;
  stop: number | null;
  /** The dip-buy level (kind level) or the price filled at (dip buy). */
  limit: number | null;
  /** The finished trade's result in percent (kind exit). */
  resultPct: number | null;
  /** How the trade ended, in the rule's words (kind exit): "sold on the bounce". */
  how: string | null;
  /** The setup day the signal checks key on (a dip's setup close; otherwise the signal day). */
  checkDay: string;
};

export type StockInfo = {
  name: string;
  sector: string | null;
  segment: string | null;
  rank: number | null;
  last: number | null;
  changePct: number | null;
};

export type StockRow = StockInfo & {
  symbol: string;
  signals: DaySignal[];
  /** The rules that fired on it, in the order every page lists them. */
  rules: RuleKey[];
  buys: number;
  levels: number;
  exits: number;
};

/**
 * Every session the tab offers, sent to the browser once, so switching sessions and filtering never wait for the server.
 * Plain JSON (no Maps): `byDay[day]` are that close's signals, `info[symbol]` the stock, `tags` the signal-check keys.
 */
export type SignalSessions = {
  /** The latest close the rules have run on (its dip levels are for the next session). */
  latestRun: string | null;
  /** The newest prices are in but the rules have not run on them yet. */
  pending: string | null;
  sessions: { day: string; weather: string | null; stocks: number }[];
  byDay: Record<string, DaySignal[]>;
  info: Record<string, StockInfo>;
  tags: string[];
};

const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const ORDER = RULES.map((r) => r.key as RuleKey);

/** The India-time day of a timestamp ("2026-11-18"). */
export const istDay = (ts: string) => new Date(Date.parse(ts) + 330 * 60_000).toISOString().slice(0, 10);

/** A stored signal (trading_signals) as a row of the tab; null for an old rule or anything that is not a buy or exit. */
export function fromSignal(row: { symbol: string; strategy: string; generated_at: string; payload: Record<string, unknown> | null }): DaySignal | null {
  if (!isRule(row.strategy)) return null;
  const p = row.payload ?? {};
  const action = p.action;
  if (action !== "buy" && action !== "exit") return null;
  const label = typeof p.label === "string" ? p.label : "";
  const setup = typeof p.signal_day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.signal_day) ? p.signal_day : istDay(row.generated_at);
  return {
    symbol: row.symbol,
    strategy: row.strategy,
    kind: action,
    close: num(p.close),
    stop: action === "buy" ? num(p.stop) : null,
    limit: action === "buy" ? num(p.fill) : null,
    resultPct: action === "exit" ? num(p.pnl_pct) : null,
    how: action === "exit" && label.includes(":") ? label.slice(label.indexOf(":") + 1).trim() : null,
    checkDay: setup,
  };
}

/** A dip-buy level for the next session (signal_watch) as a row of the tab. */
export function fromWatch(row: { symbol: string; strategy: string; signal_day: string; limit_price: unknown; stop: unknown; payload: Record<string, unknown> | null }): DaySignal | null {
  if (!isRule(row.strategy)) return null;
  return {
    symbol: row.symbol,
    strategy: row.strategy,
    kind: "level",
    close: num(row.payload?.signal_close),
    stop: num(row.stop),
    limit: num(row.limit_price),
    resultPct: null,
    how: null,
    checkDay: row.signal_day.slice(0, 10),
  };
}

/** One row per stock, its signals in rule order (buys, then levels, then exits within a rule). */
export function groupByStock(signals: DaySignal[], info: Map<string, StockInfo>): StockRow[] {
  const kindOrder: Record<SignalKind, number> = { buy: 0, level: 1, exit: 2 };
  const by = new Map<string, DaySignal[]>();
  for (const s of signals) by.set(s.symbol, [...(by.get(s.symbol) ?? []), s]);
  return [...by.entries()].map(([symbol, list]) => {
    list.sort((a, b) => ORDER.indexOf(a.strategy) - ORDER.indexOf(b.strategy) || kindOrder[a.kind] - kindOrder[b.kind]);
    const meta = info.get(symbol);
    return {
      symbol,
      name: meta?.name ?? symbol,
      sector: meta?.sector ?? null,
      segment: meta?.segment ?? null,
      rank: meta?.rank ?? null,
      last: meta?.last ?? null,
      changePct: meta?.changePct ?? null,
      signals: list,
      rules: [...new Set(list.map((s) => s.strategy))],
      buys: list.filter((s) => s.kind === "buy").length,
      levels: list.filter((s) => s.kind === "level").length,
      exits: list.filter((s) => s.kind === "exit").length,
    };
  });
}

export type RuleCount = { rule: RuleKey; buys: string[]; levels: string[]; exits: string[] };

/** Per rule, in order: the stocks it bought, set a dip-buy level on, and sold. Every rule is listed, fired or not. */
export function ruleCounts(signals: DaySignal[]): RuleCount[] {
  return ORDER.map((rule) => {
    const of = (kind: SignalKind) => [...new Set(signals.filter((s) => s.strategy === rule && s.kind === kind).map((s) => s.symbol))].sort();
    return { rule, buys: of("buy"), levels: of("level"), exits: of("exit") };
  });
}

export const SHOW = {
  buys: "Buys and dip levels",
  buy: "Buy signals",
  level: "Dip-buy levels",
  exit: "Exits",
  all: "Everything",
} as const;
export type Show = keyof typeof SHOW;

export const SIZES = {
  top100: "Largest 100",
  top500: "101 to 500",
  top1000: "501 to 1,000",
  rest: "Past 1,000 or unranked",
} as const;
export type Size = keyof typeof SIZES;

export const SORTS = {
  rules: "Most rules first",
  size: "Largest first",
  move: "Biggest move today",
  symbol: "A to Z",
} as const;
export type Sort = keyof typeof SORTS;

export type Filters = {
  rule: RuleKey | "";
  show: Show;
  segment: "" | "equity" | "sme";
  size: Size | "";
  sector: string;
  q: string;
  multi: boolean;
  sort: Sort;
};

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? "") : "");
const pick = <K extends string>(v: string, keys: Record<K, unknown>, fallback: K): K => (Object.hasOwn(keys, v) ? (v as K) : fallback);

/** The tab's filters from the URL; anything unknown falls back to the default. */
export function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const rule = one(sp.rule);
  const segment = one(sp.segment);
  const size = one(sp.size);
  return {
    rule: isRule(rule) ? rule : "",
    show: pick(one(sp.show), SHOW, "buys"),
    segment: segment === "equity" || segment === "sme" ? segment : "",
    size: Object.hasOwn(SIZES, size) ? (size as Size) : "",
    sector: one(sp.sector).slice(0, 80),
    q: one(sp.find).trim().slice(0, 40),
    multi: one(sp.multi) === "1",
    sort: pick(one(sp.sort), SORTS, "rules"),
  };
}

export const sizeOf = (rank: number | null): Size =>
  rank == null ? "rest" : rank <= 100 ? "top100" : rank <= 500 ? "top500" : rank <= 1000 ? "top1000" : "rest";

const shows = (show: Show, kind: SignalKind) => show === "all" || (show === "buys" ? kind !== "exit" : show === kind);

/**
 * The rows the table shows: each stock keeps only the signals the filters let through (a rule filter keeps that rule's
 * signals, the Show filter those kinds), and a stock with none left drops out. "2+ rules" counts every rule the stock
 * has of the kinds shown, so with a rule filter it lists that rule's stocks that another rule also picked.
 */
export function applyFilters(rows: StockRow[], f: Filters): StockRow[] {
  const q = f.q.toLowerCase();
  const out: StockRow[] = [];
  for (const r of rows) {
    if (f.segment && r.segment !== f.segment) continue;
    if (f.size && sizeOf(r.rank) !== f.size) continue;
    if (f.sector && r.sector !== f.sector) continue;
    if (q && !r.symbol.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) continue;
    const signals = r.signals.filter((s) => shows(f.show, s.kind) && (!f.rule || s.strategy === f.rule));
    if (!signals.length) continue;
    if (f.multi && new Set(r.signals.filter((s) => shows(f.show, s.kind)).map((s) => s.strategy)).size < 2) continue;
    out.push({
      ...r,
      signals,
      rules: [...new Set(signals.map((s) => s.strategy))],
      buys: signals.filter((s) => s.kind === "buy").length,
      levels: signals.filter((s) => s.kind === "level").length,
      exits: signals.filter((s) => s.kind === "exit").length,
    });
  }
  const byRank = (a: StockRow, b: StockRow) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.symbol.localeCompare(b.symbol);
  const sorters: Record<Sort, (a: StockRow, b: StockRow) => number> = {
    rules: (a, b) => b.rules.length - a.rules.length || byRank(a, b),
    size: byRank,
    move: (a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0) || byRank(a, b),
    symbol: (a, b) => a.symbol.localeCompare(b.symbol),
  };
  return out.sort(sorters[f.sort]);
}

/** The numbers at the top: stocks with a buy or dip-buy level, signals of each kind, stocks on two or more rules' buys. */
export function headline(rows: StockRow[]) {
  const buying = rows.filter((r) => r.buys + r.levels > 0);
  return {
    stocksBuying: buying.length,
    buys: rows.reduce((a, r) => a + r.buys, 0),
    levels: rows.reduce((a, r) => a + r.levels, 0),
    exits: rows.reduce((a, r) => a + r.exits, 0),
    multi: buying.filter((r) => new Set(r.signals.filter((s) => s.kind !== "exit").map((s) => s.strategy)).size >= 2).length,
  };
}

/** The URL of the tab with some filters changed; empty and default values are left out. */
export function signalsHref(day: string | null, f: Filters, patch: Partial<Filters> = {}): string {
  const g = { ...f, ...patch };
  const p = new URLSearchParams({ tab: "signals" });
  if (day) p.set("day", day);
  if (g.rule) p.set("rule", g.rule);
  if (g.show !== "buys") p.set("show", g.show);
  if (g.segment) p.set("segment", g.segment);
  if (g.size) p.set("size", g.size);
  if (g.sector) p.set("sector", g.sector);
  if (g.q) p.set("find", g.q);
  if (g.multi) p.set("multi", "1");
  if (g.sort !== "rules") p.set("sort", g.sort);
  return `/admin?${p.toString()}`;
}
