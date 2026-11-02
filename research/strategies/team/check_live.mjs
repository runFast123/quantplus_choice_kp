// Cross-check of migration 39 on a read-only copy of the live candles (ADR-038). Fresh in-memory PGlite: every
// migration, the live copy (research/strategies/dump_live.py), the rules and grades, then the reference seed, which
// scores every stored signal. Writes ../data/sql_checks.json for check_live.py. Never touches Supabase.
// Usage (from research/strategies/team): node check_live.mjs <repo root>
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const repo = resolve(process.argv[2]);
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(repo, "supabase/tests/harness/package.json"));
const { PGlite } = await import(pathToFileURL(require.resolve("@electric-sql/pglite")).href);
const db = new PGlite();
const read = (p) => readFileSync(p, "utf8");
const adapt = (sql) => sql.replace(/create extension if not exists (pg_cron|pgcrypto);/g, "-- skipped");
const timed = async (label, sql) => {
  const t = Date.now();
  const r = await db.query(sql);
  console.log(label, JSON.stringify(r.rows[0] ?? {}), `${Date.now() - t} ms`);
  return r;
};

await db.exec(read(join(repo, "supabase/tests/harness/supabase_shim.sql")));
const mig = join(repo, "supabase/migrations");
for (const f of readdirSync(mig).filter((f) => f.endsWith(".sql")).sort()) await db.exec(adapt(read(join(mig, f))));

const { symbols, candles } = JSON.parse(read(join(here, "..", "data", "live_rows.json")));
for (const s of symbols) {
  await db.query(
    `insert into public.market_symbols (symbol, exchange, name, is_active, segment, mcap_rank, sector)
     values ($1, 'NSE', $1, true, $2, $3, $4)
     on conflict (symbol, exchange) do update set segment = excluded.segment, mcap_rank = excluded.mcap_rank,
       sector = excluded.sector, is_active = true`,
    [s.symbol, s.segment, s.mcap_rank ?? null, s.sector ?? null],
  );
}
for (let i = 0; i < candles.length; i += 4000) {
  const vals = candles
    .slice(i, i + 4000)
    .map((r) => `('${r.symbol.replace(/'/g, "''")}','NSE','1d','${r.ts}',${r.open},${r.high},${r.low},${r.close},${r.volume})`)
    .join(",");
  await db.exec(`insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume) values ${vals}`);
}
console.log("loaded", symbols.length, "symbols,", candles.length, "candles");

await timed("weather", "select private.refresh_market_weather(true) n");
await timed("strong trend", "select private.refresh_strong_trend() n");
await timed("dips", "select private.refresh_dip_rules() n");
await timed("leaders", "select private.refresh_leaders(true) n");
await timed("sma trend", "select private.refresh_sma_trend() n");
await timed("graded", "select private.grade_signals(null, null) n");

let t = Date.now();
await db.exec(read(join(repo, "supabase/seed/ref_signal_checks.sql")));
console.log("seed + full checks", `${Date.now() - t} ms`);
await timed("daily run (nothing new)", "select public.svc_refresh_signal_checks() r");

const out = {};
out.checks = (await db.query(`select strategy, symbol, signal_day::text, label, score::float8, detail
                               from public.signal_checks order by 1, 3, 2`)).rows;
out.outcomes = (await db.query(`select symbol, signal_day::text, weather, stop::float8, entry_price::float8,
                                       r20::float8, stop_hit_20 from public.signal_outcomes
                                 where strategy = 'strong_trend' order by signal_day, symbol`)).rows;
out.breadth = (await db.query("select day::text, breadth50::float8, breadth200::float8, rsi_setups from public.market_breadth order by 1")).rows;
out.record = (await db.query("select strategy, month::text, label, signals::int, trades::int, made_money::int from public.signal_check_record order by 1, 2, 3")).rows;
out.training = (await db.query("select source, count(*)::int n, max(signal_day)::text last from public.signal_check_training group by 1")).rows;
writeFileSync(join(here, "..", "data", "sql_checks.json"), JSON.stringify(out));
console.log("checks", out.checks.length, "training", JSON.stringify(out.training));
