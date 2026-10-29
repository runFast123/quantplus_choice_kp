/**
 * What a browser notification says and where clicking it goes, from an in-app notification row.
 * Pure, so the sender (server/privileged/push.ts) and the tests agree.
 */
export interface PushPayload {
  title: string;
  body: string;
  /** App path opened on click. */
  url: string;
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag: string;
}

const SYMBOL = /^[A-Z0-9&\-.]{1,20}$/;

export function notificationUrl(type: string, data: Record<string, unknown> | null | undefined): string {
  const symbol = typeof data?.symbol === "string" && SYMBOL.test(data.symbol) ? data.symbol : null;
  switch (type) {
    case "price_alert":
      return symbol ? `/app/markets/${encodeURIComponent(symbol)}` : "/app/alerts";
    case "exit_signal":
    case "research_stance":
      return symbol ? `/app/markets/${encodeURIComponent(symbol)}` : "/app/signals";
    case "plan_expiry":
      return "/app/billing";
    default:
      return "/app";
  }
}

export function toPushPayload(n: {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  data?: Record<string, unknown> | null;
}): PushPayload {
  return {
    title: n.title.slice(0, 120),
    body: (n.body ?? "").slice(0, 240),
    url: notificationUrl(n.type, n.data),
    tag: `${n.type}:${n.id}`,
  };
}
