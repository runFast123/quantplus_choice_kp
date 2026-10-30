import { signalDisplayName } from "./format";
import type { RawChartMarker } from "./trade-plan";
import type { Signal } from "./types";

/**
 * What a chart signal is as a trade action, and which entry and exit belong together.
 * Shared by the price chart and the Chrome extension so both explain a signal the same way.
 */
export type SignalAction = "buy" | "sell" | "exit" | "cover";

/** KK breakdowns open a short ("sell") that a "cover" closes; both are stored as signal_type "exit". */
export function signalAction(m: RawChartMarker): SignalAction {
  const label = m.label.toLowerCase();
  // Same order of checks the price chart has always used for its arrows.
  if (m.action === "buy" || (!m.action && m.kind === "buy" && !label.includes("cover"))) return "buy";
  if (
    m.action === "sell" ||
    (!m.action && (label.includes("breakdown") || label.includes("sell")) && !label.includes("cover") && !m.resultType)
  ) {
    return "sell";
  }
  if (m.action === "cover" || label.includes("cover")) return "cover";
  return "exit";
}

/** An exit or cover that closed in profit. */
export function isWinningExit(m: RawChartMarker): boolean {
  return (
    (m.realizedR ?? 0) > 0 ||
    (m.pnlPct ?? 0) > 0 ||
    m.resultType === "TARGET_2_HIT" ||
    m.resultType === "TARGET_1_HIT_TIME_EXIT"
  );
}

// How a KK trade ended, from payload.result.
export const KK_RESULTS: Record<string, string> = {
  TARGET_2_HIT: "Target 2 (+2R) was reached.",
  TARGET_1_HIT_TIME_EXIT: "Target 1 (+0.75R) was reached, then the 5-session time limit closed the rest.",
  SL_HIT_AFTER_TARGET_1: "Target 1 (+0.75R) was reached, then the stop closed the rest.",
  SL_HIT: "The stop was hit.",
  TIME_EXIT: "Neither target nor stop was hit within 5 sessions.",
};

/** One plain sentence on what the rule saw — the Signals page's strategy rules, per action. */
export function ruleSentence(strategy: string, action: SignalAction, resultType?: string | null): string {
  switch (strategy) {
    case "sma_20_50_cross":
      return action === "buy"
        ? "The 20-day average closed above the 50-day average."
        : "The 20-day average closed back below the 50-day average.";
    case "rsi_reversal":
      return action === "buy"
        ? "14-day RSI climbed back above 30 after being oversold."
        : "14-day RSI fell back below 70 after being overbought.";
    case "kk_breakout": {
      // simulateKkStrategy: a ≥1% push past the 20-day extreme, confirmed when price crosses that bar's other end.
      if (action === "buy") return "Price dipped at least 1% below its 20-day low, then traded back above that day's high within 5 sessions.";
      if (action === "sell") return "Price rose at least 1% above its 20-day high, then traded back below that day's low within 5 sessions (short).";
      const result = KK_RESULTS[resultType ?? ""];
      return `The KK ${action === "cover" ? "short" : "long"} trade closed. ${result ?? ""}`.trim();
    }
    default:
      return "";
  }
}

/** Rule sentence plus the realised result, for a chart marker. */
export function explainMarker(m: RawChartMarker): string {
  const action = signalAction(m);
  const parts = [ruleSentence(m.strategy ?? "", action, m.resultType)];
  if (m.realizedR != null && (action === "exit" || action === "cover")) {
    parts.push(`Result ${m.realizedR >= 0 ? "+" : "−"}${Math.abs(m.realizedR).toFixed(2)}R.`);
  }
  return parts.filter(Boolean).join(" ");
}

export interface TradeView {
  direction: "long" | "short";
  entry: RawChartMarker;
  /** The exit or cover that closed it; null while the trade is still open. */
  exit: RawChartMarker | null;
  entryPrice: number;
  /** On the risk side of entry, or null when the signal carries none. */
  stop: number | null;
  /** 1R: distance from entry to stop. */
  risk: number | null;
  /** Targets on the reward side, nearest first, labelled in R when the risk is known. */
  targets: { label: string; price: number }[];
}

