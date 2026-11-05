// Number words for the blog. Prose never uses a minus sign: a negative result is written as "a loss of 1.2%".

/** 51.6 → "51.6%" */
export const pct = (x: number, digits = 1) => `${x.toFixed(digits)}%`;

/** 51.6 → "52 in 100" */
export const in100 = (x: number) => `${Math.round(x)} in 100`;

/** 5.63 → "a gain of 5.6%", -0.26 → "a loss of 0.3%" */
export const result = (x: number, digits = 1) =>
  Math.abs(x) < 0.05 ? "about zero" : x > 0 ? `a gain of ${Math.abs(x).toFixed(digits)}%` : `a loss of ${Math.abs(x).toFixed(digits)}%`;

/** 5795 → "5,795" */
export const count = (x: number) => x.toLocaleString("en-IN");

/** Signed with a glyph, for charts and tables (sign + glyph + colour, never colour alone): "▲ 5.6%", "▼ 0.3%". */
export const signed = (x: number, digits = 1) => (Math.abs(x) < 0.05 ? "0.0%" : `${x > 0 ? "▲" : "▼"} ${Math.abs(x).toFixed(digits)}%`);

/** "2026-11-05" → "5 November 2026" */
export const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** "2025-04-16" → "16 Apr 2025" */
export const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Reading time at 220 words a minute. */
export const readMinutes = (words: number) => Math.max(1, Math.round(words / 220));
