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
import { matchTotpStep, newRecoveryCodes } from "@/services/totp";
import type { User, UserRole } from "@/db/schema";

const log = childLogger("auth");

export const SESSION_COOKIE = "web_ocr_session";
/** What an unauthenticated caller is told, the same for every path: signed out, or not allowed to know. */
export const AUTH_FAILED = "Authorization failed";
export const SESSION_DAYS = 30;
/** Keys are recognisable in logs and settings screens, and easy to search for if one leaks. */
const KEY_PREFIX = "wo_";

/** Who is making a request, and how they proved it. */
export interface Principal {
  user: User;
  via: "session" | "api-key" | "stream-token";
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
  // Always spend the verification, then decide: checking `disabledAt` first would answer a suspended account
  // quicker than a wrong password, which is a way to enumerate them
  const correct = await verifyPassword(password, user.passwordHash);
  if (user.disabledAt || !correct) return null;
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
    const step = matchTotpStep(device.secret, code);
    if (step === null) continue;
    // A code is good once: the step it belongs to has to be newer than the last one this device signed in with,
    // otherwise somebody who saw the screen has 30 seconds to use it again
    if (await TotpDeviceStore.claimStep(device.id, step)) return true;
    log.warn({ userId: user.id, deviceId: device.id }, "An authenticator code was offered twice");
    return false;
  }
  return false;
}

/**
 * Recovery codes are hashed the way passwords are, with argon2id, not with SHA-256 like the session tokens.
 *
 * A session token is 256 random bits — nobody is guessing one from its hash. A recovery code is short enough to
 * type off a piece of paper, so a fast hash would let anyone holding a copy of the database work through the whole
 * space offline. Argon2 makes that pointless; the cost is at most ten verifications on a code that turns out wrong.
 */
const hashRecoveryCode = (code: string): Promise<string> => Bun.password.hash(code.trim().toUpperCase());

/**
 * Issuing ten codes means ten argon2 hashes, and Bun's defaults ask for 64 MiB each. Ten at once is 640 MiB, and two
 * people asking at the same moment is 1.3 GB — on a machine that is also holding ONNX models in memory. So the
 * hashing is sequential, and one issuance (or one recovery-code check) runs at a time across the whole process. Both
 * are rare, so a short wait is the better trade.
 */
let issuing: Promise<unknown> = Promise.resolve();

function queued<T>(work: () => Promise<T>): Promise<T> {
  const result = issuing.then(work, work);
  issuing = result.then(() => {}, () => {});
  return result;
}

/** Spends a recovery code. Each one works once. */
export async function useRecoveryCode(userId: number, code: string): Promise<boolean> {
  const typed = code.trim().toUpperCase();
  if (!typed) return false;
  // Up to ten argon2id checks per attempt: queued like issuing, so concurrent attempts can't stack their memory. The
  // list is read inside the queue, so a set issued meanwhile is the one checked.
  return queued(async () => {
    for (const stored of await RecoveryCodeStore.listUnused(userId)) {
      if (await verifyPassword(typed, stored.codeHash)) return RecoveryCodeStore.consume(stored.id);
    }
    return false;
  });
}

