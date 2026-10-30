import type { Candle } from "./types";

/**
 * Dry Run (ADR-033): a user's own plan, tried on past prices before any money moves. Pure
 * arithmetic on the stocks and amounts the user chose: how many shares the money buys, what the
 * same money did over the past two years, its worst stretches, and a checklist of general
 * investing guardrails. Nothing here picks stocks or amounts.
 */

export interface PlanStock {
  symbol: string;
  sector: string | null;
  segment?: string | null;
  price: number;
  /** The stop-loss the user keeps (prefilled from the rule's signal). */
  stop: number | null;
  /** Average daily traded value (₹) over the last 20 sessions. */
  tradedValue?: number | null;
}

export interface PlanRow extends PlanStock {
  amount: number;
  shares: number;
  invested: number;
  /** Money lost if the price falls to the stop-loss (null without a valid stop). */
  lossAtStop: number | null;
}

export interface Plan {
  total: number;
  rows: PlanRow[];
  invested: number;
  cash: number;
  /** Sum of every row's loss at its stop, over the rows that have one. */
  lossAtStops: number;
}

/**
 * Split the money the user wants to invest evenly across the picks, after setting `cashPct` aside;
 * each stock buys whole shares, and whatever is left over stays as cash.
 */
export function sizePlan(stocks: PlanStock[], total: number, cashPct: number): Plan {
  const usable = Math.max(0, total * (1 - cashPct / 100));
  const each = stocks.length ? usable / stocks.length : 0;
  const rows = stocks.map((s) => {
    const shares = s.price > 0 ? Math.floor(each / s.price) : 0;
    const invested = shares * s.price;
    const lossAtStop = s.stop != null && s.stop > 0 && s.stop < s.price ? shares * (s.price - s.stop) : null;
    return { ...s, amount: each, shares, invested, lossAtStop };
  });
  const invested = rows.reduce((a, r) => a + r.invested, 0);
  return { total, rows, invested, cash: total - invested, lossAtStops: rows.reduce((a, r) => a + (r.lossAtStop ?? 0), 0) };
}

/** Average close × volume over the last `n` sessions. */
export function tradedValue(candles: Candle[], n = 20): number | null {
  const last = candles.slice(-n).filter((c) => c.close > 0 && c.volume > 0);
  return last.length ? last.reduce((a, c) => a + c.close * c.volume, 0) / last.length : null;
}

export interface ReplayPoint {
  ts: string;
  value: number;
  bench: number | null;
}

export interface Replay {
  start: string;
  end: string;
  points: ReplayPoint[];
  startValue: number;
  endValue: number;
  benchEnd: number | null;
  /** Stocks whose price history starts later than the others' and so sets the start date. */
  limitedBy: string[];
}

const day = (ts: string) => ts.slice(0, 10);

/**
 * What the plan's money would have done: each row's invested amount put into its stock on the
 * first day every stock has a price (within the candles given), held to the last close, plus the
 * cash. `bench` is the same total in the benchmark (NIFTY 50). Missing days carry the last close.
 */
export function replayPlan(plan: Plan, candles: Record<string, Candle[]>, benchmark?: Candle[]): Replay | null {
  const rows = plan.rows.filter((r) => r.invested > 0 && candles[r.symbol]?.length);
  if (!rows.length) return null;
  const firsts = rows.map((r) => ({ symbol: r.symbol, first: day(candles[r.symbol][0].ts) }));
  const start = firsts.map((f) => f.first).sort().at(-1)!;
  const earliest = firsts.map((f) => f.first).sort()[0];
  const dates = [...new Set(rows.flatMap((r) => candles[r.symbol].map((c) => day(c.ts))))].filter((d) => d >= start).sort();
  if (dates.length < 2) return null;

  const series = (cs: Candle[]) => {
    const byDay = new Map(cs.map((c) => [day(c.ts), c.close]));
    let last: number | null = null;
    return dates.map((d) => (last = byDay.get(d) ?? last));
  };
  const holdings = rows.map((r) => {
    const closes = series(candles[r.symbol]);
    const first = closes.find((c) => c != null && c > 0)!;
    return { units: r.invested / first, closes };
  });
  const uninvested = plan.total - rows.reduce((a, r) => a + r.invested, 0);
  const bench = benchmark?.length ? series(benchmark) : null;
  const benchFirst = bench?.find((c) => c != null && c > 0) ?? null;

  const points = dates.map((ts, i) => ({
    ts,
    value: uninvested + holdings.reduce((a, h) => a + h.units * (h.closes[i] ?? 0), 0),
    bench: bench && benchFirst && bench[i] != null ? (plan.total * bench[i]!) / benchFirst : null,
  }));
  return {
    start: dates[0],
    end: dates.at(-1)!,
    points,
    startValue: points[0].value,
    endValue: points.at(-1)!.value,
    benchEnd: points.at(-1)!.bench,
    limitedBy: start > earliest ? firsts.filter((f) => f.first === start).map((f) => f.symbol) : [],
  };
}

export interface Fall {
  /** When the fall ended (for a day or a week) or bottomed (for the biggest fall). */
  ts: string;
  from: string;
  change: number;
  pct: number;
}

export interface BadDays {
  worstDay: Fall | null;
  worstWeek: Fall | null;
  biggestFall: (Fall & { recoveredOn: string | null; sessionsToRecover: number | null }) | null;
}

