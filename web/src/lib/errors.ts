// Maps database errors raised by RLS, triggers and RPCs to copy a person can act on.
export function friendlyDbError(message: string | undefined | null): string {
  const m = message ?? "";
  if (m.includes("PLAN_LIMIT_REACHED")) {
    const limit = m.match(/allows (\d+)/)?.[1];
    return `You've reached your plan's limit${limit ? ` of ${limit} symbols` : ""}. Upgrade to track more.`;
  }
  if (m.includes("NO_ACTIVE_PLAN")) return "Your plan has expired. Renew it to keep adding symbols.";
  if (m.includes("row-level security")) return "Your current plan doesn't include this, or this workspace isn't yours.";
  if (m.includes("NOT_AUTHORIZED")) return "You don't have permission to do that.";
  if (m.includes("duplicate key")) return "That's already there.";
  if (m.includes("violates check constraint") && m.includes("symbol")) return "That isn't a valid NSE/BSE symbol.";
  if (m.includes("violates check constraint")) return "One of the values isn't valid.";
  return "Something went wrong. Please try again.";
}

/**
 * For server pages: a read that failed must not look like an empty list ("You have no holdings"). Throws, so the
 * route's error.tsx shows "This page didn't load" with Try again. Production hides the message from the browser.
 */
export function throwIfFailed(...results: object[]): void {
  // A skipped read stands in as `{ data: [] }`, with no `error` at all.
  for (const r of results) {
    const error = "error" in r ? (r.error as { message?: string } | null) : null;
    if (error) throw new Error(`A database read failed: ${error.message ?? "unknown error"}`);
  }
}

export type ActionState =
  | { ok?: boolean; error?: string; message?: string; data?: Record<string, string> }
  | undefined;
