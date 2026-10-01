import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createUser, type TestUser } from "./admin";
import { AUTH_DIR } from "./env";

/** Creates a one-off user and registers it for teardown. */
export async function oneOffUser(label: string, plan: "basic" | "pro", consents?: string[], opts?: { confirmed?: boolean }): Promise<TestUser> {
  const u = await createUser(label, plan, consents, opts);
  const f = join(AUTH_DIR, "extra-users.json");
  const ids: string[] = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : [];
  ids.push(u.id);
  writeFileSync(f, JSON.stringify(ids));
  return u;
}
