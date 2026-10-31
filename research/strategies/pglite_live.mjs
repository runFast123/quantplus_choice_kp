// Runs every migration (incl. 33) on a fresh in-memory PGlite, loads the read-only copy of live candles,
// runs the weather, Strong trend and grading jobs, and writes what the SQL produced to data/sql_signals.json.
// Usage: node pglite_live.mjs <repo root>   (uses the DB harness's node_modules)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const repo = process.argv[2];
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(repo, "supabase/tests/harness/package.json"));
const { PGlite } = await import(pathToFileURL(require.resolve("@electric-sql/pglite")).href);
const pqPath = join(here, "data", "live_rows.json");
const db = new PGlite();
const read = (p) => readFileSync(p, "utf8");
const adapt = (sql) => sql.replace(/create extension if not exists (pg_cron|pgcrypto);/g, "-- skipped");

await db.exec(read(join(repo, "supabase/tests/harness/supabase_shim.sql")));
const mig = join(repo, "supabase/migrations");
for (const f of readdirSync(mig).filter((f) => f.endsWith(".sql")).sort()) await db.exec(adapt(read(join(mig, f))));

const { symbols, candles } = JSON.parse(read(pqPath));
for (const s of symbols) {
  await db.query(
    "insert into public.market_symbols (symbol, exchange, name, is_active, segment, mcap_rank) values ($1,'NSE',$1,true,$2,$3) on conflict (symbol, exchange) do update set segment = excluded.segment, mcap_rank = excluded.mcap_rank, is_active = true",
    [s.symbol, s.segment, s.mcap_rank ?? null],
  );
}
for (let i = 0; i < candles.length; i += 4000) {
  const part = candles.slice(i, i + 4000);
  const vals = part
    .map((r) => `('${r.symbol.replace(/'/g, "''")}','NSE','1d','${r.ts}',${r.open},${r.high},${r.low},${r.close},${r.volume})`)
    .join(",");
  await db.exec(`insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume) values ${vals}`);
}
console.log("loaded", symbols.length, "symbols,", candles.length, "candles");

let t = Date.now();
const w = await db.query("select private.refresh_market_weather() n");
console.log("weather rows", w.rows[0].n, `${Date.now() - t} ms`);
const ws = await db.query("select state, count(*)::int n from public.market_weather group by 1 order by 1");
console.log("weather states", ws.rows);
const last = await db.query("select day, state, vix from public.market_weather order by day desc limit 1");
console.log("latest", last.rows[0]);

t = Date.now();
const st = await db.query("select private.refresh_strong_trend() n");
console.log("strong trend rows", st.rows[0].n, `${Date.now() - t} ms (all ${symbols.length - 3} symbols in one call)`);
t = Date.now();
const one = await db.query("select private.refresh_strong_trend((select array_agg(symbol) from (select symbol from public.market_symbols where segment = 'equity' order by symbol limit 100) x)) n");
console.log("re-run on 100 symbols adds", one.rows[0].n, `${Date.now() - t} ms`);

const sig = await db.query(`select symbol, signal_type, (generated_at at time zone 'Asia/Kolkata')::date::text as day,
  payload->>'stop' as stop, payload->>'result' as result, payload->>'pnl_pct' as pnl from public.trading_signals
  where strategy = 'strong_trend' order by symbol, generated_at`);
writeFileSync(join(here, "data", "sql_signals.json"), JSON.stringify(sig.rows));

t = Date.now();
const dips = await db.query("select private.refresh_dip_rules() n");
console.log("dip rule rows", dips.rows[0].n, `${Date.now() - t} ms`);
const dsig = await db.query(`select symbol, strategy, signal_type, (generated_at at time zone 'Asia/Kolkata')::date::text as day,
  payload->>'signal_day' as signal_day, payload->>'fill' as fill, payload->>'exit_price' as exit_price, payload->>'result' as result
  from public.trading_signals where strategy in ('rsi_dip', 'kk_dip') order by symbol, generated_at`);
writeFileSync(join(here, "data", "sql_dip_signals.json"), JSON.stringify(dsig.rows));
const watch = await db.query("select symbol, strategy, signal_day::text, limit_price from public.signal_watch order by 1, 2");
console.log("dip-buy levels for the next session", watch.rows.length);

t = Date.now();
const g = await db.query("select private.grade_signals(null, null) n");
console.log("graded", g.rows[0].n, `${Date.now() - t} ms`);
const sc = await db.query("select * from public.strategy_scorecard where period = 'all'");
console.log("scorecard", sc.rows);
