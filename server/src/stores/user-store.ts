/**
 * Accounts, browser sessions and API keys. Secrets are only ever stored hashed: a session cookie's token and an API
 * key are both kept as SHA-256, so this table tells an attacker nothing they could sign in with.
 */
import { and, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/index";
import {
  apiKeys,
  credentials,
  mfaChallenges,
  oauthAccounts,
  recoveryCodes,
  sessions,
  totpDevices,
  users,
  type ApiKey,
  type Credential,
  type MfaChallenge,
  type NewApiKey,
  type NewCredential,
  type NewUser,
  type OauthAccount,
  type Session,
  type TotpDevice,
  type User,
} from "@/db/schema";

/** Usernames are matched lower-cased, so "Decky" and "decky" are the same account. */
export const normaliseUsername = (name: string): string => name.trim().toLowerCase();

export class UserStore {
  /** Whether anyone has an account yet; false means the server is still waiting to be set up. */
  static async count(): Promise<number> {
    const row = await db.select({ count: sql<number>`count(*)` }).from(users).get();
    return row?.count ?? 0;
  }

  static async list(): Promise<User[]> {
    return db.select().from(users).orderBy(users.username);
  }

  static async findById(id: number): Promise<User | undefined> {
    return db.query.users.findFirst({ where: eq(users.id, id) });
  }

  static async findByUsername(username: string): Promise<User | undefined> {
    return db.query.users.findFirst({ where: eq(users.username, normaliseUsername(username)) });
  }

  static async insert(user: NewUser): Promise<User> {
    const [row] = await db.insert(users).values({ ...user, username: normaliseUsername(user.username) }).returning();
    if (!row) throw new Error("failed to create the user");
    return row;
  }

  static async update(id: number, fields: Partial<Omit<NewUser, "id" | "username">>): Promise<void> {
    await db.update(users).set({ ...fields, updatedAt: sql`(datetime('now'))` }).where(eq(users.id, id));
  }

  static async touch(id: number): Promise<void> {
    await db.update(users).set({ lastSeenAt: sql`(datetime('now'))` }).where(eq(users.id, id));
  }

  /** Deletes the account with its sessions and keys (both cascade). */
  static async delete(id: number): Promise<boolean> {
    const rows = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    return rows.length > 0;
  }

  /** How many admins are left, so the last one can't lock everybody out. */
  static async adminCount(): Promise<number> {
    const row = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(and(eq(users.role, "admin"), isNull(users.disabledAt)))
      .get();
    return row?.count ?? 0;
  }
}

export class SessionStore {
  static async create(tokenHash: string, userId: number, expiresAt: string, userAgent: string | null): Promise<Session> {
    const [row] = await db.insert(sessions).values({ tokenHash, userId, expiresAt, userAgent }).returning();
    if (!row) throw new Error("failed to create the session");
    return row;
  }

  static async find(tokenHash: string): Promise<Session | undefined> {
    return db.query.sessions.findFirst({ where: eq(sessions.tokenHash, tokenHash) });
  }

  static async touch(tokenHash: string): Promise<void> {
    await db.update(sessions).set({ lastSeenAt: sql`(datetime('now'))` }).where(eq(sessions.tokenHash, tokenHash));
  }

  static async delete(tokenHash: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }

  /** Signs an account out everywhere: after a password change, or when it is suspended. */
  static async deleteForUser(userId: number): Promise<void> {
    await db.delete(sessions).where(eq(sessions.userId, userId));
  }

  /** Drops sessions that have run out; called at startup. */
  static async purgeExpired(): Promise<number> {
    const rows = await db
      .delete(sessions)
      .where(lt(sessions.expiresAt, sql`datetime('now')`))
      .returning({ tokenHash: sessions.tokenHash });
    return rows.length;
  }
}

export class ApiKeyStore {
  static async create(key: NewApiKey): Promise<ApiKey> {
    const [row] = await db.insert(apiKeys).values(key).returning();
    if (!row) throw new Error("failed to create the API key");
    return row;
  }

  static async listByUser(userId: number): Promise<ApiKey[]> {
    return db.select().from(apiKeys).where(eq(apiKeys.userId, userId)).orderBy(desc(apiKeys.createdAt));
  }

  static async findByHash(keyHash: string): Promise<ApiKey | undefined> {
    return db.query.apiKeys.findFirst({ where: eq(apiKeys.keyHash, keyHash) });
  }

  static async findById(id: number): Promise<ApiKey | undefined> {
    return db.query.apiKeys.findFirst({ where: eq(apiKeys.id, id) });
  }

  static async touch(id: number): Promise<void> {
    await db.update(apiKeys).set({ lastUsedAt: sql`(datetime('now'))` }).where(eq(apiKeys.id, id));
  }

  /** Revoked keys are kept, so a key that turns up in a log can still be identified. */
  static async revoke(id: number): Promise<boolean> {
    const rows = await db
      .update(apiKeys)
      .set({ revokedAt: sql`(datetime('now'))` })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    return rows.length > 0;
  }

  static async delete(id: number): Promise<boolean> {
    const rows = await db.delete(apiKeys).where(eq(apiKeys.id, id)).returning({ id: apiKeys.id });
    return rows.length > 0;
  }
}

export class RecoveryCodeStore {
  /** Replaces the whole set: turning TOTP on, or asking for new codes, invalidates the old ones. */
  static async replace(userId: number, hashes: string[]): Promise<void> {
    db.transaction((tx) => {
      tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId)).run();
      for (const codeHash of hashes) tx.insert(recoveryCodes).values({ userId, codeHash }).run();
    });
  }

  static async listUnused(userId: number): Promise<{ id: number; codeHash: string }[]> {
    return db
      .select({ id: recoveryCodes.id, codeHash: recoveryCodes.codeHash })
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  }

  /** Marks one code used; false when it was already spent, so a code can't be replayed. */
  static async consume(id: number): Promise<boolean> {
    const rows = await db
      .update(recoveryCodes)
      .set({ usedAt: sql`(datetime('now'))` })
      .where(and(eq(recoveryCodes.id, id), isNull(recoveryCodes.usedAt)))
      .returning({ id: recoveryCodes.id });
    return rows.length > 0;
  }

  static async clear(userId: number): Promise<void> {
    await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  }
}

