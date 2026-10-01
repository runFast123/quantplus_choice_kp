// Applies the shim, every migration, the dev seed and each tests/*.sql file
// to a fresh in-memory PGlite database. Exits non-zero on the first failure.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const read = (p) => readFileSync(p, "utf8");

// PGlite ships neither pg_cron nor pgcrypto as loadable here; the shim stubs cron.*
// and gen_random_uuid() is core Postgres.
const adapt = (sql) =>
  sql.replace(/create extension if not exists (pg_cron|pgcrypto);/g, "-- [harness] skipped: $&");

const db = new PGlite();
const run = async (label, sql) => {
  try {
    await db.exec(sql);
    console.log(`ok    ${label}`);
  } catch (e) {
    console.error(`FAIL  ${label}\n      ${e.message}${e.where ? `\n      at ${e.where}` : ""}`);
    process.exit(1);
  }
};

await run("supabase shim", read(join(here, "supabase_shim.sql")));
const migDir = join(root, "migrations");
for (const f of readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
  await run(`migration ${f}`, adapt(read(join(migDir, f))));
}
for (const f of readdirSync(join(root, "seed")).filter((f) => f.endsWith(".sql")).sort()) {
  await run(`seed ${f}`, read(join(root, "seed", f)));
}

const counts = await db.query(`
  select (select count(*) from public.market_symbols) symbols,
         (select count(*) from public.market_candles) candles,
         (select count(*) from public.trading_signals) signals,
         (select count(*) from public.rsi_events) rsi,
         (select count(*) from public.backtest_ledgers) ledgers`);
console.log("      seed rows:", counts.rows[0]);

const testDir = join(root, "tests");
for (const f of readdirSync(testDir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()) {
  // Capture NOTICEs (PASS lines) for this file
  const lines = [];
  await db.exec("set client_min_messages = notice").catch(() => {});
  try {
    await db.exec(read(join(testDir, f)), { onNotice: (n) => lines.push(n.message) });
  } catch (e) {
    console.error(`FAIL  test ${f}\n      ${e.message}`);
    lines.forEach((l) => console.error("      " + l));
    await db.exec("rollback").catch(() => {});
    process.exit(1);
  }
  console.log(`ok    test ${f}`);
  lines.forEach((l) => console.log("      " + l));
}
