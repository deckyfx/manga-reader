/**
 * Time-based one-time passwords (RFC 6238) and the recovery codes that go with them.
 *
 * Small enough to own: HMAC-SHA1 over a 30-second counter, truncated to six digits, which is what every
 * authenticator app implements. No dependency, and nothing here is secret beyond the shared key itself.
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const DIGITS = 6;
const PERIOD_SECONDS = 30;
/** How many steps either side of now still count, covering clocks that drift by a few seconds. */
const WINDOW = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, which is what authenticator apps expect a secret in. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 20-byte secret (the RFC's recommendation for SHA-1), in base32. */
export const newTotpSecret = (): string => base32Encode(randomBytes(20));

/** The code for one time step. */
function codeFor(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  // Dynamic truncation: the low nibble of the last byte picks where to read the 31-bit value from
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = ((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS).toString();
  return binary.padStart(DIGITS, "0");
}

/** The code an app would be showing right now, for tests and for a "does this match?" hint. */
export const currentTotp = (secret: string, at: Date = new Date()): string =>
  codeFor(secret, Math.floor(at.getTime() / 1000 / PERIOD_SECONDS));

/**
 * The time step a typed code belongs to, or null when it matches none. One step of clock drift either way is
 * allowed. The step is the caller's business: remembering the last one accepted is what stops the same code being
 * used twice inside its 30 seconds.
 */
export function matchTotpStep(secret: string, code: string, at: Date = new Date()): number | null {
  const typed = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(typed)) return null;
  const now = Math.floor(at.getTime() / 1000 / PERIOD_SECONDS);
  for (let drift = -WINDOW; drift <= WINDOW; drift++) {
    const step = now + drift;
    const expected = codeFor(secret, step);
    // Constant-time: a timing difference would say how many leading digits were right
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(typed))) return step;
  }
  return null;
}

/** Whether a typed code matches at all — for enrolment, where there is no replay to worry about yet. */
export const verifyTotp = (secret: string, code: string, at: Date = new Date()): boolean =>
  matchTotpStep(secret, code, at) !== null;

/** The `otpauth://` URI an authenticator app scans. */
export function otpauthUri(secret: string, account: string, issuer = "web-ocr"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Single-use codes, in two groups so they can be read aloud and typed.
 *
 * The alphabet leaves out I, L, O, U and 0/1 — the characters people mistype from paper — and ten of them carry
 * about 50 bits, rather than the ~33 that ten decimal digits would. Guessing one has to go through the server.
 */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newRecoveryCodes(count = 10): string[] {
  const draw = (length: number) => Array.from({ length }, () => CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]).join("");
  return Array.from({ length: count }, () => `${draw(5)}-${draw(5)}`);
}
