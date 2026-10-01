import "server-only";

import { createHash } from "node:crypto";

/** Only the SHA-256 of the random per-browser id is ever stored. */
export function deviceHash(deviceId: string): string {
  return createHash("sha256").update(deviceId).digest("hex");
}
