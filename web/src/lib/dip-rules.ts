/**
 * RSI dip and KK dip (migration 35, ADR-036): a short, sharp dip in a rising stock, bought only at a lower price the
 * next day and sold into the first bounce. The rules run in SQL (private.refresh_dip_rules); this file explains them.
 */

export type DipRule = "rsi_dip" | "kk_dip";

export const isDipRule = (s: string | null | undefined): s is DipRule => s === "rsi_dip" || s === "kk_dip";

/** The exit, in plain words (shown where other rules show a target). */
export const DIP_EXIT = "Sell on the first close above the 5-day average, at most 10 sessions";

/** Status of an open dip trade against its safety stop. */
export function dipStatus(stop: number | null, last: number | null): { label: string; tone: "neutral" | "loss" } {
  if (stop != null && last != null && last <= stop) return { label: "Below safety stop", tone: "loss" };
  return { label: "Open", tone: "neutral" };
}

/**
 * Tested on past prices: research/strategies/record_dip.py, Jul 2019 – Oct 2026, each year's 300 most traded NSE
 * stocks, the exact SQL rules (fills only when the price trades 0.2 % through the dip-buy level), 0.5 % round-trip
 * cost. Update only by re-running that script.
 */
export const DIP_TESTED: Record<DipRule, {
  period: string;
  trades: number;
  madeMoneyPct: number;
  avgTradePct: number;
  avgWinPct: number;
  avgLossPct: number;
  recent: { period: string; madeMoneyPct: number; avgTradePct: number };
  before: { wrongPct: number; avgTradePct: number };
}> = {
  rsi_dip: {
    period: "Jul 2019 – Oct 2026",
    trades: 3058,
    madeMoneyPct: 64,
    avgTradePct: 0.67,
    avgWinPct: 3.8,
    avgLossPct: -4.7,
    recent: { period: "2024 – Oct 2026", madeMoneyPct: 60, avgTradePct: 0.59 },
    // the old RSI reversal rule on the same stocks and years, 2024 – Oct 2026 (research/strategies/improve.py)
    before: { wrongPct: 62, avgTradePct: -0.64 },
  },
  kk_dip: {
    period: "Jul 2019 – Oct 2026",
    trades: 1070,
    madeMoneyPct: 68,
    avgTradePct: 0.77,
    avgWinPct: 4.4,
    avgLossPct: -6.9,
    recent: { period: "2024 – Oct 2026", madeMoneyPct: 67, avgTradePct: 1.46 },
    before: { wrongPct: 62, avgTradePct: -0.94 },
  },
};

/** One plain sentence for a strategy card. */
export function dipTestedSentence(rule: DipRule): string {
  const t = DIP_TESTED[rule];
  const sign = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`;
  return (
    `Tested on past prices (${t.period}, ${t.trades.toLocaleString("en-IN")} trades): ${t.madeMoneyPct} in 100 made money ` +
    `after costs, the average trade ${sign(t.avgTradePct)}% (winners about ${sign(t.avgWinPct)}%, losers about ` +
    `${sign(t.avgLossPct)}%). ${t.recent.period}: ${t.recent.madeMoneyPct} in 100, ${sign(t.recent.avgTradePct)}%. ` +
    `The old rule it replaced: ${100 - t.before.wrongPct} in 100, ${sign(t.before.avgTradePct)}%.`
  );
}
