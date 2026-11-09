/**
 * Your trades next to the rules' trades (Step D, ADR-050). Pure: the page loads the rows, this works out the matches.
 *
 * Matching, fixed before any result is seen:
 *   a buy   a rule counts when its trade was open on your buy date (bought on or before it, not sold before or on it),
 *           or when it bought within the next 10 trading sessions. Every rule that matches is shown, never only the best.
 *   a sale  a rule counts when its trade was open on the day you sold.
 * Money, always about the past:
 *   paid less   (your price − the rule's price, in the shares of your buy day) × your shares
 *   made        your same money put through the rule's whole trade (to its sale, or the last close while it is open),
 *               less the same charges as your purchase; against what that purchase of yours made (oldest shares sold
 *               first, after charges; the part still held at the last close)
 *   sale        (the rule's sale price, in the shares of your sale day − your sale price) × the shares you sold
 * Opening balances are not compared (no real buy date or price).
 */
import { ruleOf, type RuleKey } from "./rules";

export const MATCH_SESSIONS = 10;

export interface RuleTrade {
  strategy: RuleKey;
  symbol: string;
  entry_day: string;
  entry_price: number;
  exit_day: string | null;
  exit_price: number | null;
  /** The entry as the exit row recorded it (the exit day's share basis). */
  exit_entry_fill: number | null;
  result: string | null;
  exit_label: string | null;
}

export interface BuyLot {
  buy_txn_id: string;
  portfolio_id: string;
  symbol: string;
  buy_date: string;
  kind: "opening" | "buy";
  buy_quantity: number;
  buy_price: number;
  open_quantity: number;
  open_price: number;
  charges: number;
}

/** A row of portfolio_realized with the purchase it came from. */
export interface LotSale {
  buy_txn_id: string;
  sell_txn_id: string;
  symbol: string;
  sell_date: string;
  quantity: number;
  sell_price: number;
  cost: number;
  proceeds: number;
  gain: number;
}

export interface Split {
  symbol: string;
  ex_date: string;
  factor: number;
}

export interface Last {
  price: number;
  day: string;
}

export interface BuyMatch {
  kind: "buy";
  id: string;
  symbol: string;
  strategy: RuleKey;
  ruleName: string;
  // you
  buyDate: string;
  quantity: number;
  price: number;
  money: number;
  yourGain: number | null;
  yourStatus: "held" | "partly sold" | "sold";
  yourLastSale: string | null;
  // the rule
  when: "same day" | "earlier" | "later";
  sessionsApart: number;
  ruleBuyDate: string;
  /** The rule's entry in the shares of your buy day. */
  rulePrice: number;
  ruleOpen: boolean;
  ruleSellDate: string | null;
  ruleSellPrice: number | null;
  ruleReason: string | null;
  ruleReturnPct: number | null;
  ruleGain: number | null;
  // the two "would have" lines
  paidLessTotal: number;
  paidLessPerShare: number;
  madeMore: number | null;
}

export interface SaleMatch {
  kind: "sale";
  id: string;
  symbol: string;
  strategy: RuleKey;
  ruleName: string;
  sellDate: string;
  quantity: number;
  price: number;
  ruleBuyDate: string;
  ruleOpen: boolean;
  ruleSellDate: string | null;
  /** The rule's sale (or the last close while it is open), in the shares of your sale day. */
  ruleSellPrice: number | null;
  ruleReason: string | null;
  madeMore: number | null;
}

export interface RuleSummary {
  strategy: RuleKey;
  ruleName: string;
  buys: number;
  paidLess: number;
  paidMore: number;
  ruleGain: number;
  yourGain: number;
  /** Buys where both sides are known (the price of a stock still held is needed). */
  priced: number;
  ruleBetter: number;
  ruleWorse: number;
}

