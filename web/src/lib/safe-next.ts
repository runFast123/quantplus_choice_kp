/**
 * Turns an untrusted `next` value into a same-origin path, or `fallback`.
 * Parsing with the URL API (instead of prefix checks) closes the tricks that
 * browsers normalise into another origin: "//evil.com", "/\evil.com",
 * "/\t/evil.com", control characters, and absolute URLs.
 */
export function safeNext(raw: unknown, fallback = "/app"): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.length > 2000) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const base = "http://same-origin.invalid";
    const u = new URL(raw, base);
    if (u.origin !== base) return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}
