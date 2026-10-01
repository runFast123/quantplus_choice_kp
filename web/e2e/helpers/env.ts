import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Reads web/.env.local (gitignored) without printing anything. */
export function env(): Record<string, string> {
  const file = join(__dirname, "..", "..", ".env.local");
  const out: Record<string, string> = { ...(process.env as Record<string, string>) };
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) out[m[1]] = m[2];
    }
  }
  return out;
}

export const AUTH_DIR = join(__dirname, "..", ".auth");
