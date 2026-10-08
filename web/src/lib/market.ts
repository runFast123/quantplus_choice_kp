// NSE cash-market session clock (IST). Exchange holidays are not modelled yet.
export type SessionState = "pre-open" | "open" | "closed";

function istParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { weekday: get("weekday"), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function nseSession(now = new Date()): { state: SessionState; label: string } {
  const { weekday, minutes } = istParts(now);
  if (weekday === "Sat" || weekday === "Sun") return { state: "closed", label: "Closed · weekend" };
  if (minutes >= 9 * 60 && minutes < 9 * 60 + 15) return { state: "pre-open", label: "Pre-open" };
  if (minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30) return { state: "open", label: "Market open" };
  return { state: "closed", label: minutes < 9 * 60 ? "Opens 09:15" : "Closed · 15:30" };
}

/** Where displayed prices come from (ADR-026). "synthetic" only in dev/staging seeds. */
export const PRICE_SOURCE = process.env.NEXT_PUBLIC_MARKET_DATA_MODE === "synthetic" ? "sample data" : "Yahoo Finance";

/** Yahoo's sector vocabulary — the one every symbol carries after the universe sync (ADR-027). */
export const SECTORS = [
  "Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive", "Energy",
  "Financial Services", "Healthcare", "Industrials", "Real Estate", "Technology", "Utilities",
] as const;

export type Segment = "equity" | "sme" | "etf" | "index";
export const SEGMENT_LABEL: Record<Segment, string> = { equity: "Stocks", sme: "SME", etf: "ETFs", index: "Indices" };
