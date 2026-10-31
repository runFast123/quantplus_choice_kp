// Times each step of svc_refresh_market_analytics for one pipeline-sized batch on the live database, inside a
// transaction that is rolled back (nothing is kept). Usage: node time-analytics.mjs [batch size] [offset]
// Credentials come from supabase/.env (gitignored) and are never printed.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const url =
  process.env.SUPABASE_DB_URL ?? readFileSync(join(here, "..", ".env"), "utf8").match(/^SUPABASE_DB_URL=(.+)$/m)?.[1]?.trim();
const size = Number(process.argv[2] ?? 100);
const offsets = (process.argv[3] ?? "0").split(",").map(Number);
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
for (const offset of offsets) {
const { rows } = await c.query(
  "select array_agg(symbol order by symbol) s from (select symbol from public.market_symbols where is_active order by symbol limit $1 offset $2) x",
  [size, offset],
);
const syms = rows[0].s;
const top = (await c.query("select count(*)::int n from public.market_symbols where symbol = any($1) and mcap_rank <= 500 and segment = 'equity'", [syms])).rows[0].n;
console.log(`offset ${offset}: ${syms.length} symbols from ${syms[0]} (${top} in the top 500)`);
const steps = [
  ["refresh_market_analytics(15)", "select private.refresh_market_analytics(15, $1)"],
  ["refresh_setups", "select private.refresh_setups($1)"],
  ["refresh_market_weather", "select private.refresh_market_weather()"],
  ["refresh_strong_trend", "select private.refresh_strong_trend($1)"],
  ["refresh_dip_rules", "select private.refresh_dip_rules($1)"],
  ["grade_signals", "select private.grade_signals($1)"],
];
await c.query("begin");
const times = [];
for (const [label, sql] of steps) {
  const t = Date.now();
  await c.query(sql, sql.includes("$1") ? [syms] : []);
  times.push(`${label.split("(")[0]} ${Date.now() - t}`);
}
await c.query("rollback");
console.log("   " + times.join(" · ") + " ms");
}
await c.end();
