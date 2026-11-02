/**
 * Signal checks (migration 39, ADR-038): Strong trend and RSI dip check their own record and tag a signal when the
 * evidence says so. Nothing is hidden or skipped; the tag is extra information next to the signal. The checks run in
 * SQL (private.refresh_trend_checks, private.refresh_rsi_checks); this file says what they mean and holds their
 * tested record (research/strategies/team/: four researchers, three rounds, design D*** in FINAL.md).
 */

export type CheckRule = "strong_trend" | "rsi_dip";

export const isCheckRule = (s: string | null | undefined): s is CheckRule => s === "strong_trend" || s === "rsi_dip";

/** The tag the app shows, and what it means in plain words. Only 'weak' (Strong trend) and 'high' (RSI dip) tag. */
export const CHECK_TAG: Record<CheckRule, { label: string; title: string }> = {
  strong_trend: {
    label: "Weak lately",
    title:
      "The last 30 finished Strong trend trades in this kind of market lost money over their first 20 sessions. " +
      "In testing, signals tagged like this made money less often (40 in 100 vs 57), but that held in only half the " +
      "months. A research check, not advice.",
  },
  rsi_dip: {
    label: "Stronger dip",
    title:
      "Past RSI dips that looked like this one made money more often than usual (in testing 80 in 100 vs 61 for all " +
      "RSI dips, 2023–26), though not in 2025. A research ranking from past patterns, not advice.",
  },
};

/** The key a check is stored under: the rule, the stock and the close it fired on. */
export const checkKey = (strategy: string, symbol: string, signalDay: string) => `${strategy}|${symbol}|${signalDay}`;

const istDay = (t: number) => new Date(t + 330 * 60_000).toISOString().slice(0, 10);

/** The first day of the current quarter in India time (a refit is due once this has no model). */
export function quarterStartIST(now = Date.now()): string {
  const d = istDay(now);
  return `${d.slice(0, 4)}-${String(3 * Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1).padStart(2, "0")}-01`;
}

/** The India-time date n days ago. */
export const daysAgoIST = (n: number, now = Date.now()) => istDay(now - n * 86_400_000);

/** The close a signal fired on: a dip buy's setup close (payload.signal_day), otherwise the signal's own day (IST). */
export function signalDayOf(sg: { generated_at: string; payload: Record<string, unknown> }): string {
  const setup = sg.payload?.signal_day;
  if (typeof setup === "string" && /^\d{4}-\d{2}-\d{2}$/.test(setup)) return setup;
  return istDay(new Date(sg.generated_at).getTime());
}

type Pair = { n: number; made: number };   // signals, % that made money after the 0.5 % round-trip cost
export type CheckYear = { year: number; tagged: Pair; rest: Pair };

/**
 * Tested record, each year's 300 most traded NSE stocks, walk-forward (every check uses only what was known then),
 * results by the rule's own plan after a 0.5 % round-trip cost. RSI dip: team/metalabel/out/rsi_dip_tier_walk.csv
 * (the check is first in force in 2023; tagged = High, rest = Normal, Low and no-tier). Strong trend:
 * team/health/out/c1p_reference_livegrade.csv. Update only by re-running the team's scripts.
 */
export const CHECK_TESTED: Record<CheckRule, { years: CheckYear[]; periods: { compared: number; worse: number; unit: string } }> = {
  rsi_dip: {
    years: [
      { year: 2023, tagged: { n: 72, made: 86.1 }, rest: { n: 270, made: 60.0 } },
      { year: 2024, tagged: { n: 115, made: 75.7 }, rest: { n: 530, made: 58.7 } },
      { year: 2025, tagged: { n: 6, made: 50.0 }, rest: { n: 309, made: 56.6 } },
      { year: 2026, tagged: { n: 12, made: 91.7 }, rest: { n: 302, made: 59.9 } },
    ],
    // quarters with at least 5 High and 5 Low signals; "worse" = High made money less often than Low
    periods: { compared: 7, worse: 1, unit: "quarters" },
  },
  strong_trend: {
    years: [
      { year: 2021, tagged: { n: 18, made: 22.2 }, rest: { n: 435, made: 55.2 } },
      { year: 2022, tagged: { n: 161, made: 32.3 }, rest: { n: 14, made: 28.6 } },
      { year: 2023, tagged: { n: 38, made: 84.2 }, rest: { n: 393, made: 66.2 } },
      { year: 2024, tagged: { n: 112, made: 43.8 }, rest: { n: 337, made: 51.3 } },
      { year: 2025, tagged: { n: 67, made: 37.3 }, rest: { n: 90, made: 53.3 } },
      { year: 2026, tagged: { n: 31, made: 29.0 }, rest: { n: 19, made: 47.4 } },
    ],
    // months with both kinds of signal; "worse" = Weak signals made money less often than the rest
    periods: { compared: 18, worse: 9, unit: "months" },
  },
};