/** Ten fresh codes: the plain list is returned once, only the hashes are kept. */
export function issueRecoveryCodes(userId: number): Promise<string[]> {
  return queued(async () => {
    const codes = newRecoveryCodes();
    const hashes: string[] = [];
    for (const code of codes) hashes.push(await hashRecoveryCode(code));
    await RecoveryCodeStore.replace(userId, hashes);
    return codes;
  });
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

/**
 * Ends a challenge once it has been used. The answer matters: only the request that removed it may go on to make a
 * session, so a challenge can't be turned into two.
 */
export const endMfaChallenge = (tokenHash: string): Promise<boolean> => {
  mfaAttempts.delete(tokenHash);
  return MfaChallengeStore.delete(tokenHash);
};

/** Codes one sign-in challenge may be checked against before it is thrown away and the password is needed again. */
const MAX_MFA_ATTEMPTS = 5;
/** Attempts per open challenge (by token hash), with when the entry can be forgotten. */
const mfaAttempts = new Map<string, { count: number; until: number }>();

/**
 * Takes one attempt from a challenge before a code is checked against it; false (and the challenge ended) once they
 * are used up. Taken before the check rather than after a failure, so parallel requests can't all guess at once. Kept
 * in memory: a challenge lives minutes, and a restart only hands out a fresh few to someone who already has the
 * password.
 */
export async function spendMfaAttempt(tokenHash: string): Promise<boolean> {
  const now = Date.now();
  if (mfaAttempts.size > 1000) {
    for (const [hash, entry] of mfaAttempts) if (entry.until < now) mfaAttempts.delete(hash);
  }
  const entry = mfaAttempts.get(tokenHash) ?? { count: 0, until: now + MFA_CHALLENGE_MINUTES * 60 * 1000 };
  entry.count++;
  mfaAttempts.set(tokenHash, entry);
  if (entry.count <= MAX_MFA_ATTEMPTS) return true;
  // The count stays until it expires, so a request already past the challenge lookup can't start over from zero
  await MfaChallengeStore.delete(tokenHash);
  return false;
}

const accountLocks = new Map<number, Promise<unknown>>();

/**
 * Runs `task` after every earlier one for the same account settles. Changes to an account's second factors (start an
 * enrolment, confirm the first device and issue its codes, remove one) read, decide and write in several steps; two
 * at once could leave two half-finished devices, or two sets of recovery codes of which only the last works.
 */
export function withAccountLock<T>(userId: number, task: () => Promise<T>): Promise<T> {
  const result = (accountLocks.get(userId) ?? Promise.resolve()).then(task);
  const settled = result.then(() => {}, () => {});
  accountLocks.set(userId, settled);
  void settled.then(() => {
    if (accountLocks.get(userId) === settled) accountLocks.delete(userId);
  });
  return result;
}

export { sha256 as hashSecret };

// ── Stream tokens ────────────────────────────────────────────────────────────

/**
 * EventSource cannot set headers, so a stream has to carry its credential in the URL. A URL ends up in logs, history
 * and referrers, so what goes there is never the API key: it is a token that lasts minutes, only opens the progress
 * streams, and is handed out in exchange for a real credential.
 */
const STREAM_TOKEN_MINUTES = 15;

interface StreamToken {
  userId: number;
  expiresAt: number;
}

/** Insertion-ordered, which is what lets the oldest be dropped when the cap is reached. */
const streamTokens = new Map<string, StreamToken>();

/** A page translation needs one token; these are per account, so the ceiling is generous and still bounded. */
const MAX_TOKENS_PER_USER = 10;
const MAX_TOKENS = 500;

/** Issues a token for the account making the request. */
export function issueStreamToken(userId: number): { token: string; expires_in: number } {
  const now = Date.now();

  // Expired entries would otherwise sit there until the server restarts
  let mine = 0;
  for (const [key, value] of streamTokens) {
    if (value.expiresAt <= now) streamTokens.delete(key);
    else if (value.userId === userId) mine++;
  }

  // One account asking over and over drops its own oldest tokens, not everybody else's
  if (mine >= MAX_TOKENS_PER_USER) {
    for (const [key, value] of streamTokens) {
      if (value.userId !== userId) continue;
      streamTokens.delete(key);
      if (--mine < MAX_TOKENS_PER_USER) break;
    }
  }
  // A ceiling for the whole server, however many accounts are at it
  while (streamTokens.size >= MAX_TOKENS) {
    const oldest = streamTokens.keys().next();
    if (oldest.done) break;
    streamTokens.delete(oldest.value);
  }

  const token = randomToken();
  streamTokens.set(sha256(token), { userId, expiresAt: now + STREAM_TOKEN_MINUTES * 60 * 1000 });
  return { token, expires_in: STREAM_TOKEN_MINUTES * 60 };
}

/** The account behind a stream token, or null when it is unknown, spent or out of date. */
export async function userForStreamToken(token: string): Promise<User | null> {
  const digest = sha256(token);
  const entry = streamTokens.get(digest);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    streamTokens.delete(digest);
    return null;
  }
  const user = await UserStore.findById(entry.userId);
  if (!user || user.disabledAt) return null;
  return user;
}
