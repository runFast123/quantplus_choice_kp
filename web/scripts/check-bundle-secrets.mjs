// Runs after `next build`: fails if any server-only secret value appears in
// files shipped to browsers (.next/static). NEXT_PUBLIC_* values are public by
// design and are skipped. Values are never printed.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const secrets = [];
const collect = (file) => {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/)?.map((x, i) => (i === 2 ? x.trim().replace(/^(["'])(.*)\1$/, "$2") : x));
    if (!m || m[1].startsWith("NEXT_PUBLIC_")) continue;
    const v = m[2].trim();
    if (v.length >= 12 && !v.startsWith("<")) secrets.push([m[1], v]);
    const pw = v.match(/:\/\/[^:]+:([^@]+)@/)?.[1];
    if (pw) { secrets.push([`${m[1]} password`, pw]); try { secrets.push([`${m[1]} password`, decodeURIComponent(pw)]); } catch {} }
  }
};
collect(".env.local");
collect(".env.production");
collect("../supabase/.env");
for (const [k, v] of Object.entries(process.env)) {
  if (!k.startsWith("NEXT_PUBLIC_") && /KEY|SECRET|TOKEN|PASSWORD|DB_URL/.test(k) && v && v.length >= 12) secrets.push([k, v]);
}

// Client JS/CSS, plus prerendered HTML/RSC payloads that are sent to browsers.
const roots = [".next/static", ".next/server/app"];
const leaks = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.includes(join(".next", "static")) ? /\.(js|css|html|json|map|txt)$/.test(name) : /\.(html|rsc|txt|body|meta)$/.test(name)) {
      const text = readFileSync(p, "utf8");
      for (const [label, v] of secrets) if (text.includes(v)) leaks.push(`${p}: ${label}`);
    }
  }
};
for (const r of roots) if (existsSync(r)) walk(r);

if (leaks.length) {
  console.error("✖ Server-only secrets found in the browser bundle:\n  " + [...new Set(leaks)].join("\n  "));
  process.exit(1);
}
console.log(`✔ bundle secret check clean (${secrets.length} server-only values checked against .next/static + prerendered pages)`);