/** One row of the live record view (public.signal_check_record). */
export type RecordRow = { strategy: string; month: string; label: string; signals: number; trades: number; made_money: number };

/** The live record by year: tagged vs the rest of the checked signals ('none' = too little history to judge), finished
 *  trades only. */
export function liveYears(rows: RecordRow[], rule: CheckRule): CheckYear[] {
  const tagLabel = rule === "rsi_dip" ? "high" : "weak";
  const by = new Map<number, { t: [number, number]; r: [number, number] }>();
  for (const r of rows) {
    if (r.strategy !== rule || !r.trades || r.label === "none") continue;
    const y = Number(r.month.slice(0, 4));
    const e = by.get(y) ?? { t: [0, 0], r: [0, 0] };
    const side = r.label === tagLabel ? e.t : e.r;
    side[0] += Number(r.trades);
    side[1] += Number(r.made_money);
    by.set(y, e);
  }
  const pair = ([n, m]: [number, number]): Pair => ({ n, made: n ? Math.round((1000 * m) / n) / 10 : 0 });
  return [...by.entries()].sort(([a], [b]) => a - b).map(([year, e]) => ({ year, tagged: pair(e.t), rest: pair(e.r) }));
}

/** Totals over years, weighted by signals. */
export function total(years: CheckYear[]): { tagged: Pair; rest: Pair } {
  const sum = (k: "tagged" | "rest") => {
    const n = years.reduce((a, y) => a + y[k].n, 0);
    const made = n ? years.reduce((a, y) => a + y[k].n * y[k].made, 0) / n : 0;
    return { n, made: Math.round(made * 10) / 10 };
  };
  return { tagged: sum("tagged"), rest: sum("rest") };
}

/**
 * The standing line: the whole tested record, then every year in which the tag pointed the wrong way. Computed from
 * the numbers, never written by hand, so it stays true when a new year is added.
 */
export function standingLine(rule: CheckRule, years: CheckYear[]): string {
  if (!years.length) return "";
  const t = total(years);
  const first = years[0].year;
  const pct = (x: number) => Math.round(x);
  const wrong = years.filter((y) =>
    y.tagged.n > 0 && y.rest.n > 0 && (rule === "rsi_dip" ? y.tagged.made < y.rest.made : y.tagged.made > y.rest.made),
  );
  const head =
    rule === "rsi_dip"
      ? `Since ${first}, RSI dips tagged stronger made money ${pct(t.tagged.made)} times in 100 (${t.tagged.n.toLocaleString("en-IN")} signals) vs ${pct(t.rest.made)} for the rest.`
      : `Since ${first}, Strong trend signals tagged weak made money ${pct(t.tagged.made)} times in 100 (${t.tagged.n.toLocaleString("en-IN")} signals) vs ${pct(t.rest.made)} for the rest.`;
  const tail = wrong
    .map((y) =>
      rule === "rsi_dip"
        ? ` In ${y.year} the ${y.tagged.n} tagged dips made money only ${pct(y.tagged.made)} times in 100, below the ${pct(y.rest.made)} of the rest.`
        : ` In ${y.year} the ${y.tagged.n} tagged signals did better than the rest (${pct(y.tagged.made)} vs ${pct(y.rest.made)} in 100).`,
    )
    .join("");
  return head + tail;
}

/** "Worse in X of Y quarters/months", from the tested record. */
export function periodsSentence(rule: CheckRule): string {
  const p = CHECK_TESTED[rule].periods;
  return rule === "rsi_dip"
    ? `Stronger dips beat the weakest third in ${p.compared - p.worse} of ${p.compared} ${p.unit} with enough of both.`
    : `Weak signals did worse than the rest in ${p.worse} of ${p.compared} ${p.unit} with both, so the evidence is thin: one market fall (Nov 2024 – Jan 2025) carries most of it.`;
}
