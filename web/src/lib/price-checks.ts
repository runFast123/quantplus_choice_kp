import { date, rupees } from "./format";

/** A stored day whose open, low or high looked wrong (public.candle_checks, migration 57, ADR-053). */
export type CandleCheck = {
  symbol: string;
  exchange: string;
  day: string;
  prev_close: number;
  open: number;
  high: number;
  low: number;
  close: number;
  bad_open: boolean;
  bad_high: boolean;
  bad_low: boolean;
  /** 'market': 3+ of the 500 largest were flagged that day, a market-wide move (migration 58); read like 'real'. */
  status: "suspect" | "real" | "bad" | "market";
  found_at?: string;
  reviewed_at?: string | null;
};

/** The guard's rule, written down before any rule's result was looked at: more than 12 % away from both the close
 *  before and the day's own close. Mirrors private.check_candle_days. */
export const SPIKE = 0.12;

export function lookedWrong(
  prevClose: number,
  c: { open: number; high: number; low: number; close: number },
): { open: boolean; high: boolean; low: boolean } {
  const lo = Math.min(prevClose, c.close) * (1 - SPIKE);
  const hi = Math.max(prevClose, c.close) * (1 + SPIKE);
  return { open: c.open < lo || c.open > hi, high: c.high > hi, low: c.low < lo };
}

/** "opening price of ₹1,021.20 and low of ₹1,021.20" */
export function wrongParts(k: Pick<CandleCheck, "bad_open" | "bad_high" | "bad_low" | "open" | "high" | "low">): string {
  const parts = [
    k.bad_open ? `opening price of ${rupees(Number(k.open))}` : null,
    k.bad_low ? `low of ${rupees(Number(k.low))}` : null,
    k.bad_high ? `high of ${rupees(Number(k.high))}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length <= 1 ? (parts[0] ?? "price") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** One plain sentence for the stock page: what looked wrong and what the rules do about it. */
export function setAsideSentence(k: CandleCheck): string {
  const what =
    `On ${date(k.day)} Yahoo's ${wrongParts(k)} was far from the closes around it ` +
    `(${rupees(Number(k.prev_close))} the day before, ${rupees(Number(k.close))} that day).`;
  return k.status === "bad"
    ? `${what} We checked it and set it aside: our rules use the close for that day.`
    : `${what} Until it is checked, our rules use the close for that day.`;
}
