import { signalDisplayName } from "./format";

/**
 * One stored signal as the Chrome extension shows it. `kind` is the trade action, not the DB
 * `signal_type`: KK breakdowns open a short ("sell") and close it with a "cover", and both are
 * stored as signal_type "exit" with the action in `payload.action`.
 */
export interface ExtensionSignal {
  kind: "buy" | "sell" | "exit" | "cover";
  strategy: string;
  label: string;
  date: string;
  price: number | null;
  stop: number | null;
}

export type SignalRow = {
  strategy: string;
  signal_type: string;
  generated_at: string;
  payload: Record<string, unknown> | null;
};

const ACTIONS = new Set(["buy", "sell", "exit", "cover"]);

// How a KK trade ended, from payload.result.
const KK_RESULTS: Record<string, string> = {
  TARGET_2_HIT: "Target 2 (+2R) was reached.",
  TARGET_1_HIT_TIME_EXIT: "Target 1 (+0.75R) was reached, then the 5-session time limit closed the rest.",
  SL_HIT_AFTER_TARGET_1: "Target 1 (+0.75R) was reached, then the stop closed the rest.",
  SL_HIT: "The stop was hit.",
  TIME_EXIT: "Neither target nor stop was hit within 5 sessions.",
};

/** One plain sentence on what the rule saw — the signal page's strategy rules, per action. */
export function describeSignal(s: SignalRow): string {
  const kind = toExtensionSignal(s).kind;
  const result = KK_RESULTS[String(s.payload?.result ?? "")];
  switch (s.strategy) {
    case "sma_20_50_cross":
      return kind === "buy"
        ? "The 20-day average closed above the 50-day average."
        : "The 20-day average closed back below the 50-day average.";
    case "rsi_reversal":
      return kind === "buy"
        ? "14-day RSI climbed back above 30 after being oversold."
        : "14-day RSI fell back below 70 after being overbought.";
    case "kk_breakout":
      // simulateKkStrategy: a ≥1% push past the 20-day extreme, confirmed when price crosses that bar's other end.
      if (kind === "buy") return "Price dipped at least 1% below its 20-day low, then traded back above that day's high within 5 sessions.";
      if (kind === "sell") return "Price rose at least 1% above its 20-day high, then traded back below that day's low within 5 sessions (short).";
      return `The KK ${kind === "cover" ? "short" : "long"} trade closed. ${result ?? ""}`.trim();
    default:
      return toExtensionSignal(s).label;
  }
}

export function toExtensionSignal(s: SignalRow): ExtensionSignal {
  const p = s.payload ?? {};
  const action = String(p.action ?? "");
  const kind = (ACTIONS.has(action) ? action : s.signal_type === "buy" ? "buy" : "exit") as ExtensionSignal["kind"];
  const isEntry = kind === "buy" || kind === "sell";
  return {
    kind,
    strategy: s.strategy,
    label:
      typeof p.label === "string" && p.label
        ? p.label
        : signalDisplayName(s.strategy, s.signal_type === "buy" ? "buy" : "exit"),
    date: s.generated_at,
    price: Number(p.entry ?? p.fill ?? p.exit_price ?? p.close ?? p.trigger_price ?? 0) || null,
    // A stop belongs to an open position; exits and covers have none.
    stop: isEntry ? Number(p.stop ?? 0) || null : null,
  };
}
