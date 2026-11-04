// Rebuilds the five rules' signals on everything stored (ADR-041), after a history back-fill:
//   1. rank every stored session (market leaders) and the market weather for every day
//   2. per batch of the 500 largest companies: the analytics on the whole history, then private.rebuild_rule_signals
//      (delete the five rules' signals, run every rule again, the latest signal, the grades) — one transaction per
//      batch, so a failure leaves that batch as it was
//   3. the signal checks (breadth, Strong trend and RSI dip tags) and a year of weekly rule health
// Usage: node rebuild-rules.mjs [--dry-run] [--symbols A,B]. --dry-run runs one batch inside a transaction and rolls
// it back, printing what it would change. Credentials come from supabase/.env (gitignored) and are never printed.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const url =
  process.env.SUPABASE_DB_URL ?? readFileSync(join(here, "..", ".env"), "utf8").match(/^SUPABASE_DB_URL=(.+)$/m)?.[1]?.trim();
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const only = args.includes("--symbols") ? args[args.indexOf("--symbols") + 1].split(",") : null;
const BATCH = 20;

const redact = (s) => String(s).replace(/postgres(ql)?:\/\/[^@\s]+@/g, "postgresql://***@");
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, statement_timeout: 900000 });
await c.connect();
const t0 = Date.now();
const step = async (label, sql, params) => {
  const t = Date.now();
  const r = await c.query(sql, params);
  console.log(`${label}: ${JSON.stringify(r.rows[0] ?? {})} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  return r.rows[0];
};
const counts = (symbols) =>
  c.query(
    `select strategy, count(*)::int n, min(generated_at)::date first from public.trading_signals
      where strategy in (select strategy from public.rule_expectations) and symbol = any($1) group by 1 order by 1`,
    [symbols],
  );

try {
  const { rows } = await c.query(
    `select array_agg(symbol order by symbol) s from public.market_symbols
      where is_active and segment = 'equity' and mcap_rank <= 500 and ($1::text[] is null or symbol = any($1))`,
    [only],
  );
  const symbols = rows[0].s ?? [];
  console.log(`rebuild: ${symbols.length} stocks${dry ? " (dry run: first batch, rolled back)" : ""}`);
  console.log("before:", (await counts(dry ? symbols.slice(0, BATCH) : symbols)).rows);

  if (dry) await c.query("begin");
  await step("leaders", "select private.refresh_leaders(true) n");
  await step("weather", "select private.refresh_market_weather(true) n");
  for (let i = 0; i < symbols.length; i += BATCH) {
    const part = symbols.slice(i, i + BATCH);
    if (!dry) await c.query("begin");
    const label = `batch ${i / BATCH + 1}/${Math.ceil(symbols.length / BATCH)} (${part[0]}…)`;
    // RSI history, the SIP ledger and the quote on the whole stored history (the pipeline's 8 s calls can time out).
    await step(`${label} analytics`, "select private.refresh_market_analytics(1300, $1) r", [part]);
    await step(`${label} rules`, "select private.rebuild_rule_signals($1) r", [part]);
    if (!dry) await c.query("commit");
    if (dry) break;
  }
  if (!dry) {
    await step("signal checks", "select public.svc_refresh_signal_checks(true) r");
    await step("rule health history", `select count(private.refresh_rule_health(d::date)) n from generate_series(
      (now() at time zone 'Asia/Kolkata')::date - 364, (now() at time zone 'Asia/Kolkata')::date, interval '7 days') d`);
    await step("rule health today", "select private.refresh_rule_health() n");
  }
  console.log(dry ? "after (first batch only):" : "after:", (await counts(dry ? symbols.slice(0, BATCH) : symbols)).rows);
  if (dry) await c.query("rollback");
  console.log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("rebuild failed:", redact(e.message));
  process.exitCode = 1;
} finally {
  await c.end();
}
