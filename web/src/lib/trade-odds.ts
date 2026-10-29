import type { Candle } from "./types";

/**
 * The odds of a trade before you take it, on daily bars (ADR-032). Adapted from the MIT-licensed
 * Time Machine in day-trader-skill (trader-timemachine), which does the same on 5-minute bars:
 *
 * 1. simulateOdds: replays the next `horizon` sessions many times. Each simulated day is a real
 *    day drawn at random from the stock's own sessions BEFORE the entry (no look-ahead), applied
 *    as moves relative to the previous close. A day whose range touches both the stop and the
 *    target counts as the stop (the conservative call), as the original does.
 * 2. historicalOdds: every past entry of the same rule on this stock, walked forward over the real
 *    bars that followed, with its own stop and a target at the same R.
 * 3. oddsVerdict: one honest line from the numbers.
 *
 * A simulation, not a prediction: the future can do things those sessions never did.
 */

export type Outcome = "target" | "stop" | "neither";

export interface OddsInput {
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  horizon: number;
}

export interface SimOdds {
  paths: number;
  horizon: number;
  /** How many past sessions the days were drawn from. */
  poolDays: number;
  seed: number;
  pTarget: number;
  pStop: number;
  pNeither: number;
  /** Average result in R over all paths (target = its R, stop = −1, neither = where it closed). */
  avgR: number;
  rAtTarget: number;
}

export interface HistoryOdds {
  fired: number;
  target: number;
  stop: number;
  neither: number;
  rAtTarget: number;
  trades: { ts: string; outcome: Outcome; r: number }[];
}

/** Small, fast, seedable PRNG (mulberry32): same seed, same numbers, on any machine. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const riskOf = (t: OddsInput) => (t.direction === "long" ? t.entry - t.stop : t.stop - t.entry);
export const rAt = (t: OddsInput) => (t.direction === "long" ? t.target - t.entry : t.entry - t.target) / riskOf(t);

/** Which side a bar decides, stop first when it touches both. */
function decide(t: OddsInput, high: number, low: number): Outcome | null {
  if (t.direction === "long") {
    if (low <= t.stop) return "stop";
    if (high >= t.target) return "target";
  } else {
    if (high >= t.stop) return "stop";
    if (low <= t.target) return "target";
  }
  return null;
}

/** The index of the last candle at or before a timestamp (the entry bar). */
export function barIndex(candles: Candle[], ts: string): number {
  const t = new Date(ts).getTime();
  let found = -1;
  for (let i = 0; i < candles.length; i++) {
    if (new Date(candles[i].ts).getTime() <= t) found = i;
    else break;
  }
  return found;
}

/**
 * Monte Carlo over the next `horizon` sessions, from the entry at the close of `entryIndex`.
 * Days are drawn from the `lookback` sessions before the entry. Null when there is too little
 * history (fewer than 60 usable days) or the plan is malformed.
 */
export function simulateOdds(
  candles: Candle[],
  entryIndex: number,
  t: OddsInput,
  { paths = 10_000, lookback = 250, seed = 19 }: { paths?: number; lookback?: number; seed?: number } = {},
): SimOdds | null {
  const risk = riskOf(t);
  const rTarget = rAt(t);
  if (!(risk > 0) || !(rTarget > 0) || t.horizon < 1 || entryIndex < 1) return null;

  // Each pool day as moves relative to the close before it.
  const pool: [number, number, number][] = [];
  for (let i = Math.max(1, entryIndex - lookback + 1); i <= entryIndex; i++) {
    const prev = candles[i - 1].close;
    const c = candles[i];
    if (prev > 0 && c.high > 0 && c.low > 0 && c.close > 0) pool.push([c.high / prev, c.low / prev, c.close / prev]);
  }
  if (pool.length < 60) return null;

  const next = rng(seed);
  let target = 0;
  let stop = 0;
  let sumR = 0;
  for (let n = 0; n < paths; n++) {
    let p = t.entry;
    let outcome: Outcome | null = null;
    for (let d = 0; d < t.horizon && !outcome; d++) {
      const [h, l, c] = pool[Math.floor(next() * pool.length)];
      outcome = decide(t, p * h, p * l);
      p *= c;
    }
    if (outcome === "target") {
      target++;
      sumR += rTarget;
    } else if (outcome === "stop") {
      stop++;
      sumR -= 1;
    } else {
      sumR += (t.direction === "long" ? p - t.entry : t.entry - p) / risk;
    }
  }
  return {
    paths,
    horizon: t.horizon,
    poolDays: pool.length,
    seed,
    pTarget: target / paths,
    pStop: stop / paths,
    pNeither: (paths - target - stop) / paths,
    avgR: sumR / paths,
    rAtTarget: rTarget,
  };
}

