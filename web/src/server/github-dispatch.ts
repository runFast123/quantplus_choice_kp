import "server-only";

/**
 * Starts the Market EOD workflow (pipelines/eod: every NSE symbol, the rules, the audit) on GitHub. GitHub ran its
 * scheduled triggers 5–8 hours late in Oct–Nov 2026, so the app's own 17:00 IST cron starts it instead (ADR-043).
 * Needs GITHUB_DISPATCH_TOKEN (a fine-grained token with Actions: write on this one repository) and GITHUB_REPO
 * ("owner/name"); without them it does nothing and the GitHub schedule remains the trigger. Never logs the token.
 */
export async function dispatchMarketEod(): Promise<{ dispatched: boolean; detail: string }> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return { dispatched: false, detail: "not configured" };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { dispatched: false, detail: "GITHUB_REPO is not owner/name" };
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/market-eod.yml/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "QuantsPulseBot",
      },
      body: JSON.stringify({ ref: "main" }),
      signal: AbortSignal.timeout(10_000),
    });
    // 204 = queued. Anything else is reported with its status only (the body can echo request details).
    return res.status === 204 ? { dispatched: true, detail: "queued" } : { dispatched: false, detail: `GitHub answered ${res.status}` };
  } catch (e) {
    return { dispatched: false, detail: e instanceof Error ? e.name : "request failed" };
  }
}
