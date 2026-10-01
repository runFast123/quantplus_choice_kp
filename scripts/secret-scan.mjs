#!/usr/bin/env node
// Blocks secrets from entering git. Used by .githooks/pre-commit and CI.
//   node scripts/secret-scan.mjs --staged     scan what's about to be committed
//   node scripts/secret-scan.mjs --history    scan every commit on this branch
// Two layers: (1) known secret *formats*; (2) the exact secret *values* found
// in the local, gitignored env files (DB_confi, web/.env.local, supabase/.env).
// Values are never printed — only the file and a label.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const FORBIDDEN_PATHS = [/(^|\/)DB_confi$/, /(^|\/)\.env(\.[^/]*)?$/, /(^|\/)\.mcp\.json$/, /(^|\/)settings\.local\.json$/];
const ALLOWED_PATHS = [/\.env\.example$/];

const PATTERNS = [
  ["JWT (Supabase legacy key)", /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{10,}/],
  ["Supabase publishable key", /sb_publishable_[A-Za-z0-9_-]{16,}/],
  ["Postgres URL with password", /postgres(?:ql)?:\/\/[^:\s/@]+:(?!\[YOUR-PASSWORD\]|<)[^@\s]{6,}@/],
  ["21st.dev key", /21st_sk_[A-Za-z0-9]{16,}/],
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI key", /sk-(?:proj-)?[A-Za-z0-9]{32,}/],
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
  ["Encryption key assignment", /QP_SECRETS_KEY_V\d+=[A-Za-z0-9+/=]{40,}/],
  ["Cron secret assignment", /CRON_SECRET=[A-Za-z0-9_-]{30,}/],
];

function localSecretValues() {
  const values = [];
  const take = (label, v) => { v = (v ?? "").trim(); if (v.length >= 12 && !/^</.test(v)) values.push([label, v]); };
  for (const f of ["web/.env.local", "supabase/.env"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.+)$/)?.map((x, i) => (i === 2 ? x.trim().replace(/^(["'])(.*)\1$/, "$2") : x));
      if (!m || m[1] === "NEXT_PUBLIC_SUPABASE_URL" || m[1] === "NEXT_PUBLIC_SITE_URL" || m[1] === "NEXT_PUBLIC_MARKET_DATA_MODE") continue;
      take(`${f}:${m[1]}`, m[2]);
      const pw = m[2].match(/:\/\/[^:]+:([^@]+)@/)?.[1];
      if (pw) { take(`${f}:${m[1]} password`, pw); try { take(`${f}:${m[1]} password`, decodeURIComponent(pw)); } catch {} }
    }
  }
  if (existsSync("DB_confi")) {
    for (const line of readFileSync("DB_confi", "utf8").split(/\r?\n/)) {
      const v = line.replace(/^[^:]*:\s*/, "");
      if (!/^https?:/.test(v)) take("DB_confi value", v.replace(/^postgresql:\/\/.*$/, ""));
    }
  }
  return values;
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const mode = process.argv[2] ?? "--staged";
const values = localSecretValues();
const problems = [];

function scanText(where, text) {
  for (const [label, re] of PATTERNS) if (re.test(text)) problems.push(`${where}: looks like a ${label}`);
  for (const [label, v] of values) if (text.includes(v)) problems.push(`${where}: contains the value of ${label}`);
}

if (mode === "--staged") {
  const files = git("diff", "--cached", "--name-only", "--diff-filter=ACMR").split("\n").filter(Boolean);
  for (const f of files) {
    if (FORBIDDEN_PATHS.some((r) => r.test(f)) && !ALLOWED_PATHS.some((r) => r.test(f))) problems.push(`${f}: this file must never be committed`);
  }
  // Only added lines matter.
  const diff = git("diff", "--cached", "-U0", "--no-color", "--diff-filter=ACMR");
  let file = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) file = line.slice(6);
    else if (line.startsWith("+") && !line.startsWith("+++") && !file.endsWith("scripts/secret-scan.mjs")) scanText(file, line);
  }
} else if (mode === "--history") {
  const log = git("log", "-p", "--no-color", "--all");
  let file = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("+++ b/")) file = line.slice(6);
    else if (line.startsWith("+") && !file.endsWith("scripts/secret-scan.mjs")) scanText(`history:${file}`, line);
  }
}

const unique = [...new Set(problems)];
if (unique.length) {
  console.error("✖ Secret scan failed — nothing was committed:\n  " + unique.join("\n  "));
  console.error("Move the value into a gitignored env file (see docs/SECURITY.md). Bypass is not allowed.");
  process.exit(1);
}
console.log(`✔ secret scan clean (${mode}, ${values.length} local secret values checked)`);