const time = (m: RawChartMarker) => new Date(m.ts).getTime();

/**
 * The round trip a signal belongs to: an entry is paired with the next exit (long) or cover
 * (short) of the same strategy; an exit or cover with the entry before it. Null when the entry
 * can't be found or has no price.
 */
export function tradeFor(selected: RawChartMarker, markers: RawChartMarker[]): TradeView | null {
  const action = signalAction(selected);
  const same = markers
    .filter((m) => (m.strategy ?? "") === (selected.strategy ?? ""))
    .sort((a, b) => time(a) - time(b));

  let entry: RawChartMarker | null;
  let exit: RawChartMarker | null;
  if (action === "buy" || action === "sell") {
    entry = selected;
    const closing = action === "buy" ? "exit" : "cover";
    exit = same.find((m) => time(m) > time(selected) && signalAction(m) === closing) ?? null;
  } else {
    exit = selected;
    const opening = action === "exit" ? "buy" : "sell";
    entry = [...same].reverse().find((m) => time(m) < time(selected) && signalAction(m) === opening) ?? null;
  }
  if (!entry?.price) return null;

  const direction = signalAction(entry) === "buy" ? "long" : "short";
  const entryPrice = entry.price;
  const sideOk = (p: number | null | undefined, riskSide: boolean) =>
    p != null && p > 0 && (direction === "long" ? (riskSide ? p < entryPrice : p > entryPrice) : riskSide ? p > entryPrice : p < entryPrice);

  const stop = sideOk(entry.stop, true) ? (entry.stop as number) : null;
  const risk = stop != null ? Math.abs(entryPrice - stop) : null;
  const rLabel = (p: number) => (risk ? ` +${(Math.abs(p - entryPrice) / risk).toFixed(2).replace(/\.?0+$/, "")}R` : "");
  const raw = [entry.target1, entry.target2].filter((p): p is number => sideOk(p, false));
  const targets = [...new Set(raw)]
    .sort((a, b) => Math.abs(a - entryPrice) - Math.abs(b - entryPrice))
    .map((p, i, all) => ({ label: `${all.length > 1 ? `T${i + 1}` : "Target"}${rLabel(p)}`, price: p }));

  return { direction, entry, exit, entryPrice, stop, risk, targets };
}

/** A stored signal (trading_signals row) as a chart marker: price, stop, targets and result from its payload. */
export function markerFromSignal(sg: Signal): RawChartMarker {
  return {
    ts: sg.generated_at,
    kind: sg.signal_type,
    label: (sg.payload?.label as string) || signalDisplayName(sg.strategy, sg.signal_type),
    strategy: sg.strategy,
    price: Number(sg.payload.close ?? sg.payload.trigger_price ?? sg.payload.entry ?? 0) || null,
    stop: Number(sg.payload.stop ?? 0) || null,
    target1: Number(sg.payload.target1 ?? sg.payload.target ?? 0) || null,
    target2: Number(sg.payload.target2 ?? 0) || null,
    realizedR: sg.payload.realized_r != null ? Number(sg.payload.realized_r) : null,
    pnlPct: sg.payload.pnl_pct != null ? Number(sg.payload.pnl_pct) : null,
    resultType: (sg.payload.result as string) || null,
    action:
      (typeof sg.payload.action === "string"
        ? (sg.payload.action as "buy" | "sell" | "exit" | "cover")
        : undefined) ||
      (sg.payload.direction === "sell" && sg.signal_type === "exit" ? "sell" : sg.signal_type),
    direction:
      (typeof sg.payload.direction === "string"
        ? (sg.payload.direction as "buy" | "sell")
        : undefined) || (sg.strategy === "kk_breakout" ? "buy" : undefined),
    barsHeld: Number(sg.payload.bars_held ?? 0) || null,
  };
}
