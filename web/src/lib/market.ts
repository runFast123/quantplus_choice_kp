// NSE cash-market session clock (IST) with official NSE Trading Holiday calendar.
export type SessionState = "pre-open" | "open" | "closed";

/**
 * Official NSE Trading Holidays (Cash Market / Equities)
 * Source: NSE India Official Trading Calendar
 */
export const NSE_HOLIDAYS: Record<string, string> = {
  // 2025
  "2025-02-26": "Mahashivratri",
  "2025-03-14": "Holi",
  "2025-03-31": "Id-Ul-Fitr",
  "2025-04-10": "Mahavir Jayanti",
  "2025-04-14": "Ambedkar Jayanti",
  "2025-04-18": "Good Friday",
  "2025-05-01": "Maharashtra Day",
  "2025-06-07": "Bakri Id",
  "2025-08-15": "Independence Day",
  "2025-08-27": "Ganesh Chaturthi",
  "2025-10-02": "Gandhi Jayanti",
  "2025-10-21": "Dussehra",
  "2025-10-22": "Diwali Balipratipada",
  "2025-11-05": "Guru Nanak Jayanti",
  "2025-12-25": "Christmas",

  // 2026
  "2026-01-26": "Republic Day",
  "2026-02-17": "Mahashivratri",
  "2026-03-03": "Holi",
  "2026-03-20": "Id-Ul-Fitr",
  "2026-04-03": "Good Friday",
  "2026-04-14": "Ambedkar Jayanti",
  "2026-05-01": "Maharashtra Day",
  "2026-05-27": "Bakri Id",
  "2026-06-26": "Muharram",
  "2026-08-15": "Independence Day",
  "2026-09-04": "Milad-un-Nabi",
  "2026-10-02": "Gandhi Jayanti",
  "2026-10-20": "Dussehra",
  "2026-11-08": "Diwali Laxmi Pujan",
  "2026-11-10": "Diwali Balipratipada",
  "2026-11-24": "Guru Nanak Jayanti",
  "2026-12-25": "Christmas",

  // 2027
  "2027-01-26": "Republic Day",
  "2027-03-08": "Mahashivratri",
  "2027-03-22": "Holi",
  "2027-03-26": "Good Friday",
  "2027-04-14": "Ambedkar Jayanti",
  "2027-05-01": "Maharashtra Day",
  "2027-08-15": "Independence Day",
  "2027-10-02": "Gandhi Jayanti",
  "2027-10-10": "Dussehra",
  "2027-10-29": "Diwali Laxmi Pujan",
  "2027-11-14": "Guru Nanak Jayanti",
  "2027-12-25": "Christmas",
};

export interface NseSessionInfo {
  state: SessionState;
  label: string;
  isHoliday: boolean;
  holidayName?: string;
  isWeekend: boolean;
}

function istParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const isoDate = `${year}-${month}-${day}`;
  const weekday = get("weekday");
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return { isoDate, weekday, minutes };
}

export function nseSession(now = new Date()): NseSessionInfo {
  const { isoDate, weekday, minutes } = istParts(now);
  const isWeekend = weekday === "Sat" || weekday === "Sun";
  const holidayName = NSE_HOLIDAYS[isoDate];
  const isHoliday = Boolean(holidayName);

  // Check for Diwali Laxmi Pujan special Muhurat trading session (18:15 to 19:15 IST)
  if (holidayName && holidayName.includes("Laxmi Pujan")) {
    if (minutes >= 18 * 60 + 15 && minutes <= 19 * 60 + 15) {
      return { state: "open", label: "Muhurat session open", isHoliday: true, holidayName, isWeekend };
    }
    if (minutes < 18 * 60 + 15) {
      return { state: "closed", label: "Muhurat session 18:15", isHoliday: true, holidayName, isWeekend };
    }
  }

  if (isHoliday) {
    return { state: "closed", label: `Closed · ${holidayName}`, isHoliday: true, holidayName, isWeekend };
  }

  if (isWeekend) {
    return { state: "closed", label: "Closed · weekend", isHoliday: false, isWeekend: true };
  }

  if (minutes >= 9 * 60 && minutes < 9 * 60 + 15) {
    return { state: "pre-open", label: "Pre-open", isHoliday: false, isWeekend: false };
  }

  if (minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30) {
    return { state: "open", label: "Market open", isHoliday: false, isWeekend: false };
  }

  return {
    state: "closed",
    label: minutes < 9 * 60 ? "Opens 09:15" : "Closed · 15:30",
    isHoliday: false,
    isWeekend: false,
  };
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