export interface Comparison {
  buys: BuyMatch[];
  sales: SaleMatch[];
  summary: {
    yourBuys: number;
    matchedBuys: number;
    beforeRecords: number;
    noRule: number;
    openings: number;
    recordsFrom: string | null;
    perRule: RuleSummary[];
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** How many shares one share of `from` became by `to` (splits and bonuses with ex_date in (from, to]). */
export function splitFactor(splits: Split[], symbol: string, from: string, to: string): number {
  let f = 1;
  for (const s of splits) if (s.symbol === symbol && s.ex_date > from && s.ex_date <= to) f *= Number(s.factor);
  return f;
}

/** Index of the first trading session on or after `day` (sessions sorted ascending). */
function sessionIndex(sessions: string[], day: string): number {
  let lo = 0;
  let hi = sessions.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sessions[mid] < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Trading sessions from a to b (b after a gives a positive count). */
export function sessionsBetween(sessions: string[], a: string, b: string): number {
  return sessionIndex(sessions, b) - sessionIndex(sessions, a);
}

/** The last day a rule may have bought for a buy on `day` to count (10 sessions later). */
export function windowEnd(sessions: string[], day: string, n = MATCH_SESSIONS): string | null {
  const i = sessionIndex(sessions, day) + n;
  return i < sessions.length ? sessions[i] : null;
}

/** "safety stop", "60-session review", "sold on the bounce": the part after the rule's name. */
export function reasonOf(t: Pick<RuleTrade, "exit_label" | "result">): string | null {
  const label = t.exit_label?.split(": ").slice(1).join(": ");
  if (label) return label;
  return t.result ? ({ STOP_HIT: "safety stop", REVIEW_60: "60-session review", BOUNCE: "sold on the bounce" } as Record<string, string>)[t.result] ?? null : null;
}

export function ruleMatchesBuy(t: RuleTrade, day: string, end: string | null): "same day" | "earlier" | "later" | null {
  if (t.entry_day <= day && (t.exit_day == null || t.exit_day > day)) return t.entry_day === day ? "same day" : "earlier";
  if (t.entry_day > day && end != null && t.entry_day <= end) return "later";
  if (t.entry_day > day && end == null) return "later"; // the window runs past the last session we have
  return null;
}

export function compareTrades(input: {
  lots: BuyLot[];
  sales: LotSale[];
  ruleTrades: RuleTrade[];
  splits: Split[];
  sessions: string[];
  last: Map<string, Last>;
  recordsFrom: string | null;
}): Comparison {
  const { lots, sales, ruleTrades, splits, sessions, last, recordsFrom } = input;
  const bySymbol = new Map<string, RuleTrade[]>();
  for (const t of ruleTrades) {
    const list = bySymbol.get(t.symbol);
    if (list) list.push(t);
    else bySymbol.set(t.symbol, [t]);
  }
  const partsOf = new Map<string, LotSale[]>();
  for (const p of sales) {
    const list = partsOf.get(p.buy_txn_id);
    if (list) list.push(p);
    else partsOf.set(p.buy_txn_id, [p]);
  }

  const buys: BuyMatch[] = [];
  let yourBuys = 0;
  let matchedBuys = 0;
  let beforeRecords = 0;
  let noRule = 0;
  let openings = 0;

  for (const lot of lots) {
    if (lot.kind === "opening") {
      openings++;
      continue;
    }
    yourBuys++;
    const day = lot.buy_date;
    if (recordsFrom && day < recordsFrom) {
      beforeRecords++;
      continue;
    }
    const end = windowEnd(sessions, day);
    const q = Number(lot.buy_quantity);
    const p = Number(lot.buy_price);
    const money = q * p;
    const charges = Number(lot.charges);
    const parts = partsOf.get(lot.buy_txn_id) ?? [];
    const realized = parts.reduce((a, x) => a + Number(x.gain), 0);
    const sellCharges = parts.reduce((a, x) => a + Number(x.quantity) * Number(x.sell_price) - Number(x.proceeds), 0);
    const openFraction = money > 0 ? (Number(lot.open_quantity) * Number(lot.open_price)) / money : 0;
    const lastPx = last.get(lot.symbol)?.price ?? null;
    const today = last.get(lot.symbol)?.day ?? null;
    const openValue = Number(lot.open_quantity) > 0 ? (lastPx != null ? Number(lot.open_quantity) * lastPx : null) : 0;
    const yourGain =
      openValue == null ? null : r2(realized + openValue - Number(lot.open_quantity) * Number(lot.open_price) - charges * openFraction);
    const yourStatus: BuyMatch["yourStatus"] = Number(lot.open_quantity) <= 0 ? "sold" : parts.length ? "partly sold" : "held";
    const yourLastSale = parts.length ? parts.map((x) => x.sell_date).sort().at(-1)! : null;

    let any = false;
    for (const t of bySymbol.get(lot.symbol) ?? []) {
      const when = ruleMatchesBuy(t, day, end);
      if (!when) continue;
      any = true;
      const entry = Number(t.entry_price);
      const rulePrice = when === "later" ? entry * splitFactor(splits, lot.symbol, day, t.entry_day) : entry / splitFactor(splits, lot.symbol, t.entry_day, day);
      const ruleOpen = t.exit_day == null;
      let ret: number | null = null;
      if (!ruleOpen && t.exit_price != null) ret = Number(t.exit_price) / Number(t.exit_entry_fill ?? entry) - 1;
      else if (ruleOpen && lastPx != null && today) ret = (lastPx * splitFactor(splits, lot.symbol, t.entry_day, today)) / entry - 1;
      // the same charges as your purchase: its buy charges, its actual sale charges, and for shares you still hold when
      // the rule has sold, a sale charge equal to their buy charges
      const ruleCharges = charges + sellCharges + (!ruleOpen ? charges * openFraction : 0);
      const ruleGain = ret == null ? null : r2(money * ret - ruleCharges);
      const perShare = r2(p - rulePrice);
      buys.push({
        kind: "buy",
        id: `${lot.buy_txn_id}:${t.strategy}:${t.entry_day}`,
        symbol: lot.symbol,
        strategy: t.strategy,
        ruleName: ruleOf(t.strategy)?.name ?? t.strategy,
        buyDate: day,
        quantity: q,
        price: p,
        money: r2(money),
        yourGain,
        yourStatus,
        yourLastSale,
        when,
        sessionsApart: Math.abs(sessionsBetween(sessions, t.entry_day, day)),
        ruleBuyDate: t.entry_day,
        rulePrice: r2(rulePrice),
        ruleOpen,
        ruleSellDate: t.exit_day,
        ruleSellPrice: t.exit_price != null ? Number(t.exit_price) : null,
        ruleReason: ruleOpen ? null : reasonOf(t),
        ruleReturnPct: ret == null ? null : r2(ret * 100),
        ruleGain,
        paidLessPerShare: perShare,
        paidLessTotal: r2(perShare * q),
        madeMore: ruleGain != null && yourGain != null ? r2(ruleGain - yourGain) : null,
      });
    }
    if (any) matchedBuys++;
    else noRule++;
  }

  // sales: group the parts of each sell
  const bySell = new Map<string, LotSale[]>();
  for (const p of sales) {
    const list = bySell.get(p.sell_txn_id);
    if (list) list.push(p);
    else bySell.set(p.sell_txn_id, [p]);
  }
  const saleMatches: SaleMatch[] = [];
  for (const [sellId, parts] of bySell) {
    const { symbol, sell_date: day } = parts[0];
    if (recordsFrom && day < recordsFrom) continue;
    const q = parts.reduce((a, x) => a + Number(x.quantity), 0);
    const px = Number(parts[0].sell_price);
    const l = last.get(symbol);
    for (const t of bySymbol.get(symbol) ?? []) {
      if (!(t.entry_day <= day && (t.exit_day == null || t.exit_day > day))) continue;
      const ruleOpen = t.exit_day == null;
      const rulePx = ruleOpen
        ? l
          ? l.price * splitFactor(splits, symbol, day, l.day)
          : null
        : t.exit_price != null
          ? Number(t.exit_price) * splitFactor(splits, symbol, day, t.exit_day!)
          : null;
      saleMatches.push({
        kind: "sale",
        id: `${sellId}:${t.strategy}:${t.entry_day}`,
        symbol,
        strategy: t.strategy,
        ruleName: ruleOf(t.strategy)?.name ?? t.strategy,
        sellDate: day,
        quantity: q,
        price: px,
        ruleBuyDate: t.entry_day,
        ruleOpen,
        ruleSellDate: t.exit_day,
        ruleSellPrice: rulePx == null ? null : r2(rulePx),
        ruleReason: ruleOpen ? null : reasonOf(t),
        madeMore: rulePx == null ? null : r2((rulePx - px) * q),
      });
    }
  }

  const perRule = new Map<RuleKey, RuleSummary>();
  for (const m of buys) {
    let s = perRule.get(m.strategy);
    if (!s) {
      s = { strategy: m.strategy, ruleName: m.ruleName, buys: 0, paidLess: 0, paidMore: 0, ruleGain: 0, yourGain: 0, priced: 0, ruleBetter: 0, ruleWorse: 0 };
      perRule.set(m.strategy, s);
    }
    s.buys++;
    if (m.paidLessPerShare > 0) s.paidLess++;
    else if (m.paidLessPerShare < 0) s.paidMore++;
    if (m.madeMore != null && m.ruleGain != null && m.yourGain != null) {
      s.priced++;
      s.ruleGain = r2(s.ruleGain + m.ruleGain);
      s.yourGain = r2(s.yourGain + m.yourGain);
      if (m.madeMore > 0) s.ruleBetter++;
      else if (m.madeMore < 0) s.ruleWorse++;
    }
  }

  const byDateDesc = <T extends { id: string }>(d: (x: T) => string) => (a: T, b: T) => (d(a) < d(b) ? 1 : d(a) > d(b) ? -1 : a.id < b.id ? -1 : 1);
  return {
    buys: buys.sort(byDateDesc((x) => x.buyDate)),
    sales: saleMatches.sort(byDateDesc((x) => x.sellDate)),
    summary: {
      yourBuys,
      matchedBuys,
      beforeRecords,
      noRule,
      openings,
      recordsFrom,
      perRule: [...perRule.values()].sort((a, b) => b.buys - a.buys),
    },
  };
}

/** The comparison as CSV (one row per match), for the Export button. */
export function comparisonCsv(c: Comparison): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [
    "type", "symbol", "rule", "your_date", "your_quantity", "your_price", "rule_buy_date", "rule_buy_price", "rule_sell_date",
    "rule_sell_price", "rule_reason", "rule_open", "paid_less_total", "rule_gain", "your_gain", "would_have_made_more",
  ];
  const rows = [
    ...c.buys.map((m) => [
      "buy", m.symbol, m.ruleName, m.buyDate, m.quantity, m.price, m.ruleBuyDate, m.rulePrice, m.ruleSellDate, m.ruleSellPrice,
      m.ruleReason, m.ruleOpen, m.paidLessTotal, m.ruleGain, m.yourGain, m.madeMore,
    ]),
    ...c.sales.map((m) => [
      "sale", m.symbol, m.ruleName, m.sellDate, m.quantity, m.price, m.ruleBuyDate, "", m.ruleSellDate, m.ruleSellPrice,
      m.ruleReason, m.ruleOpen, "", "", "", m.madeMore,
    ]),
  ];
  return [head, ...rows].map((r) => r.map(esc).join(",")).join("\n") + "\n";
}
