/**
 * The Behaviour mirror: four habits read from your own trades, as past facts. Pure: server/behaviour-mirror.ts loads
 * the rows, this works them out. Never advice, never a forecast (AGENTS rule 13).
 *
 * Every measure was fixed before any real account was looked at:
 *   holding   each closed trade (a purchase, or the part of it, closed by a sale, oldest shares first; after charges):
 *             calendar days from the buy to the sale, median for the winners (gain > 0) and the losers (gain < 0).
 *             Opening balances have no real buy date and are left out.
 *   after     each sale, 60 trading sessions later: the stored close against your sale price, both in today's shares
 *             (splits and bonuses). "Went on to rise" = at least 10 % higher, "fell further" = at least 10 % lower.
 *             Sales with fewer than 60 stored sessions after them are not counted.
 *   run-up    each purchase (not an opening balance): the rise over the 20 sessions before it, your price against the
 *             stored close 20 sessions earlier. "After a run-up" = up at least 10 %. Its result: what that purchase made
 *             so far (sold parts after charges, the rest at the last close) over what it cost.
 *   size      each closed trade's gain over its cost: the average win, the average loss, and the share of all your
 *             winning rupees that your three largest losses took back.
 * A measure needs at least 5 trades in all (and 3 on each side it compares) or it says there are too few.
 */
import { splitFactor, type BuyLot, type Last, type LotSale, type Split } from "./rule-compare";

export const AFTER_SESSIONS = 60;
export const RUNUP_SESSIONS = 20;
export const BIG_MOVE = 0.1;
export const MIN_TRADES = 5;
export const MIN_SIDE = 3;

export interface Close {
  day: string;
  close: number;
}

export interface MirrorInput {
  lots: BuyLot[];
  sales: LotSale[];
  splits: Split[];
  /** Stored daily closes per symbol, oldest first, in today's shares. */
  closes: Map<string, Close[]>;
  last: Map<string, Last>;
  today: string;
}

export interface Example {
  symbol: string;
  day: string;
  /** % (holding: days) */
  value: number;
  rupees?: number;
}

export interface Holding {
  trades: number;
  winners: number;
  losers: number;
  winDays: number | null;
  lossDays: number | null;
  ratio: number | null;
}

export interface AfterSale {
  sales: number;
  counted: number;
  rose: number;
  fell: number;
  medianPct: number | null;
  /** (close 60 sessions later − your sale price) × the shares you sold, summed. */
  rupees: number;
  examples: Example[];
}

export interface RunUp {
  buys: number;
  counted: number;
  after: number;
  afterMedian: number | null;
  otherMedian: number | null;
  examples: Example[];
}

export interface Size {
  trades: number;
  avgWin: number | null;
  avgLoss: number | null;
  /** The three largest losses in rupees over all winning rupees (0..). null when there are no wins. */
  bigLossShare: number | null;
  bigLosses: Example[];
}

