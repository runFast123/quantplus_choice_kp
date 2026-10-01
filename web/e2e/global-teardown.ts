import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { deleteE2eTenants, deleteUser } from "./helpers/admin";
import { AUTH_DIR } from "./helpers/env";

/** Deletes every user and organisation the run created, plus saved sessions. */
export default async function globalTeardown() {
  const file = join(AUTH_DIR, "state.json");
  if (existsSync(join(AUTH_DIR, "extra-users.json"))) {
    for (const id of JSON.parse(readFileSync(join(AUTH_DIR, "extra-users.json"), "utf8")) as string[]) await deleteUser(id);
  }
  await deleteE2eTenants();
  if (existsSync(file)) {
    const s = JSON.parse(readFileSync(file, "utf8"));
    for (const u of Object.values(s.users) as { id: string }[]) await deleteUser(u.id);
  }
  rmSync(AUTH_DIR, { recursive: true, force: true });
}
