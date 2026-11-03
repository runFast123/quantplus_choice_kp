// Runs every migration (incl. 41) on a fresh in-memory PGlite, loads the read-only copy of live candles, runs the
// 200-day trend rule and writes what the SQL produced to data/sql_ma200_signals.json, for the comparison with
// record_lr.py --live (data/expected_ma200_signals.csv).
// Usage: node pglite_ma200.mjs <repo root>   (uses the DB harness's node_modules)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const repo = process.argv[2];
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(repo, "supabase/tests/harness/package.json"));
const { PGlite } = await import(pathToFileURL(require.resolve("@electric-sql/pglite")).href);
const db = new PGlite();
const read = (p) => readFileSync(p, "utf8");
const adapt = (sql) => sql.replace(/create extension if not exists (pg_cron|pgcrypto);/g, "-- skipped");

await db.exec(read(join(repo, "supabase/tests/harness/supabase_shim.sql")));
const mig = join(repo, "supabase/migrations");
for (const f of readdirSync(mig).filter((f) => f.endsWith(".sql")).sort()) await db.exec(adapt(read(join(mig, f))));

const { symbols, candles } = JSON.parse(read(join(here, "data", "live_rows.json")));
for (const s of symbols) {
  await db.query(
    "insert into public.market_symbols (symbol, exchange, name, is_active, segment, mcap_rank) values ($1,'NSE',$1,true,$2,$3) on conflict (symbol, exchange) do update set segment = excluded.segment, mcap_rank = excluded.mcap_rank, is_active = true",
    [s.symbol, s.segment, s.mcap_rank ?? null],
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

const t = Date.now();
const n = await db.query("select private.refresh_ma200_trend() n");
console.log("ma200 trend rows", n.rows[0].n, `${Date.now() - t} ms`);
const sig = await db.query(`select symbol, signal_type, (generated_at at time zone 'Asia/Kolkata')::date::text as day,
  payload->>'stop' as stop, payload->>'result' as result from public.trading_signals where strategy = 'ma200_trend'
  order by symbol, generated_at`);
writeFileSync(join(here, "data", "sql_ma200_signals.json"), JSON.stringify(sig.rows));
