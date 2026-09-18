/**
 * Signing in, and who a request is. Two ways to prove it:
 *
 * - a **session cookie**, for the browser: a random token, stored hashed, valid for SESSION_DAYS
 * - an **API key** (`X-Api-Key`), for the extension and the desktop app: shown once, stored hashed
 *
 * Neither secret is recoverable from the database. Passwords go through Bun.password (argon2id).
 */
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { childLogger } from "@/lib/logger";
import {
  ApiKeyStore,
  CredentialStore,
  MfaChallengeStore,
  RecoveryCodeStore,
  SessionStore,
  TotpDeviceStore,
  UserStore,
  normaliseUsername,
} from "@/stores/user-store";
import { newRecoveryCodes, verifyTotp } from "@/services/totp";
import type { User, UserRole } from "@/db/schema";

const log = childLogger("auth");

export const SESSION_COOKIE = "web_ocr_session";
export const SESSION_DAYS = 30;
/** Keys are recognisable in logs and settings screens, and easy to search for if one leaks. */
const KEY_PREFIX = "wo_";

/** Who is making a request, and how they proved it. */
export interface Principal {
  user: User;
  via: "session" | "api-key";
  /** The key's id, so its last-used stamp can be updated. */
  apiKeyId?: number;
}

/** What a role is allowed to do; each role includes the ones below it. */
const RANK: Record<UserRole, number> = { reader: 1, contributor: 2, admin: 3 };

export const hasRole = (user: User, required: UserRole): boolean =>
  (RANK[user.role as UserRole] ?? 0) >= RANK[required];

export const hashPassword = (password: string): Promise<string> => Bun.password.hash(password);

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    // A hash this build can't read (corrupt row, or written by another algorithm) is not a match
    return false;
  }
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const randomToken = (): string => randomBytes(32).toString("base64url");

/** Constant-time compare of two hex digests, so a key can't be guessed from how long a check takes. */
function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

// ── Sessions ─────────────────────────────────────────────────────────────────

/** Starts a session and returns the cookie's token; only its hash is stored. */
export async function startSession(userId: number, userAgent: string | null): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await SessionStore.create(sha256(token), userId, expiresAt.toISOString(), userAgent);
  return { token, expiresAt };
}

export async function endSession(token: string): Promise<void> {
  await SessionStore.delete(sha256(token));
}

/** The account behind a session cookie, or null when it is unknown, expired or suspended. */
export async function userForSession(token: string): Promise<User | null> {
  const session = await SessionStore.find(sha256(token));
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await SessionStore.delete(session.tokenHash);
    return null;
  }
  const user = await UserStore.findById(session.userId);
  if (!user || user.disabledAt) return null;
  await SessionStore.touch(session.tokenHash);
  return user;
}

// ── API keys ─────────────────────────────────────────────────────────────────

/** Creates a key for a user. The plain key is returned once and never stored. */
export async function createApiKey(userId: number, name: string): Promise<{ key: string; id: number; prefix: string }> {
  const key = `${KEY_PREFIX}${randomToken()}`;
  const prefix = key.slice(0, KEY_PREFIX.length + 6);
  const record = await ApiKeyStore.create({ userId, name, prefix, keyHash: sha256(key) });
  log.info({ userId, keyId: record.id, prefix }, "API key created");
  return { key, id: record.id, prefix };
}

/** The account behind an `X-Api-Key` header, or null when the key is unknown, revoked or suspended. */
export async function userForApiKey(key: string): Promise<{ user: User; apiKeyId: number } | null> {
  const digest = sha256(key);
  const record = await ApiKeyStore.findByHash(digest);
  if (!record || record.revokedAt || !sameDigest(record.keyHash, digest)) return null;
  const user = await UserStore.findById(record.userId);
  if (!user || user.disabledAt) return null;
  return { user, apiKeyId: record.id };
}

// ── Sign-in ──────────────────────────────────────────────────────────────────

