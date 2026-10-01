// Indian number formatting (lakh/crore grouping) and IST dates.
const inr2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const qtyFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 });

export function price(n: number | null | undefined): string {
  return n == null || Number.isNaN(n) ? "—" : inr2.format(n);
}

export function rupees(n: number | null | undefined, opts: { decimals?: boolean } = {}): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "−" : "";
  return `${sign}₹${(opts.decimals === false ? inr0 : inr2).format(Math.abs(n))}`;
}

/** ₹1.24 Cr / ₹3.50 L for headline figures. */
export function rupeesCompact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
  return `${sign}₹${inr0.format(a)}`;
}

export function paiseToRupees(paise: number): string {
  return rupees(paise / 100, { decimals: paise % 100 !== 0 });
}

export function qty(n: number | null | undefined): string {
  return n == null ? "—" : qtyFmt.format(n);
}

export function volume(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

/** Signed with a true minus sign: +1.24% / −0.80% */
export function pct(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const s = Math.abs(n).toFixed(digits);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${s}%`;
}

export function signed(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${inr2.format(Math.abs(n))}`;
}

const IST = "Asia/Kolkata";
const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "2-digit", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST,
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const longDateFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export const date = (d: string | Date | null | undefined) => (d ? dateFmt.format(new Date(d)) : "—");
export const dateTime = (d: string | Date | null | undefined) => (d ? `${dateTimeFmt.format(new Date(d))} IST` : "—");
export const longDate = (d: string | Date) => longDateFmt.format(new Date(d));

export function relative(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return date(d);
}

/** ISO timestamp `days` ago. Kept out of components so render stays pure. */
export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function daysUntil(d: string | Date): number {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

export const strategyLabel: Record<string, string> = {
  sma_20_50_cross: "SMA 20/50 cross",
  rsi_reversal: "RSI reversal",
};
