import { DEFINITION } from "@/lib/site";
import { POSTS } from "@/lib/blog/posts";
import { SITE_URL } from "@/lib/env";

// /llms.txt (llmstxt.org): a plain-text map of the public site for AI answer engines. Built from the same definition
// and post list the pages use, so it never drifts from them (ADR-056).
export const dynamic = "force-static";

export function GET() {
  const page = (path: string, name: string, what: string) => `- [${name}](${SITE_URL}${path}): ${what}`;
  const body = [
    "# QuantsPulse",
    "",
    `> ${DEFINITION}`,
    "",
    "QuantsPulse covers about 3,600 NSE listings (main board, SME, major ETFs and indices) with end-of-day prices from Yahoo Finance, loaded each weekday at about 5 pm IST. There are no intraday prices. Signals are the mechanical output of published rules, not personalised recommendations; users place any order themselves, with their own broker.",
    "",
    "## Pages",
    page("/method", "Method", "the six rules (Strong trend, SMA 20/50 trend, 200-day trend, Secular trend, RSI dip, KK dip), what runs after each close, and the safety stop and plan that come with every buy."),
    page("/chrome-extension", "Chrome extension", "shows a stock's latest signal, safety stop and plan on broker charts (Choice FinX, Zerodha Kite, Groww, Angel One, Upstox, Dhan, Fyers, TradingView and more); read-only, never places orders."),
    page("/pricing", "Pricing", "Basic (free for the first three months), Pro and Pro Plus, priced per year in Indian rupees."),
    page("/faq", "Questions", "advice, data freshness, the extension, privacy and account deletion."),
    "",
    "## Research notes",
    "Each note tests a common way of using an indicator against a QuantsPulse rule, on the same NSE stocks (each year's 300 most traded), July 2019 to 2026, after a 0.5% round-trip cost, with losing trades kept.",
    ...POSTS.map((p) => page(`/blog/${p.slug}`, p.title, p.description)),
    "",
    "## Data and limits",
    "- Results are tested on past prices; they do not promise future returns.",
    "- Prices are Yahoo Finance end-of-day data (personal, non-commercial terms).",
    "- Holdings, watchlists, alerts and AI keys are private to each user, even from their firm's admins and from QuantsPulse staff.",
    "",
    "## Legal",
    page("/legal/terms", "Terms", "terms of use."),
    page("/legal/privacy", "Privacy", "privacy policy."),
    "",
  ].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