/** Checks a username and password. Returns null for every kind of failure, so none can be told apart. */
export async function authenticate(username: string, password: string): Promise<User | null> {
  const user = await UserStore.findByUsername(normaliseUsername(username));
  if (!user) {
    // Spend the same work as a real check, so a missing account doesn't answer faster than a wrong password
    await verifyPassword(password, "$argon2id$v=19$m=65536,t=2,p=1$aaaaaaaaaaaaaaaa$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    return null;
  }
  if (user.disabledAt) return null;
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  return user;
}

/** Whether the server still has no accounts, which is what opens the setup route. */
export const needsSetup = async (): Promise<boolean> => (await UserStore.count()) === 0;

// ── Second factor ────────────────────────────────────────────────────────────

/** How long the gap between password and second factor may stay open. */
const MFA_CHALLENGE_MINUTES = 5;

/** Which second factors an account has set up. Empty means the password is enough. */
export async function secondFactors(user: User): Promise<("totp" | "passkey")[]> {
  const factors: ("totp" | "passkey")[] = [];
  if ((await TotpDeviceStore.listConfirmed(user.id)).length > 0) factors.push("totp");
  if ((await CredentialStore.listByUser(user.id)).length > 0) factors.push("passkey");
  return factors;
}

/** Opens the gap between a correct password and a session. The token is only good for the second step. */
export async function startMfaChallenge(userId: number, userAgent: string | null): Promise<string> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + MFA_CHALLENGE_MINUTES * 60 * 1000);
  await MfaChallengeStore.create(sha256(token), userId, expiresAt.toISOString(), userAgent);
  return token;
}

/** The account waiting on a second factor, or null when the challenge is unknown or has run out. */
export async function pendingUser(token: string): Promise<{ user: User; tokenHash: string; webauthnChallenge: string | null } | null> {
  const tokenHash = sha256(token);
  const challenge = await MfaChallengeStore.find(tokenHash);
  if (!challenge) return null;
  if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
    await MfaChallengeStore.delete(tokenHash);
    return null;
  }
  const user = await UserStore.findById(challenge.userId);
  if (!user || user.disabledAt) return null;
  return { user, tokenHash, webauthnChallenge: challenge.webauthnChallenge };
}

/**
 * Checks a code against every authenticator the account has enrolled: any of them signs in, and the one that matched
 * gets its last-used stamp, so a device that has stopped being used is visible on the account page.
 */
export async function checkTotp(user: User, code: string): Promise<boolean> {
  for (const device of await TotpDeviceStore.listConfirmed(user.id)) {
    if (verifyTotp(device.secret, code)) {
      await TotpDeviceStore.touch(device.id);
      return true;
    }
  }
  return false;
}

/** Spends a recovery code. Each one works once, and the codes are stored hashed like everything else. */
export async function useRecoveryCode(userId: number, code: string): Promise<boolean> {
  const typed = code.trim();
  if (!typed) return false;
  const digest = sha256(typed);
  for (const stored of await RecoveryCodeStore.listUnused(userId)) {
    if (sameDigest(stored.codeHash, digest)) return RecoveryCodeStore.consume(stored.id);
  }
  return false;
}

/** Ten fresh codes: the plain list is returned once, only the hashes are kept. */
export async function issueRecoveryCodes(userId: number): Promise<string[]> {
  const codes = newRecoveryCodes();
  await RecoveryCodeStore.replace(userId, codes.map(sha256));
  return codes;
}

/**
 * Removes one authenticator. The recovery codes stay while another device is still enrolled; with the last one gone
 * they mean nothing, so they go too.
 */
export async function removeTotpDevice(userId: number, deviceId: number): Promise<boolean> {
  if (!(await TotpDeviceStore.delete(deviceId, userId))) return false;
  if ((await TotpDeviceStore.listConfirmed(userId)).length === 0) await RecoveryCodeStore.clear(userId);
  return true;
}

/** Ends a challenge once it has been used, so a token can't be spent twice. */
export const endMfaChallenge = (tokenHash: string): Promise<void> => MfaChallengeStore.delete(tokenHash);

export { sha256 as hashSecret };
