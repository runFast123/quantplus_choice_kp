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
