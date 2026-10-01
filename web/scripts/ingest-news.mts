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
  if (report.sources.every((s) => s.status === "error")) process.exit(1);
}
