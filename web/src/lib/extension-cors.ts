/**
 * CORS for /api/extension/*. Only the extension's own pages (chrome-extension://…) may send
 * cookies and read credentialed responses. With `anyOrigin`, other origins (content scripts run
 * with the broker page's origin) get a plain `*` without credentials, so a Bearer token is the
 * only way in from there. Without it they get no CORS headers and the browser blocks the read.
 */
export function isExtensionOrigin(origin: string | null): origin is string {
  return Boolean(origin && /^chrome-extension:\/\/[a-p]{32}$/.test(origin));
}

export function extensionCors(origin: string | null, { anyOrigin }: { anyOrigin: boolean }): Record<string, string> {
  const base = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "private, no-store",
    Vary: "Origin",
  };
  if (isExtensionOrigin(origin)) {
    return { ...base, "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" };
  }
  return anyOrigin ? { ...base, "Access-Control-Allow-Origin": "*" } : base;
}
