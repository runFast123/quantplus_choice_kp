/**
 * The Stay-in Plan (ADR-060): an optional exit for a stock a trend rule bought. Instead of selling on the 60th session,
 * hold until the first close below the 200-day average, with the rule's own safety stop from the first day. Tested in
 * research/strategies/stay_in.py (pre-registered; data/stay_in.json); the notifier messages holders who turn it on
 * (migration 61). The rules' own plans and records are unchanged.
 */
import type { Candle, Signal } from "./types";

export const STAY_IN_RULES = ["strong_trend", "sma_trend", "ma200_trend", "secular_trend"] as const;
const SMA = 200;

/** The tested record: four trend rules pooled, 10 equal slots, 0.5 % costs (data/stay_in.json, 17 Nov 2026). */
export const STAY_IN_RECORD = [
  { period: "Jul 2019 – Dec 2023", plan: { cagr: 24.2, fall: -27.9 }, stay: { cagr: 30.5, fall: -22.8, trades: 132 } },
  { period: "Jan 2024 – Oct 2026", plan: { cagr: 15.5, fall: -22.4 }, stay: { cagr: 19.6, fall: -25.2, trades: 74 } },
] as const;
/** Share of Stay-in trades that made money in the 2024–26 check (each signal on its own, closed trades). */
export const STAY_IN_WIN_2024 = 26;

export interface StayIn {
  signal: Signal;
  /** The trend rule's buy day (IST). */
  from: string;
  stop: number | null;
  /** The 200-day average at the last stored close (null under 200 closes). */
  sma200: number | null;
  last: number | null;
  status: "running" | "ended";
  /** When and why it ended (the first day after the buy). */
  endedOn: string | null;
  how: "stop" | "ma200" | null;
}

const istDay = (ts: string) => new Date(Date.parse(ts) + 330 * 60_000).toISOString().slice(0, 10);

/**
 * The Stay-in Plan's state for the latest trend-rule buy among `signals`, read from `candles` (oldest first). Mirrors
 * the notifier: after the buy day, the first day whose low reaches the stop or whose close is under its 200-day average
 * ends it. null when no trend rule has bought this stock.
 */
export function stayInState(candles: Candle[], signals: Signal[]): StayIn | null {
  const buy = signals
    .filter((s) => s.signal_type === "buy" && (STAY_IN_RULES as readonly string[]).includes(s.strategy))
    .sort((a, b) => (a.generated_at < b.generated_at ? 1 : -1))[0];
  if (!buy) return null;
  const from = istDay(buy.generated_at);
  const stopRaw = Number(buy.payload?.stop);
  const stop = Number.isFinite(stopRaw) && stopRaw > 0 ? stopRaw : null;

  let sum = 0;
  const sma: (number | null)[] = candles.map((c, i) => {
    sum += c.close;
    if (i >= SMA) sum -= candles[i - SMA].close;
    return i >= SMA - 1 ? sum / SMA : null;
  });
  let endedOn: string | null = null;
  let how: StayIn["how"] = null;
  for (let i = 0; i < candles.length; i++) {
    const day = istDay(candles[i].ts);
    if (day <= from) continue;
    if (stop != null && candles[i].low <= stop) {
      endedOn = day;
      how = "stop";
      break;
    }
    const m = sma[i];
    if (m != null && candles[i].close < m) {
      endedOn = day;
      how = "ma200";
      break;
    }
  }
  const n = candles.length;
  return {
    signal: buy,
    from,
    stop,
    sma200: n ? sma[n - 1] : null,
    last: n ? candles[n - 1].close : null,
    status: endedOn ? "ended" : "running",
    endedOn,
    how,
  };
}
