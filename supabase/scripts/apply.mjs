// Applies migrations / seeds / tests to the Supabase project over the session pooler.
//
//   node apply.mjs status     list applied vs pending migrations
//   node apply.mjs migrate    apply pending migrations, each in its own transaction
//   node apply.mjs seed ref   run supabase/seed/ref_*.sql (reference data — safe for production)
//   node apply.mjs seed dev   run every seed incl. dev_*.sql (SYNTHETIC prices — dev/staging only)
//   node apply.mjs test       run supabase/tests/NN_*.sql (each rolls itself back)
//
// Credentials come from supabase/.env (gitignored) and are never printed.
// Applied versions are recorded in supabase_migrations.schema_migrations — the
// same table the Supabase CLI uses — so `supabase db push` stays compatible.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function dbUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  try {
    const env = readFileSync(join(root, ".env"), "utf8");
    const m = env.match(/^SUPABASE_DB_URL=(.+)$/m);
    if (m) return m[1].trim();
  } catch {}
  console.error("SUPABASE_DB_URL not set. Copy supabase/.env.example to supabase/.env.");
  process.exit(1);
}

const redact = (s) => String(s).replace(/postgres(ql)?:\/\/[^@\s]+@/g, "postgresql://***@");

async function connect() {
  const client = new pg.Client({ connectionString: dbUrl(), ssl: { rejectUnauthorized: false }, statement_timeout: 600000 });
  await client.connect();
  return client;
}

async function ensureHistory(c) {
  await c.query(`create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
}

function migrationFiles() {
  return readdirSync(join(root, "migrations"))
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ file: f, version: f.split("_")[0], name: f.replace(/^\d+_/, "").replace(/\.sql$/, "") }));
}

async function applied(c) {
  const { rows } = await c.query("select version from supabase_migrations.schema_migrations");
  return new Set(rows.map((r) => r.version));
}

const cmd = process.argv[2] ?? "status";
const c = await connect();
try {
  if (cmd === "status" || cmd === "migrate") {
    await ensureHistory(c);
    const done = await applied(c);
    const files = migrationFiles();
    for (const m of files) {
      if (done.has(m.version)) {
        console.log(`applied  ${m.file}`);
        continue;
      }
      if (cmd === "status") {
        console.log(`PENDING  ${m.file}`);
        continue;
      }
      const sql = readFileSync(join(root, "migrations", m.file), "utf8");
      try {
        await c.query("begin");
        await c.query(sql);
        await c.query("insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)", [m.version, m.name, [sql]]);
        await c.query("commit");
        console.log(`ok       ${m.file}`);
      } catch (e) {
        await c.query("rollback").catch(() => {});
        console.error(`FAILED   ${m.file}\n         ${redact(e.message)}${e.where ? `\n         at ${e.where}` : ""}`);
        process.exitCode = 1;
        break;
      }
    }
  } else if (cmd === "seed") {
    const mode = process.argv[3];
    if (mode !== "ref" && mode !== "dev") throw new Error("usage: node apply.mjs seed ref|dev");
    const files = readdirSync(join(root, "seed")).filter((f) => f.endsWith(".sql") && (mode === "dev" || f.startsWith("ref_")));
    for (const f of files.sort()) {
      await c.query(readFileSync(join(root, "seed", f), "utf8"));
      console.log(`seeded   ${f}`);
    }
  } else if (cmd === "test") {
    for (const f of readdirSync(join(root, "tests")).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()) {
      const notices = [];
      const onNotice = (n) => notices.push(n.message);
      c.on("notice", onNotice);
      try {
        await c.query(readFileSync(join(root, "tests", f), "utf8"));
        console.log(`ok       ${f}`);
        notices.forEach((n) => console.log(`         ${n}`));
      } catch (e) {
        await c.query("rollback").catch(() => {});
        console.error(`FAILED   ${f}\n         ${redact(e.message)}`);
        notices.forEach((n) => console.error(`         ${n}`));
        process.exitCode = 1;
      } finally {
        c.off("notice", onNotice);
      }
    }
  } else {
    console.error(`unknown command ${cmd}`);
    process.exitCode = 1;
  }
} finally {
  await c.end();
}