export class MfaChallengeStore {
  static async create(tokenHash: string, userId: number, expiresAt: string, userAgent: string | null): Promise<void> {
    await db.insert(mfaChallenges).values({ tokenHash, userId, expiresAt, userAgent });
  }

  static async find(tokenHash: string): Promise<MfaChallenge | undefined> {
    return db.query.mfaChallenges.findFirst({ where: eq(mfaChallenges.tokenHash, tokenHash) });
  }

  /** Stores the challenge a passkey has to sign, once the browser has asked for one. */
  static async setWebauthnChallenge(tokenHash: string, challenge: string): Promise<void> {
    await db.update(mfaChallenges).set({ webauthnChallenge: challenge }).where(eq(mfaChallenges.tokenHash, tokenHash));
  }

  static async delete(tokenHash: string): Promise<void> {
    await db.delete(mfaChallenges).where(eq(mfaChallenges.tokenHash, tokenHash));
  }

  static async purgeExpired(): Promise<number> {
    const rows = await db
      .delete(mfaChallenges)
      .where(lt(mfaChallenges.expiresAt, sql`datetime('now')`))
      .returning({ tokenHash: mfaChallenges.tokenHash });
    return rows.length;
  }
}

export class CredentialStore {
  static async listByUser(userId: number): Promise<Credential[]> {
    return db.select().from(credentials).where(eq(credentials.userId, userId)).orderBy(desc(credentials.createdAt));
  }

  static async findById(id: string): Promise<Credential | undefined> {
    return db.query.credentials.findFirst({ where: eq(credentials.id, id) });
  }

  static async insert(credential: NewCredential): Promise<Credential> {
    const [row] = await db.insert(credentials).values(credential).returning();
    if (!row) throw new Error("failed to store the passkey");
    return row;
  }

  /** The counter only ever goes up; a lower one means the authenticator may have been cloned. */
  static async touch(id: string, counter: number): Promise<void> {
    await db.update(credentials).set({ counter, lastUsedAt: sql`(datetime('now'))` }).where(eq(credentials.id, id));
  }

  static async delete(id: string, userId: number): Promise<boolean> {
    const rows = await db
      .delete(credentials)
      .where(and(eq(credentials.id, id), eq(credentials.userId, userId)))
      .returning({ id: credentials.id });
    return rows.length > 0;
  }
}

export class OauthAccountStore {
  static async find(provider: string, providerAccountId: string): Promise<OauthAccount | undefined> {
    return db.query.oauthAccounts.findFirst({
      where: and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerAccountId, providerAccountId)),
    });
  }

  static async listByUser(userId: number): Promise<OauthAccount[]> {
    return db.select().from(oauthAccounts).where(eq(oauthAccounts.userId, userId));
  }

  static async link(userId: number, provider: string, providerAccountId: string, email: string | null): Promise<OauthAccount> {
    const [row] = await db.insert(oauthAccounts).values({ userId, provider, providerAccountId, email }).returning();
    if (!row) throw new Error("failed to link the account");
    return row;
  }

  static async unlink(id: number, userId: number): Promise<boolean> {
    const rows = await db
      .delete(oauthAccounts)
      .where(and(eq(oauthAccounts.id, id), eq(oauthAccounts.userId, userId)))
      .returning({ id: oauthAccounts.id });
    return rows.length > 0;
  }
}

export class TotpDeviceStore {
  /** Every device, confirmed or not, newest last. */
  static async listByUser(userId: number): Promise<TotpDevice[]> {
    return db.select().from(totpDevices).where(eq(totpDevices.userId, userId)).orderBy(totpDevices.createdAt);
  }

  /** Only the devices that finished enrolling: these are the ones that can sign somebody in. */
  static async listConfirmed(userId: number): Promise<TotpDevice[]> {
    return db
      .select()
      .from(totpDevices)
      .where(and(eq(totpDevices.userId, userId), isNotNull(totpDevices.confirmedAt)));
  }

  static async findById(id: number): Promise<TotpDevice | undefined> {
    return db.query.totpDevices.findFirst({ where: eq(totpDevices.id, id) });
  }

  static async insert(userId: number, name: string, secret: string): Promise<TotpDevice> {
    const [row] = await db.insert(totpDevices).values({ userId, name, secret }).returning();
    if (!row) throw new Error("failed to store the authenticator");
    return row;
  }

  static async confirm(id: number): Promise<void> {
    await db.update(totpDevices).set({ confirmedAt: sql`(datetime('now'))` }).where(eq(totpDevices.id, id));
  }

  static async touch(id: number): Promise<void> {
    await db.update(totpDevices).set({ lastUsedAt: sql`(datetime('now'))` }).where(eq(totpDevices.id, id));
  }

  static async delete(id: number, userId: number): Promise<boolean> {
    const rows = await db
      .delete(totpDevices)
      .where(and(eq(totpDevices.id, id), eq(totpDevices.userId, userId)))
      .returning({ id: totpDevices.id });
    return rows.length > 0;
  }

  /** Half-finished enrolments left lying around; replaced whenever a new one starts. */
  static async deleteUnconfirmed(userId: number): Promise<void> {
    await db.delete(totpDevices).where(and(eq(totpDevices.userId, userId), isNull(totpDevices.confirmedAt)));
  }
}
