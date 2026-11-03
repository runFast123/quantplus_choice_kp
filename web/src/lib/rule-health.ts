/**
 * Rule health and mistake review (migration 40, ADR-039). Every day each rule's last 40 finished trades are compared
 * with its tested record, and every losing trade gets a plain cause. This file turns a public.rule_health row into
 * words. Nothing here changes a rule or hides a signal: a rule outside its range goes to the quarterly review.
 */

export const HEALTH_RULES = ["strong_trend", "sma_trend", "ma200_trend", "rsi_dip", "kk_dip"] as const;
export type HealthRule = (typeof HEALTH_RULES)[number];
export const isHealthRule = (s: string | null | undefined): s is HealthRule => HEALTH_RULES.includes(s as HealthRule);

export type HealthStatus = "below" | "within" | "above" | "too_few";
export type Cause = "market" | "stock" | "small";

/** One row of public.rule_health. */
export interface HealthRow {
  strategy: string;
  day: string;
  trades: number;
  made: number;
  made_pct: number | null;
  expected_pct: number;
  low_pct: number;
  high_pct: number;
  avg_pct: number | null;
  status: HealthStatus;
  causes: Partial<Record<Cause, number>>;
  first_exit: string | null;
  last_exit: string | null;
}

/** The status in a few words, with a tone that is never the only signal (the label says it too). */
export const HEALTH_STATUS: Record<HealthStatus, { label: string; tone: "gain" | "loss" | "neutral"; title: string }> = {
  within: {
    label: "On track",
    tone: "neutral",
    title: "Its recent trades made money about as often as in testing.",
  },
  above: {
    label: "Better than usual",
    tone: "gain",
    title: "Its recent trades made money more often than its tested range. Good runs end; this is not a reason to expect more.",
  },
  below: {
    label: "Weaker than usual",
    tone: "loss",
    title: "Its recent trades made money less often than its tested range. The rule is flagged for the quarterly review; it is not changed or switched off automatically.",
  },
  too_few: {
    label: "Too few trades",
    tone: "neutral",
    title: "Fewer than 20 finished trades so far, too few to judge.",
  },
};

/** Plain words for each cause of a losing trade. */
export const CAUSE: Record<Cause, { label: string; title: string }> = {
  market: { label: "Whole market fell", title: "The Nifty 500 fell 3% or more over the same days." },
  stock: { label: "Stock fell on its own", title: "The market held up; this stock fell anyway." },
  small: { label: "Small loss", title: "Lost under 1.5% after costs: costs and day-to-day noise." },
};

const n100 = (x: number | null) => (x == null ? "—" : String(Math.round(x)));

/** "7 of its last 40 finished trades made money (18 in 100). In testing 52 in 100; with 40 trades, 39 to 65 is normal." */
export function healthSentence(h: HealthRow): string {
  if (h.trades === 0) return "No finished trades yet.";
  const head = `${h.made} of its last ${h.trades} finished trades made money (${n100(h.made_pct)} in 100).`;
  if (h.status === "too_few") return `${head} Too few to judge yet; in testing it made money ${n100(h.expected_pct)} times in 100.`;
  return `${head} In testing ${n100(h.expected_pct)} in 100; with ${h.trades} trades, anything from ${n100(h.low_pct)} to ${n100(h.high_pct)} is normal.`;
}

/** The biggest cause among the window's losing trades, or null without losses. */
export function mainCause(h: Pick<HealthRow, "causes">): { cause: Cause; n: number; of: number } | null {
  const entries = (Object.entries(h.causes ?? {}) as [Cause, number][]).filter(([k]) => k in CAUSE).map(([k, v]) => [k, Number(v)] as const);
  const of = entries.reduce((a, [, v]) => a + v, 0);
  if (!of) return null;
  const [cause, n] = [...entries].sort((a, b) => b[1] - a[1])[0];
  return { cause, n, of };
}

/** "Most of its 33 losing trades (26) came when the whole market fell." */
export function mistakeSentence(h: Pick<HealthRow, "causes">): string {
  const m = mainCause(h);
  if (!m) return "No losing trades in this stretch.";
  const what =
    m.cause === "market" ? "came when the whole market fell" : m.cause === "stock" ? "were the stock falling on its own" : "were small losses (costs and noise)";
  const share = m.n * 2 > m.of ? "Most" : "The largest group";
  return `${share} of its ${m.of} losing trades (${m.n}) ${what}.`;
}

/** Where the dot sits on a 0–100 track, clamped. */
export const pos = (x: number | null) => (x == null ? 0 : Math.min(100, Math.max(0, x)));
