/**
 * Chart replay (ADR-048): play a stock's past one trading day at a time, see the rules' signals appear when they
 * happened, and practise buying and selling. Pure, so the chart and the tests share it. Nothing after the replay's day
 * is ever shown: moving averages and volume only use bars up to it, and a practice trade fills at that day's close.
 * (Not the Dry Run's money replay, components/dry-run/replay-chart.tsx, nor the trade odds' simulated paths.)
 */

export interface ReplayBar {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Trading days a second. 2 is a comfortable reading pace; 20 runs a year in about 12 seconds. */
export const SPEEDS = [
  { key: "1x", label: "1×", perSecond: 1 },
  { key: "2x", label: "2×", perSecond: 2 },
  { key: "5x", label: "5×", perSecond: 5 },
  { key: "10x", label: "10×", perSecond: 10 },
  { key: "20x", label: "20×", perSecond: 20 },
] as const;
export type SpeedKey = (typeof SPEEDS)[number]["key"];

export const STARTS = [
  { key: "3M", label: "3 months ago", days: 92 },
  { key: "6M", label: "6 months ago", days: 183 },
  { key: "1Y", label: "1 year ago", days: 365 },
  { key: "2Y", label: "2 years ago", days: 731 },
] as const;
export type StartKey = (typeof STARTS)[number]["key"];

/** Bars shown before the replay starts, so there is something to read; the first bar can't be the end. */
export const MIN_BARS = 20;

const dayOf = (ts: string) => ts.slice(0, 10);

/**
 * The bar the replay opens on (the last one shown): the last session on or before `date`, kept between MIN_BARS and
 * one bar before the end (there must be something left to play).
 */
export function startIndex(bars: ReplayBar[], date: string): number {
  if (bars.length <= MIN_BARS) return Math.max(0, bars.length - 2);
  let i = bars.length - 1;
  while (i > 0 && dayOf(bars[i].ts) > date) i--;
  return Math.min(bars.length - 2, Math.max(MIN_BARS - 1, i));
}

/** The date `days` calendar days before the last bar (YYYY-MM-DD). */
export function daysBeforeEnd(bars: ReplayBar[], days: number): string {
  const last = bars.length ? new Date(bars[bars.length - 1].ts).getTime() : Date.now();
  return new Date(last - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Whole bars due after `elapsedMs` of playing at `perSecond`, with the leftover time carried to the next frame, so
 * playback keeps an even pace whatever the screen's frame rate (60 or 120 Hz, or a slow frame).
 */
export function barsDue(elapsedMs: number, perSecond: number, carryMs: number): { bars: number; carryMs: number } {
  const total = Math.max(0, elapsedMs) + carryMs;
  const per = 1000 / perSecond;
  // A whisker of tolerance: sixty frames of 1000/60 ms add up to 999.99… in floating point, not 1000.
  const bars = Math.floor((total + 1e-6) / per);
  // A long pause (a hidden tab) must not dump a burst of bars: at most one second's worth at once.
  const cap = Math.ceil(perSecond);
  return bars > cap ? { bars: cap, carryMs: 0 } : { bars, carryMs: total - bars * per };
}

/** Markers that happened up to and including bar `index`. */
export function revealedUpTo<T extends { ts: string }>(markers: T[], bars: ReplayBar[], index: number): T[] {
  const end = bars[index] ? dayOf(bars[index].ts) : "";
  return markers.filter((m) => dayOf(m.ts) <= end);
}

/** Markers that fall on bars after `from` and up to `to` (the ones a step or a play frame just revealed). */
export function revealedBetween<T extends { ts: string }>(markers: T[], bars: ReplayBar[], from: number, to: number): T[] {
  if (to <= from) return [];
  const a = bars[from] ? dayOf(bars[from].ts) : "";
  const b = bars[to] ? dayOf(bars[to].ts) : "";
  return markers.filter((m) => dayOf(m.ts) > a && dayOf(m.ts) <= b);
}

// ------------------------------------------------------------------ practice trades

/** A practice account: whole shares bought with this much at the day's close. */
export const PRACTICE_BUDGET = 100_000;

export interface Position {
  entryIndex: number;
  entryPrice: number;
  shares: number;
}

export interface PracticeTrade extends Position {
  exitIndex: number;
  exitPrice: number;
  /** ₹ made (or lost) on the shares bought, before charges. */
  gain: number;
  /** % on what the shares cost. */
  pct: number;
}

export interface Practice {
  position: Position | null;
  trades: PracticeTrade[];
}

export const NO_PRACTICE: Practice = { position: null, trades: [] };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Buy as many whole shares as the budget allows at bar `index`'s close. No-op with a position open. */
export function buy(p: Practice, bars: ReplayBar[], index: number, budget = PRACTICE_BUDGET): Practice {
  const bar = bars[index];
  if (p.position || !bar || !(bar.close > 0)) return p;
  const shares = Math.floor(budget / bar.close);
  if (shares < 1) return p;
  return { ...p, position: { entryIndex: index, entryPrice: bar.close, shares } };
}

/** Sell the open position at bar `index`'s close. No-op without one, or on the day it was bought. */
export function sell(p: Practice, bars: ReplayBar[], index: number): Practice {
  const bar = bars[index];
  if (!p.position || !bar || index <= p.position.entryIndex) return p;
  const { entryPrice, shares } = p.position;
  const trade: PracticeTrade = {
    ...p.position,
    exitIndex: index,
    exitPrice: bar.close,
    gain: round2((bar.close - entryPrice) * shares),
    pct: round2(((bar.close - entryPrice) / entryPrice) * 100),
  };
  return { position: null, trades: [...p.trades, trade] };
}

/** The open position against bar `index`'s close. */
export function openResult(p: Practice, bars: ReplayBar[], index: number): { gain: number; pct: number; days: number } | null {
  const bar = bars[index];
  if (!p.position || !bar) return null;
  const { entryPrice, shares, entryIndex } = p.position;
  return { gain: round2((bar.close - entryPrice) * shares), pct: round2(((bar.close - entryPrice) / entryPrice) * 100), days: index - entryIndex };
}

/** Totals of the closed practice trades. */
export function practiceSummary(trades: PracticeTrade[]): { count: number; won: number; gain: number } {
  return { count: trades.length, won: trades.filter((t) => t.gain > 0).length, gain: round2(trades.reduce((a, t) => a + t.gain, 0)) };
}

/** Stepping back past a practice trade undoes it (the replay can't show a trade made "later" than the day on screen). */
export function rewindPractice(p: Practice, index: number): Practice {
  const trades = p.trades.filter((t) => t.exitIndex <= index);
  const reopened = p.trades.find((t) => t.exitIndex > index && t.entryIndex <= index);
  const position = reopened
    ? { entryIndex: reopened.entryIndex, entryPrice: reopened.entryPrice, shares: reopened.shares }
    : p.position && p.position.entryIndex <= index
      ? p.position
      : null;
  return { position, trades };
}
