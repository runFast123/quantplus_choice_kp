/**
 * "Am I too late?" (the Head-start meter). Where a stock stands against its one-year low, and what each rule's own
 * trades did when they started from that stage, in the tested record (research/strategies/head_start.py, 2019-07 to
 * 2026-10, each year's 300 most traded NSE stocks, the rule's own plan, after 0.5 % costs).
 *
 * What the test found, and so what this may say: being nearer the low did NOT make the rules' trades better. For the dip
 * rules, stocks further above their low did better in both periods; for the trend rules the two periods disagree. So
 * the meter only reports the measured numbers for the stock's band, next to the rule's own average, period by period.
 * It never forecasts and never says "early is better" (AGENTS rule 13).
 */
import { HEAD_START, type BandStats } from "./head-start-data";
import { RULES, type RuleKey } from "./rules";

export const MIN_TRADES = 30;
/** Medians closer than this (percentage points) read as "about the same". */
export const SAME_WITHIN = 1;

export const BANDS = [
  { key: "<25%", max: 0.25, label: "less than 25% above its 1-year low" },
  { key: "25-50%", max: 0.5, label: "25–50% above its 1-year low" },
  { key: "50-100%", max: 1, label: "50–100% above its 1-year low" },
  { key: ">=100%", max: Infinity, label: "more than double its 1-year low" },
] as const;
export type BandKey = (typeof BANDS)[number]["key"];
export const PERIODS = [
  { key: "2019-23", label: "Jul 2019 – Dec 2023", short: "2019–23" },
  { key: "2024-26", label: "Jan 2024 – Oct 2026", short: "2024–26" },
] as const;
export type PeriodKey = (typeof PERIODS)[number]["key"];

export interface Stage {
  /** price / 1-year low − 1 */
  run: number;
  /** 0 at the 1-year low, 1 at the 1-year high */
  position: number;
  band: BandKey;
  where: "near the bottom" | "in the lower half" | "in the upper half" | "near the top";
}

/** The stage of a price against its 1-year low and high; null when either is missing or the range is empty. */
export function stageOf(price: number | null | undefined, low: number | null | undefined, high: number | null | undefined): Stage | null {
  if (price == null || low == null || high == null || !(low > 0) || !(high > low) || !(price > 0)) return null;
  const run = price / low - 1;
  const position = Math.min(1, Math.max(0, (price - low) / (high - low)));
  const band = BANDS.find((b) => run < b.max)!.key;
  const where = position < 0.25 ? "near the bottom" : position < 0.5 ? "in the lower half" : position < 0.75 ? "in the upper half" : "near the top";
  return { run, position, band, where };
}

export type Verdict = "better" | "about the same" | "worse" | "too few";

/** A band's median against the rule's own median in the same period. */
export function verdictOf(band: BandStats, rule: BandStats): Verdict {
  if (band.n < MIN_TRADES || band.median == null || rule.median == null) return "too few";
  const gap = band.median - rule.median;
  return Math.abs(gap) < SAME_WITHIN ? "about the same" : gap > 0 ? "better" : "worse";
}

export interface RuleRow {
  rule: RuleKey;
  name: string;
  band: BandStats;
  periods: { key: PeriodKey; label: string; band: BandStats; rule: BandStats; verdict: Verdict }[];
  /** Both periods agree (and neither is "too few"); null when they don't. */
  steady: Exclude<Verdict, "too few"> | null;
}

/** One row per live rule for the stock's band, in the rules' display order. */
export function rowsFor(band: BandKey): RuleRow[] {
  return RULES.map((r) => {
    const rec = HEAD_START[r.key];
    const periods = PERIODS.map((p) => {
      const b = rec.bands[band][p.key];
      const base = rec.periods[p.key];
      return { key: p.key, label: p.label, band: b, rule: base, verdict: verdictOf(b, base) };
    });
    const [a, b] = periods.map((p) => p.verdict);
    return {
      rule: r.key,
      name: r.name,
      band: rec.bands[band].all,
      periods,
      steady: a === b && a !== "too few" ? a : null,
    };
  });
}

/** The plain sentence under the table: which rules did better / worse from this band in both periods. */
export function summaryOf(rows: RuleRow[]): string {
  const names = (v: RuleRow["steady"]) => rows.filter((r) => r.steady === v).map((r) => r.name);
  const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const parts: string[] = [];
  const better = names("better");
  const same = names("about the same");
  const worse = names("worse");
  if (better.length) parts.push(`${list(better)} did better from this stage than on average, in both periods`);
  if (same.length) parts.push(`${list(same)} did about the same as on average, in both periods`);
  if (worse.length) parts.push(`${list(worse)} did worse from this stage, in both periods`);
  const rest = rows.length - better.length - same.length - worse.length;
  if (!parts.length) return "In the tested record, no rule did steadily better or worse from this stage: the two periods disagree or there were too few trades.";
  return `In the tested record, ${parts.join("; ")}.${rest ? ` For the other ${rest === 1 ? "rule" : `${rest} rules`} the two periods disagree or there were too few trades.` : ""}`;
}