export interface Mirror {
  holding: Holding;
  after: AfterSale;
  runUp: RunUp;
  size: Size;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Index of the first stored session on or after `day`. */
export function at(closes: Close[], day: string): number {
  let lo = 0;
  let hi = closes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (closes[mid].day < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function mirror(input: MirrorInput): Mirror {
  const { lots, sales, splits, closes, last, today } = input;
  const lotOf = new Map(lots.map((l) => [l.buy_txn_id, l]));
  const closed = sales.filter((s) => lotOf.get(s.buy_txn_id)?.kind === "buy" && s.cost > 0);

  // ---- holding: winners against losers
  const winDays = closed.filter((s) => s.gain > 0).map((s) => days(lotOf.get(s.buy_txn_id)!.buy_date, s.sell_date));
  const lossDays = closed.filter((s) => s.gain < 0).map((s) => days(lotOf.get(s.buy_txn_id)!.buy_date, s.sell_date));
  const enough = closed.length >= MIN_TRADES && winDays.length >= MIN_SIDE && lossDays.length >= MIN_SIDE;
  const wd = enough ? median(winDays) : null;
  const ld = enough ? median(lossDays) : null;
  const holding: Holding = {
    trades: closed.length,
    winners: winDays.length,
    losers: lossDays.length,
    winDays: wd,
    lossDays: ld,
    ratio: wd != null && ld != null && wd > 0 ? ld / wd : null,
  };

  // ---- after each sale (one sale may close several purchases: grouped by the sale)
  const bySale = new Map<string, { symbol: string; day: string; qty: number; price: number }>();
  for (const s of sales) {
    const g = bySale.get(s.sell_txn_id);
    if (g) g.qty += s.quantity;
    else bySale.set(s.sell_txn_id, { symbol: s.symbol, day: s.sell_date, qty: s.quantity, price: s.sell_price });
  }
  const moves: Example[] = [];
  for (const g of bySale.values()) {
    const cs = closes.get(g.symbol);
    if (!cs?.length || !(g.price > 0)) continue;
    const i = at(cs, g.day);
    const later = cs[i + AFTER_SESSIONS];
    if (!later) continue;
    const f = splitFactor(splits, g.symbol, g.day, today);
    const price = g.price / f;
    moves.push({ symbol: g.symbol, day: g.day, value: later.close / price - 1, rupees: (later.close - price) * g.qty * f });
  }
  const afterEnough = moves.length >= MIN_TRADES;
  const after: AfterSale = {
    sales: bySale.size,
    counted: moves.length,
    rose: moves.filter((m) => m.value >= BIG_MOVE).length,
    fell: moves.filter((m) => m.value <= -BIG_MOVE).length,
    medianPct: afterEnough ? median(moves.map((m) => m.value)) : null,
    rupees: moves.reduce((a, m) => a + (m.rupees ?? 0), 0),
    examples: [...moves].sort((a, b) => (b.rupees ?? 0) - (a.rupees ?? 0)).slice(0, 3),
  };

  // ---- buying after a run-up
  const realizedOf = new Map<string, { gain: number }>();
  for (const s of sales) {
    const r = realizedOf.get(s.buy_txn_id) ?? { gain: 0 };
    r.gain += s.gain;
    realizedOf.set(s.buy_txn_id, r);
  }
  const buys = lots.filter((l) => l.kind === "buy" && l.buy_price > 0 && l.buy_quantity > 0);
  const tagged: { run: number; result: number; ex: Example }[] = [];
  for (const l of buys) {
    const cs = closes.get(l.symbol);
    const lp = last.get(l.symbol)?.price;
    if (!cs?.length || (l.open_quantity > 0 && lp == null)) continue;
    const i = at(cs, l.buy_date);
    if (i - RUNUP_SESSIONS < 0 || i >= cs.length) continue;
    const before = cs[i - RUNUP_SESSIONS].close;
    const f = splitFactor(splits, l.symbol, l.buy_date, today);
    const run = l.buy_price / f / before - 1;
    const cost = l.buy_price * l.buy_quantity + l.charges;
    const gain = (realizedOf.get(l.buy_txn_id)?.gain ?? 0) + (l.open_quantity > 0 ? (lp! - l.open_price) * l.open_quantity : 0);
    tagged.push({ run, result: gain / cost, ex: { symbol: l.symbol, day: l.buy_date, value: run } });
  }
  const afterRun = tagged.filter((t) => t.run >= BIG_MOVE);
  const others = tagged.filter((t) => t.run < BIG_MOVE);
  const runEnough = tagged.length >= MIN_TRADES && afterRun.length >= MIN_SIDE && others.length >= MIN_SIDE;
  const runUp: RunUp = {
    buys: buys.length,
    counted: tagged.length,
    after: afterRun.length,
    afterMedian: runEnough ? median(afterRun.map((t) => t.result)) : null,
    otherMedian: runEnough ? median(others.map((t) => t.result)) : null,
    examples: [...afterRun].sort((a, b) => b.run - a.run).slice(0, 3).map((t) => t.ex),
  };

  // ---- size of wins and losses
  const pct = closed.map((s) => ({ s, p: s.gain / s.cost }));
  const wins = pct.filter((x) => x.s.gain > 0);
  const losses = pct.filter((x) => x.s.gain < 0);
  const sizeEnough = closed.length >= MIN_TRADES && wins.length >= MIN_SIDE && losses.length >= MIN_SIDE;
  const winRupees = wins.reduce((a, x) => a + x.s.gain, 0);
  const big = [...losses].sort((a, b) => a.s.gain - b.s.gain).slice(0, 3);
  const size: Size = {
    trades: closed.length,
    avgWin: sizeEnough ? wins.reduce((a, x) => a + x.p, 0) / wins.length : null,
    avgLoss: sizeEnough ? losses.reduce((a, x) => a + x.p, 0) / losses.length : null,
    bigLossShare: sizeEnough && winRupees > 0 ? -big.reduce((a, x) => a + x.s.gain, 0) / winRupees : null,
    bigLosses: sizeEnough ? big.map((x) => ({ symbol: x.s.symbol, day: x.s.sell_date, value: x.p, rupees: x.s.gain })) : [],
  };

  return { holding, after, runUp, size };
}

const pctText = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;

/** One plain sentence per habit (or null when there are too few trades). Descriptions of the past only. */
export function sentences(m: Mirror): { holding: string | null; after: string | null; runUp: string | null; size: string | null } {
  const h = m.holding;
  const holding =
    h.ratio == null
      ? null
      : h.ratio >= 1.5
        ? `You kept losing trades about ${h.ratio.toFixed(1)} times as long as winning ones (${h.lossDays} days against ${h.winDays}, the middle trade of each).`
        : h.ratio <= 1 / 1.5
          ? `You kept winning trades longer than losing ones (${h.winDays} days against ${h.lossDays}, the middle trade of each).`
          : `You kept winning and losing trades for about as long (${h.winDays} and ${h.lossDays} days, the middle trade of each).`;

  const a = m.after;
  const after =
    a.medianPct == null
      ? null
      : `${a.counted} of your sales have 60 trading days of prices after them. In ${a.rose} the stock went on to rise 10% or more, in ${a.fell} it fell 10% or more; the middle sale saw the stock ${a.medianPct >= 0 ? "rise" : "fall"} ${pctText(a.medianPct)}.`;

  const r = m.runUp;
  const runUp =
    r.afterMedian == null || r.otherMedian == null
      ? null
      : `${r.after} of your ${r.counted} purchases came after the stock had risen 10% or more in the 20 trading days before. Those made ${r.afterMedian >= 0 ? "+" : "−"}${pctText(r.afterMedian)} (the middle one), against ${r.otherMedian >= 0 ? "+" : "−"}${pctText(r.otherMedian)} for your other purchases.`;

  const s = m.size;
  const size =
    s.avgWin == null || s.avgLoss == null
      ? null
      : `Your average win was +${pctText(s.avgWin)} and your average loss −${pctText(s.avgLoss)}.${
          s.bigLossShare != null ? ` Your three largest losses took back ${pctText(s.bigLossShare)} of everything your winning trades made.` : ""
        }`;
  return { holding, after, runUp, size };
}
