/**
 * The signal rules in one list: the five in use, in the order every page shows them (trend rules first), and the old
 * rules they replaced, whose signals stay as history. Add a rule here first; the chart, the stock page, rule health
 * and the trend-plan check read this list.
 */
export const RULES = [
  { key: "strong_trend", name: "Strong trend", tag: "Trend", kind: "trend", why: "a new 52-week high on heavy volume" },
  { key: "sma_trend", name: "SMA 20/50 trend", tag: "SMA", kind: "trend", why: "the 20-day average turning above the 50-day in a market leader" },
  {
    key: "ma200_trend",
    name: "200-day trend",
    tag: "200D",
    kind: "trend",
    why: "above a flat or rising 200-day average, after a steady climb",
  },
  { key: "rsi_dip", name: "RSI dip", tag: "RSI", kind: "dip", why: "a sharp two-day drop in a rising stock" },
  { key: "kk_dip", name: "KK dip", tag: "KK", kind: "dip", why: "a push under the 20-day low in a rising stock" },
] as const;

export type Rule = (typeof RULES)[number];
export type RuleKey = Rule["key"];

/** Replaced by the dip rules and SMA 20/50 trend (ADR-036, ADR-037); listed as history. */
export const OLD_RULES = [
  { key: "sma_20_50_cross", tag: "SMA·old" },
  { key: "rsi_reversal", tag: "RSI·old" },
  { key: "kk_breakout", tag: "KK·old" },
] as const;

export const RULE_KEYS: readonly RuleKey[] = RULES.map((r) => r.key);
export const isRule = (s: string | null | undefined): s is RuleKey => RULE_KEYS.includes(s as RuleKey);
export const isOldRule = (s: string | null | undefined) => OLD_RULES.some((r) => r.key === s);
export const ruleOf = (s: string | null | undefined): Rule | undefined => RULES.find((r) => r.key === s);

/** The short tag shown on chart markers and timeline chips ("200D", "KK·old"). */
export const ruleTag = (s: string | null | undefined) => ruleOf(s)?.tag ?? OLD_RULES.find((r) => r.key === s)?.tag ?? "Signal";
