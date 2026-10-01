import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for BYOK AI keys (spec §4). The key lives in
 * the environment / a secret manager — never in the database — so a DB dump
 * alone exposes nothing usable. `key_version` supports rotation:
 * QP_SECRETS_KEY_V<n> holds each version, QP_SECRETS_KEY_CURRENT picks the one
 * used for new writes; old versions stay readable until re-encrypted.
 */
export type Sealed = { ciphertext: string; iv: string; auth_tag: string; key_version: number };

function keyFor(version: number): Buffer {
  const raw = process.env[`QP_SECRETS_KEY_V${version}`];
  if (!raw) throw new Error(`Encryption key version ${version} is not configured`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`QP_SECRETS_KEY_V${version} must be 32 bytes (base64)`);
  return key;
}

function currentVersion(): number {
  return Number(process.env.QP_SECRETS_KEY_CURRENT ?? "1");
}

/** `aad` binds the ciphertext to its row so it can't be swapped onto another record. */
export function seal(plaintext: string, aad: string): Sealed {
  const version = currentVersion();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(version), iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    key_version: version,
  };
}

export function open(sealed: Sealed, aad: string): string {
  const decipher = createDecipheriv("aes-256-gcm", keyFor(sealed.key_version), Buffer.from(sealed.iv, "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(sealed.auth_tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