/**
 * The same rule on this stock's past entries: each walked forward over the real bars after it,
 * stop from the signal, target at `rTarget` R. Entries without a stop on the risk side are skipped,
 * and so are entries too recent to have `horizon` bars after them.
 */
export function historicalOdds(
  candles: Candle[],
  entries: { ts: string; price?: number | null; stop?: number | null }[],
  direction: "long" | "short",
  rTarget: number,
  horizon: number,
): HistoryOdds {
  const out: HistoryOdds = { fired: 0, target: 0, stop: 0, neither: 0, rAtTarget: rTarget, trades: [] };
  for (const e of entries) {
    if (!e.price || !e.stop) continue;
    const risk = direction === "long" ? e.price - e.stop : e.stop - e.price;
    if (!(risk > 0)) continue;
    const i = barIndex(candles, e.ts);
    if (i < 0 || i + horizon >= candles.length) continue;
    const plan: OddsInput = {
      direction,
      entry: e.price,
      stop: e.stop,
      target: direction === "long" ? e.price + rTarget * risk : e.price - rTarget * risk,
      horizon,
    };
    let outcome: Outcome = "neither";
    for (let d = 1; d <= horizon; d++) {
      const hit = decide(plan, candles[i + d].high, candles[i + d].low);
      if (hit) {
        outcome = hit;
        break;
      }
    }
    const last = candles[i + horizon].close;
    const r = outcome === "target" ? rTarget : outcome === "stop" ? -1 : (direction === "long" ? last - e.price : e.price - last) / risk;
    out.fired++;
    out[outcome]++;
    out.trades.push({ ts: e.ts, outcome, r });
  }
  return out;
}

/**
 * One line, on the Time Machine's rule: of the paths that hit a side, the target's share minus
 * the share that breaks even at its R (1 / (1 + R)). Under 5 points is a coin flip / break-even,
 * under 15 leans, beyond that is strong.
 */
export function oddsVerdict(sim: SimOdds): { headline: string; detail: string; notes: string[] } {
  const decided = sim.pTarget + sim.pStop;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const notes: string[] = [];
  if (decided <= 0) {
    return {
      headline: "Undecided",
      detail: `No replay reached the target or the stop within ${sim.horizon} sessions: where the price closes decides every one.`,
      notes,
    };
  }
  const share = sim.pTarget / decided;
  const even = 1 / (1 + sim.rAtTarget);
  const gap = share - even;
  const oneR = Math.abs(sim.rAtTarget - 1) < 0.005;
  const headline =
    Math.abs(gap) < 0.05
      ? oneR
        ? "Close to a coin flip"
        : "Close to break-even"
      : Math.abs(gap) < 0.15
        ? gap > 0
          ? "Leans toward the target"
          : "Leans toward the stop"
        : gap > 0
          ? "Strongly toward the target"
          : "Strongly toward the stop";
  const odds = `target first ${pct(sim.pTarget)} vs stop first ${pct(sim.pStop)}`;
  const detail = oneR
    ? `${odds}.`
    : `At ${+sim.rAtTarget.toFixed(2)}R the target has to come first in ${(even * 100).toFixed(0)}% of the replays that hit a side to break even; it did in ${(share * 100).toFixed(0)}% (${odds}).`;
  if (sim.pNeither > 0.4) notes.push(`${pct(sim.pNeither)} hit neither within ${sim.horizon} sessions; where the price closes decides those.`);
  if (Math.abs(gap) >= 0.05 && sim.avgR !== 0 && sim.avgR > 0 !== gap > 0) {
    notes.push(`Average result is ${sim.avgR >= 0 ? "+" : "−"}${Math.abs(sim.avgR).toFixed(2)}R all the same: the replays that hit neither pull it the other way.`);
  }
  return { headline, detail, notes };
}
