// Read-only freshness report of the live database: latest prices, quotes, signals, grades, research, news and the
// pg_cron jobs. Usage: node freshness.mjs   (credentials from supabase/.env, never printed)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const url =
  process.env.SUPABASE_DB_URL ?? readFileSync(join(here, "..", ".env"), "utf8").match(/^SUPABASE_DB_URL=(.+)$/m)?.[1]?.trim();
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql) => {
  try {
    const { rows } = await c.query(sql);
    console.log(`\n${label}`);
    console.table(rows);
  } catch (e) {
    console.log(`\n${label}: ${e.message}`);
  }
};
await c.query("set transaction read only");
await q("latest daily candle, by segment (IST date) and how many active symbols are on it",
  `with last as (select s.segment, s.symbol, max(c.ts) ts from public.market_symbols s
                   join public.market_candles c on c.symbol = s.symbol and c.exchange = s.exchange and c.interval = '1d'
                  where s.is_active group by 1, 2)
   select segment, (max(ts) at time zone 'Asia/Kolkata')::date latest, count(*) symbols,
          count(*) filter (where ts = (select max(ts) from last)) on_latest,
          count(*) filter (where ts < (select max(ts) from last) - interval '5 days') older_than_5d
   from last group by 1 order by 1`);
await q("quotes", `select (max(as_of) at time zone 'Asia/Kolkata')::date latest_quote, max(updated_at) refreshed,
                          count(*) filter (where as_of < (select max(as_of) from public.market_quotes) - interval '5 days') stale_5d
                   from public.market_quotes`);
await q("signals by rule: latest signal and latest grade",
  `select t.strategy, count(*) signals, (max(t.generated_at) at time zone 'Asia/Kolkata')::date latest_signal,
          (select max(graded_at) from public.signal_outcomes o where o.strategy = t.strategy) last_graded
   from public.trading_signals t group by 1 order by 1`);
await q("weather", `select day, state, round(nifty, 1) nifty, round(nifty_sma200, 1) sma200, vix from public.market_weather order by day desc limit 1`);
await q("research notes and news", `select (select max(as_of) from public.research_notes) research_as_of,
                                          (select max(generated_at) from public.research_notes) research_built,
                                          (select max(published_at) from public.news_articles) newest_article,
                                          (select max(fetched_at) from public.news_articles) last_ingest`);
await q("pg_cron jobs", `select jobname, schedule, active from cron.job order by jobname`);
await q("pg_cron last runs", `select distinct on (j.jobname) j.jobname, d.status, d.start_time
                               from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                               order by j.jobname, d.start_time desc`);
await c.end();
