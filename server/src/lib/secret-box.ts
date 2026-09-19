/**
 * Encryption at rest for the one secret that can't be hashed.
 *
 * Passwords are argon2id, session tokens and API keys are SHA-256 — none of them need to be read back. A TOTP secret
 * does: the server has to recompute the same code as the phone. So it is sealed with AES-256-GCM instead, which means
 * a stolen `ocr.db` (a backup, a synced folder, a pasted file) is not enough to clone somebody's authenticator.
 *
 * The key comes from `SECRET_KEY`, or from `data/secret.key`, which is created on first use. Lose it and the sealed
 * secrets are gone: those accounts have to enrol their authenticators again. Passwords and passkeys are unaffected.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "@/env";
import { childLogger } from "@/lib/logger";

const log = childLogger("secrets");

/** Sealed values carry their version, so the format can change without guessing at the old one. */
const PREFIX = "v1";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;

let cached: Buffer | null = null;

function loadKey(): Buffer {
  if (cached) return cached;

  const configured = env.SECRET_KEY;
  if (configured) {
    const key = Buffer.from(configured, "base64");
    if (key.length !== KEY_BYTES) throw new Error(`SECRET_KEY must be ${KEY_BYTES} bytes of base64`);
    cached = key;
    return key;
  }

  const file = env.SECRET_KEY_FILE;
  if (existsSync(file)) {
    const key = Buffer.from(readFileSync(file, "utf8").trim(), "base64");
    if (key.length !== KEY_BYTES) throw new Error(`${file} doesn't hold a ${KEY_BYTES}-byte base64 key`);
    cached = key;
    return key;
  }

  // First run: make one and keep it beside the database, readable only by this user
  const key = randomBytes(KEY_BYTES);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, key.toString("base64"), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Some file systems don't do modes; the key is still only as exposed as the database beside it
  }
  log.warn({ file }, "Wrote a new encryption key. Back it up with the database — without it, enrolled authenticators stop working");
  cached = key;
  return key;
}

/** Seals a value for storage. */
export function seal(plain: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", loadKey(), nonce);
  const sealed = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [PREFIX, nonce.toString("base64url"), sealed.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(":");
}

/**
 * Opens a sealed value. Anything without the marker is returned as it is: rows written before this existed are
 * plaintext, and they re-seal the next time they're written.
 */
export function open(stored: string): string {
  if (!stored.startsWith(`${PREFIX}:`)) return stored;
  const [, nonce, payload, tag] = stored.split(":");
  if (!nonce || !payload || !tag) throw new Error("this sealed value is malformed");
  const decipher = createDecipheriv("aes-256-gcm", loadKey(), Buffer.from(nonce, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]).toString("utf8");
}

/** Whether a stored value has been sealed, for tests and for deciding whether a row needs rewriting. */
export const isSealed = (stored: string): boolean => stored.startsWith(`${PREFIX}:`);