/** The worst one-day and five-session falls, and the deepest peak-to-bottom fall with its recovery. */
export function badDays(points: ReplayPoint[]): BadDays {
  const worst = (span: number): Fall | null => {
    let out: Fall | null = null;
    for (let i = span; i < points.length; i++) {
      const change = points[i].value - points[i - span].value;
      if (change < 0 && (!out || change < out.change))
        out = { ts: points[i].ts, from: points[i - span].ts, change, pct: (change / points[i - span].value) * 100 };
    }
    return out;
  };

  let peak = 0;
  let best: { peak: number; trough: number } | null = null;
  for (let i = 1; i < points.length; i++) {
    if (points[i].value > points[peak].value) peak = i;
    const drop = points[i].value - points[peak].value;
    if (drop < 0 && (!best || drop < points[best.trough].value - points[best.peak].value)) best = { peak, trough: i };
  }
  let biggestFall: BadDays["biggestFall"] = null;
  if (best) {
    const top = points[best.peak].value;
    const back = points.findIndex((p, i) => i > best!.trough && p.value >= top);
    biggestFall = {
      ts: points[best.trough].ts,
      from: points[best.peak].ts,
      change: points[best.trough].value - top,
      pct: ((points[best.trough].value - top) / top) * 100,
      recoveredOn: back === -1 ? null : points[back].ts,
      sessionsToRecover: back === -1 ? null : back - best.trough,
    };
  }
  return { worstDay: worst(1), worstWeek: worst(5), biggestFall };
}

export interface Guardrail {
  key: string;
  label: string;
  pass: boolean;
  /** One plain line about this plan. */
  detail: string;
  /** Why the guardrail exists, for a beginner. */
  why: string;
}

const MAX_SHARE = 20;
const MIN_SECTORS = 3;
const MAX_LOSS_PCT = 5;
const MIN_TRADED = 5e7; // ₹5 crore a day
const MIN_CASH_PCT = 5;

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** General investing guardrails, checked on the user's own plan. Education, not advice. */
export function guardrails(plan: Plan): Guardrail[] {
  const rows = plan.rows.filter((r) => r.shares > 0);
  const share = (r: PlanRow) => (plan.total > 0 ? (r.invested / plan.total) * 100 : 0);
  const biggest = [...rows].sort((a, b) => b.invested - a.invested)[0];
  const sectors = new Set(rows.map((r) => r.sector ?? "Unknown"));
  const noStop = rows.filter((r) => r.lossAtStop == null);
  const lossPct = plan.total > 0 ? (plan.lossAtStops / plan.total) * 100 : 0;
  const thin = rows.filter((r) => r.tradedValue != null && r.tradedValue < MIN_TRADED);
  const sme = rows.filter((r) => r.segment === "sme");
  const cashPct = plan.total > 0 ? (plan.cash / plan.total) * 100 : 0;
  const names = (rs: PlanRow[]) => rs.map((r) => r.symbol).join(", ");

  return [
    {
      key: "one_stock",
      label: `No stock is more than ${MAX_SHARE}% of the money`,
      pass: rows.length > 0 && share(biggest) <= MAX_SHARE,
      detail: biggest ? `Largest: ${biggest.symbol} at ${share(biggest).toFixed(0)}%.` : "No stocks yet.",
      why: "If one company has a bad year, it can't sink the whole plan.",
    },
    {
      key: "sectors",
      label: `Spread over at least ${MIN_SECTORS} sectors`,
      pass: sectors.size >= MIN_SECTORS,
      detail: `${sectors.size} sector${sectors.size === 1 ? "" : "s"}${sectors.size ? `: ${[...sectors].join(", ")}` : ""}.`,
      why: "Stocks in the same industry often fall together.",
    },
    {
      key: "stops",
      label: "Every stock has a stop-loss below its price",
      pass: rows.length > 0 && noStop.length === 0,
      detail: noStop.length ? `Missing on ${names(noStop)}.` : "All set.",
      why: "A stop-loss is the price where you decide in advance to get out, so one loss stays small.",
    },
    {
      key: "risk",
      label: `If every stop-loss is hit, you lose under ${MAX_LOSS_PCT}% of the money`,
      pass: rows.length > 0 && noStop.length === 0 && lossPct < MAX_LOSS_PCT,
      detail: `All stops hit: −${inr(plan.lossAtStops)} (${lossPct.toFixed(1)}%)${noStop.length ? ", not counting stocks without a stop" : ""}.`,
      why: "Small losses are easy to come back from; a 50% loss needs a 100% gain to recover.",
    },
    {
      key: "liquid",
      label: "Every stock trades at least ₹5 crore a day",
      pass: rows.length > 0 && thin.length === 0,
      detail: thin.length ? `Thinly traded: ${names(thin)}.` : "All trade actively.",
      why: "Busy stocks are easier to sell at a fair price when you want out.",
    },
    {
      key: "main_board",
      label: "No SME stocks",
      pass: sme.length === 0,
      detail: sme.length ? `SME: ${names(sme)}.` : "All main-board stocks.",
      why: "SME stocks are smaller companies with fewer buyers and sellers, and swing harder.",
    },
    {
      key: "cash",
      label: `Keeps at least ${MIN_CASH_PCT}% as cash`,
      pass: cashPct >= MIN_CASH_PCT,
      detail: `${inr(plan.cash)} as cash (${cashPct.toFixed(0)}%).`,
      why: "Cash lets you handle an emergency or a good chance without selling at a bad time.",
    },
  ];
}
