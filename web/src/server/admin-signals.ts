import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fromSignal, fromWatch, istDay, type DaySignal, type StockInfo } from "@/lib/admin-signals";
import { RULE_KEYS } from "@/lib/rules";
import { checkKey } from "@/lib/signal-checks";
import { getQuotes, getRuleHealth } from "./market-data";
import { chunks, pageAll } from "./rule-compare";

/** Sessions the picker offers (about two weeks). */
const SESSIONS = 10;

type SignalRow = { symbol: string; strategy: string; generated_at: string; payload: Record<string, unknown> | null };
type WatchRow = { symbol: string; strategy: string; signal_day: string; limit_price: unknown; stop: unknown; payload: Record<string, unknown> | null };

export type DaySignals = Awaited<ReturnType<typeof loadDaySignals>>;

/**
 * The admin Signals tab (ADR-063): the seven rules' buys and exits on one session's close and the dip-buy levels for the
 * session after the latest one. Reads with the caller's own sign-in: signals, levels and quotes are market data every
 * member may read (RLS), nobody's holdings or lists. `requested` is the session asked for ("2026-11-18"); anything not
 * in the last ten sessions falls back to the latest session the rules have run on.
 */
export async function loadDaySignals(db: SupabaseClient, requested: string | null) {
  const [candleRes, weatherRes] = await Promise.all([
    // Sessions = days with a NIFTY candle (one per trading day).
    db.from("market_candles").select("ts").eq("symbol", "NIFTY").eq("exchange", "NSE").order("ts", { ascending: false }).limit(SESSIONS),
    // The market weather is worked out in the same run as the rules, so its latest day is the last close they ran on.
    db.from("market_weather").select("day, state").order("day", { ascending: false }).limit(SESSIONS + 5),
  ]);
  const sessions = [...new Set((candleRes.data ?? []).map((r) => istDay(r.ts as string)))];
  const weather = new Map((weatherRes.data ?? []).map((w) => [String(w.day).slice(0, 10), w.state as string | null]));
  const analysedThrough = [...weather.keys()].sort().at(-1) ?? null;
  const latest = sessions[0] ?? null;
  const latestRun = sessions.find((d) => analysedThrough != null && d <= analysedThrough) ?? latest;
  const day = requested && sessions.includes(requested) ? requested : latestRun;
  // Prices for the newest session are in but the rules have not run on them yet (a few minutes after the price load).
  const pending = latest != null && analysedThrough != null && latest > analysedThrough ? latest : null;

  const oldest = sessions.at(-1);
  const [signalRows, watchRows, checkRes, health] = await Promise.all([
    oldest
      ? pageAll<SignalRow>((a, b) =>
          db
            .from("trading_signals")
            .select("symbol, strategy, generated_at, payload")
            .in("strategy", [...RULE_KEYS])
            .gte("generated_at", `${oldest}T00:00:00+05:30`)
            .order("generated_at", { ascending: false })
            .order("id")
            .range(a, b),
        )
      : Promise.resolve([] as SignalRow[]),
    pageAll<WatchRow>((a, b) =>
      db.from("signal_watch").select("symbol, strategy, signal_day, limit_price, stop, payload").order("symbol").order("strategy").range(a, b),
    ),
    oldest
      ? db
          .from("signal_checks")
          .select("strategy, symbol, signal_day")
          .eq("tagged", true)
          // A dip's check is on its setup close, up to a session before the buy.
          .gte("signal_day", new Date(Date.parse(oldest) - 7 * 86400000).toISOString().slice(0, 10))
          .limit(1000)
      : Promise.resolve({ data: [] as { strategy: string; symbol: string; signal_day: string }[] }),
    getRuleHealth(db),
  ]);

  // For the picker: per session, the stocks with a buy or a dip-buy level on that close.
  const perDay = new Map<string, Set<string>>();
  const signals: DaySignal[] = [];
  for (const row of signalRows) {
    const s = fromSignal(row);
    if (!s) continue;
    const d = istDay(row.generated_at);
    if (s.kind === "buy") perDay.set(d, (perDay.get(d) ?? new Set()).add(s.symbol));
    if (d === day) signals.push(s);
  }
  // The dip-buy levels are for the session after the close they were set on; only the latest close's are kept.
  let levelsDay: string | null = null;
  for (const w of watchRows) {
    const s = fromWatch(w);
    if (!s) continue;
    levelsDay ??= s.checkDay;
    if (s.checkDay === day) signals.push(s);
    perDay.set(s.checkDay, (perDay.get(s.checkDay) ?? new Set()).add(s.symbol));
  }

  const symbols = [...new Set(signals.map((s) => s.symbol))];
  const quoteMaps = await Promise.all(chunks(symbols, 150).map((group) => getQuotes(db, group)));
  const info = new Map<string, StockInfo>();
  for (const m of quoteMaps)
    for (const [symbol, q] of m)
      info.set(symbol, {
        name: q.name,
        sector: q.sector,
        segment: q.segment ?? null,
        rank: q.mcap_rank ?? null,
        last: q.last_price,
        changePct: q.change_pct,
      });

  const tags = new Set((checkRes.data ?? []).map((t) => checkKey(t.strategy, t.symbol, String(t.signal_day).slice(0, 10))));

  return {
    day,
    latest,
    pending,
    /** Whether `day` is the latest close the rules ran on (its dip levels are for the next session). */
    isLatest: day != null && day === latestRun,
    levelsDay,
    weather: day ? (weather.get(day) ?? null) : null,
    sessions: sessions.map((d) => ({ day: d, stocks: perDay.get(d)?.size ?? 0 })),
    signals,
    info,
    tags,
    health: health.latest,
  };
}
