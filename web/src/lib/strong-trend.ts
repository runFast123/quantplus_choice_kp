/**
 * Strong trend (migration 33, ADR-035): the plan, the market weather and the tested record, in plain words.
 * The rule itself runs in SQL (private.refresh_strong_trend); this file only explains it.
 */

export type Weather = "sunny" | "mixed" | "stormy";

export interface WeatherView {
  state: Weather | null;
  label: string;
  sentence: string;
}

/** Today's market weather (public.market_weather) as a label and one sentence. */
export function weatherView(state: string | null | undefined, vix: number | null | undefined): WeatherView {
  const v = vix != null ? ` India VIX ${vix.toFixed(1)}.` : "";
  switch (state) {
    case "sunny":
      return {
        state,
        label: "Sunny",
        sentence: `The Nifty 50 is above its 200-day average and the market is calm.${v} Strong trend signals are on.`,
      };
    case "mixed":
      return {
        state,
        label: "Mixed",
        sentence: `The Nifty 50's trend is unclear.${v} Strong trend signals wait for a sunny market.`,
      };
    case "stormy":
      return {
        state,
        label: "Stormy",
        sentence: `The Nifty 50 is below its 200-day average or the market is nervous (VIX above 22).${v} Strong trend signals pause until it clears.`,
      };
    default:
      return { state: null, label: "Unknown", sentence: "Not enough Nifty 50 history yet to read the market." };
  }
}

/** 60 trading sessions is about 87 calendar days (weekends and a few holidays). */
export const REVIEW_SESSIONS = 60;
const REVIEW_CALENDAR_DAYS = 87;

/** Rough review day for an open Strong trend buy; the exact day depends on holidays. */
export function reviewDate(signalAt: string): Date {
  const d = new Date(signalAt);
  d.setUTCDate(d.getUTCDate() + REVIEW_CALENDAR_DAYS);
  return d;
}

/** Status of an open Strong trend buy against its safety stop. */
export function strongTrendStatus(stop: number | null, last: number | null): { label: string; tone: "neutral" | "loss" } {
  if (stop != null && last != null && last <= stop) return { label: "Below safety stop", tone: "loss" };
  return { label: "Open", tone: "neutral" };
}

/**
 * The record of the exact rule on past prices: research/strategies/record.py, Jul 2019 – Oct 2026,
 * each year's 300 most traded NSE stocks, entry at the next open, 0.5 % round-trip cost on the plan.
 * Update these numbers only by re-running that script.
 */
export const STRONG_TREND_TESTED = {
  period: "Jul 2019 – Oct 2026",
  trades: 2008,
  madeMoneyPct: 52,
  avgTradePct: 5.7,
  avgWinPct: 21,
  avgLossPct: -11,
  stoppedPct: 34,
  higher20Pct: 56,
  randomHigher20Pct: 51,
  recent: { period: "2024 – Oct 2026", madeMoneyPct: 48, avgTradePct: 3.3 },
} as const;
