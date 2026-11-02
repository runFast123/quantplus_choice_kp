/**
 * How a stored headline is shown: without the publisher's name tacked onto the end (the source is already shown above
 * it), without a summary that only repeats the headline, and grouped by India-time day.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** "Zen shares jump 8% - Moneycontrol.com" from "Moneycontrol · Business" → "Zen shares jump 8%". */
export function cleanTitle(title: string, source: string): string {
  const m = title.match(/^(.*\S)\s+[-–—|]\s+([^-–—|]{2,40})$/);
  if (!m) return title;
  const tail = norm(m[2]);
  const src = norm(source);
  const firstWord = tail.split(" ")[0];
  const isPublisher = /\.(com|in|net|org)$/i.test(m[2].trim()) || (firstWord.length >= 3 && src.includes(firstWord));
  return isPublisher && m[1].length >= 20 ? m[1] : title;
}

/** True when the summary adds nothing: it is the headline again, maybe with the publisher's name after it. */
export function summaryEchoes(summary: string | null | undefined, title: string): boolean {
  if (!summary) return true;
  const s = norm(summary);
  const t = norm(title);
  if (!s) return true;
  return s === t || s.startsWith(t) || t.startsWith(s) || (s.length < t.length + 30 && s.includes(t));
}

const istDay = (d: string | Date) => new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** "Today", "Yesterday" or "Mon 26 Oct", in India time. */
export function dayLabel(d: string, now = Date.now()): string {
  const day = istDay(d);
  if (day === istDay(new Date(now))) return "Today";
  if (day === istDay(new Date(now - 86_400_000))) return "Yesterday";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
}

/** Consecutive items (newest first) grouped by India-time day. */
export function groupByDay<T extends { published_at: string }>(items: T[], now = Date.now()): { label: string; items: T[] }[] {
  const out: { label: string; items: T[] }[] = [];
  for (const it of items) {
    const label = dayLabel(it.published_at, now);
    if (out.at(-1)?.label === label) out.at(-1)!.items.push(it);
    else out.push({ label, items: [it] });
  }
  return out;
}

/** The stocks named most often in these headlines, with how many were positive and negative. */
export function stocksInNews(
  items: { symbols: string[]; tone_label: string | null; is_filing: boolean }[],
  limit = 10,
): { symbol: string; n: number; pos: number; neg: number }[] {
  const by = new Map<string, { symbol: string; n: number; pos: number; neg: number }>();
  for (const it of items) {
    for (const symbol of new Set(it.symbols)) {
      const e = by.get(symbol) ?? { symbol, n: 0, pos: 0, neg: 0 };
      e.n += 1;
      if (!it.is_filing && it.tone_label === "positive") e.pos += 1;
      if (!it.is_filing && it.tone_label === "negative") e.neg += 1;
      by.set(symbol, e);
    }
  }
  return [...by.values()].sort((a, b) => b.n - a.n || a.symbol.localeCompare(b.symbol)).slice(0, limit);
}
