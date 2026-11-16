// CLI for the news pipeline:
//   npm run ingest:news              fetch feeds, store new headlines, refresh research
//   npm run ingest:news -- --relink  recompute symbol links for recent headlines
// Uses web/.env.local locally, or env vars in CI (NEXT_PUBLIC_SUPABASE_URL,
// NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY). Never prints secrets.
import { ingestNews, relinkRecentArticles } from "../src/server/privileged/news";

if (process.argv.includes("--relink")) {
  console.log(JSON.stringify(await relinkRecentArticles(), null, 2));
} else {
  const report = await ingestNews({ searchSymbols: Number(process.env.NEWS_SEARCH_SYMBOLS ?? 8) });
  console.log(JSON.stringify(report, null, 2));
  // Shown on the GitHub run's summary: a research timeout hid inside this JSON for a week (9-16 Nov 2026).
  for (const e of report.errors) console.log(`::warning::news ${e.replace(/\s+/g, " ")}`);
  for (const s of report.sources.filter((s) => s.status !== "ok")) console.log(`::warning::feed ${s.code} ${s.status}: ${s.error ?? ""}`);
  // Red when nothing could be fetched or the new headlines could not be saved.
  if (report.sources.every((s) => s.status === "error") || report.errors.some((e) => e.startsWith("store:"))) process.exit(1);
}
