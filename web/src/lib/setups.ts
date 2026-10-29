/**
 * Daily chart setups (migration 31, ADR-031): the rules the nightly scan tags each stock with,
 * on its latest daily close. A setup is a rule match on a chart, never a recommendation.
 */
export const SETUPS = [
  {
    key: "breakout_20d",
    label: "20-day closing high",
    rule: "The last close is above every close of the 20 sessions before it.",
  },
  {
    key: "bull_flag",
    label: "Bull flag",
    rule: "Up more than 10% over ten sessions, then the last five closes stayed inside a 5% range.",
  },
  {
    key: "reclaim_ma20",
    label: "Reclaimed 20-day average",
    rule: "The close before was under its 20-day average; the last close is above it.",
  },
  {
    key: "oversold",
    label: "Oversold",
    rule: "14-day RSI is under 30.",
  },
  {
    key: "oversold_bounce",
    label: "Oversold bounce",
    rule: "14-day RSI was under 30 the session before, and the last close is higher.",
  },
] as const;

export type SetupKey = (typeof SETUPS)[number]["key"];

export const isSetupKey = (v: string): v is SetupKey => SETUPS.some((s) => s.key === v);

/** Known setups in the canonical order, skipping anything unrecognised. */
export function setupsOf(tags: readonly string[] | null | undefined) {
  const set = new Set(tags ?? []);
  return SETUPS.filter((s) => set.has(s.key));
}
