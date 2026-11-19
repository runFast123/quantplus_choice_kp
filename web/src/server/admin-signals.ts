import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fromSignal, fromWatch, istDay, type DaySignal, type SignalSessions, type StockInfo } from "@/lib/admin-signals";
import { RULE_KEYS } from "@/lib/rules";
import { checkKey } from "@/lib/signal-checks";
import { getQuotes } from "./market-data";
import { chunks, pageAll } from "./rule-compare";

/** Sessions the picker offers (about two weeks). */
const SESSIONS = 10;
/** Calendar days that always hold the last ten sessions (two weeks plus a long holiday stretch). */
const WINDOW_DAYS = 28;

type SignalRow = { symbol: string; strategy: string; generated_at: string; payload: Record<string, unknown> | null };
type WatchRow = { symbol: string; strategy: string; signal_day: string; limit_price: unknown; stop: unknown; payload: Record<string, unknown> | null };

/**
 * The admin Signals tab (ADR-063): the seven rules' buys and exits on each of the last ten closes, and the dip-buy
 * levels for the session after the latest one, all at once (a few hundred rows), so the browser switches sessions and
 * filters without asking again. Two round trips: everything that doesn't need the symbols side by side, then their
 * quotes. Reads with the caller's own sign-in: market data every member may read (RLS), nobody's holdings or lists.
 */
export async function loadSignalSessions(db: SupabaseClient): Promise<SignalSessions> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const [candleRes, weatherRes, signalRows, watchRows, checkRes] = await Promise.all([
    // Sessions = days with a NIFTY candle (one per trading day).
    db.from("market_candles").select("ts").eq("symbol", "NIFTY").eq("exchange", "NSE").order("ts", { ascending: false }).limit(SESSIONS),
    // The market weather is worked out in the same run as the rules, so its latest day is the last close they ran on.
    db.from("market_weather").select("day, state").gte("day", since).order("day", { ascending: false }),
    pageAll<SignalRow>((a, b) =>
      db
        .from("trading_signals")
        .select("symbol, strategy, generated_at, payload")
        .in("strategy", [...RULE_KEYS])
        .gte("generated_at", `${since}T00:00:00+05:30`)
        .order("generated_at", { ascending: false })
        .order("id")
        .range(a, b),
    ),
    pageAll<WatchRow>((a, b) =>
      db.from("signal_watch").select("symbol, strategy, signal_day, limit_price, stop, payload").order("symbol").order("strategy").range(a, b),
    ),
    // A dip's check is on its setup close, up to a session before the buy.
    db.from("signal_checks").select("strategy, symbol, signal_day").eq("tagged", true).gte("signal_day", since).limit(1000),
  ]);

  const sessions = [...new Set((candleRes.data ?? []).map((r) => istDay(r.ts as string)))];
  const weather = new Map((weatherRes.data ?? []).map((w) => [String(w.day).slice(0, 10), w.state as string | null]));
  const analysedThrough = [...weather.keys()].sort().at(-1) ?? null;
  const latest = sessions[0] ?? null;
  const latestRun = sessions.find((d) => analysedThrough != null && d <= analysedThrough) ?? latest;
  const pending = latest != null && analysedThrough != null && latest > analysedThrough ? latest : null;

  const wanted = new Set(sessions);
  const byDay: Record<string, DaySignal[]> = Object.fromEntries(sessions.map((d) => [d, []]));
  for (const row of signalRows) {
    const s = fromSignal(row);
    const d = istDay(row.generated_at);
    if (s && wanted.has(d)) byDay[d].push(s);
  }
  // The dip-buy levels are for the session after the close they were set on; only the latest close's are kept.
  for (const w of watchRows) {
    const s = fromWatch(w);
    if (s && wanted.has(s.checkDay)) byDay[s.checkDay].push(s);
  }

  const symbols = [...new Set(Object.values(byDay).flatMap((list) => list.map((s) => s.symbol)))];
  const quoteMaps = await Promise.all(chunks(symbols, 150).map((group) => getQuotes(db, group)));
  const info: Record<string, StockInfo> = {};
  for (const m of quoteMaps)
    for (const [symbol, q] of m)
      info[symbol] = { name: q.name, sector: q.sector, segment: q.segment ?? null, rank: q.mcap_rank ?? null, last: q.last_price, changePct: q.change_pct };

  return {
    latestRun,
    pending,
    sessions: sessions.map((d) => ({
      day: d,
      weather: weather.get(d) ?? null,
      // Stocks with a buy or a dip-buy level on that close.
      stocks: new Set(byDay[d].filter((s) => s.kind !== "exit").map((s) => s.symbol)).size,
    })),
    byDay,
    info,
    tags: (checkRes.data ?? []).map((t) => checkKey(t.strategy, t.symbol, String(t.signal_day).slice(0, 10))),
  };
}
