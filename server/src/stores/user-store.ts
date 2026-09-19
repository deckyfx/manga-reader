/**
 * Accounts, browser sessions and API keys. Secrets are only ever stored hashed: a session cookie's token and an API
 * key are both kept as SHA-256, so this table tells an attacker nothing they could sign in with.
 */
import { and, desc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/index";
import { isSealed, open, seal } from "@/lib/secret-box";
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

/** Whether an insert failed on the users' unique username (Drizzle wraps the SQLite error in `cause`). */
function isUsernameConflict(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if (/UNIQUE constraint failed: users\.username/.test(e.message)) return true;
  }
  return false;
}

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

  /**
   * Creates the first admin, or answers null when somebody got there first. The count and the insert happen in one
   * transaction, so two requests arriving together can't each see an empty table and make an admin apiece.
   */
  static async insertFirstAdmin(user: NewUser): Promise<User | null> {
    return db.transaction((tx) => {
      const existing = tx.select({ count: sql<number>`count(*)` }).from(users).get();
      if ((existing?.count ?? 0) > 0) return null;
      const rows = tx.insert(users).values({ ...user, username: normaliseUsername(user.username), role: "admin" }).returning().all();
      return rows[0] ?? null;
    });
  }

  /**
   * `insert`, or null when the username is already taken. The unique index is what decides: a check beforehand can't,
   * since two requests for the same name can both pass it.
   */
  static async insertIfFree(user: NewUser): Promise<User | null> {
    try {
      return await UserStore.insert(user);
    } catch (err) {
      if (isUsernameConflict(err)) return null;
      throw err;
    }
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

  /**
   * Applies a change that may cost the account its admin rights, refusing when it would leave the server with none.
   * Counting and writing happen in one transaction: two admins demoting each other at the same instant would
   * otherwise both see two admins and both go through.
   */
  static async updateGuardingLastAdmin(
    id: number,
    fields: Partial<Omit<NewUser, "id" | "username">>,
    costsAdmin: boolean,
  ): Promise<"updated" | "last-admin" | "missing"> {
    return db.transaction((tx) => {
      const user = tx.select().from(users).where(eq(users.id, id)).get();
      if (!user) return "missing";
      // Only an admin who can still sign in counts: a suspended one leaving changes nobody's access
      if (costsAdmin && user.role === "admin" && user.disabledAt === null) {
        const row = tx
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(and(eq(users.role, "admin"), isNull(users.disabledAt)))
          .get();
        if ((row?.count ?? 0) <= 1) return "last-admin";
      }
      tx.update(users).set({ ...fields, updatedAt: sql`(datetime('now'))` }).where(eq(users.id, id)).run();
      return "updated";
    });
  }

  /** Deletes an account unless it is the last admin, again as one transaction. */
  static async deleteGuardingLastAdmin(id: number): Promise<"deleted" | "last-admin" | "missing"> {
    return db.transaction((tx) => {
      const user = tx.select().from(users).where(eq(users.id, id)).get();
      if (!user) return "missing";
      if (user.role === "admin" && user.disabledAt === null) {
        const row = tx
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(and(eq(users.role, "admin"), isNull(users.disabledAt)))
          .get();
        if ((row?.count ?? 0) <= 1) return "last-admin";
      }
      tx.delete(users).where(eq(users.id, id)).run();
      return "deleted";
    });
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

  /** This account's sessions, newest first. */
  static async listByUser(userId: number): Promise<Session[]> {
    return db.select().from(sessions).where(eq(sessions.userId, userId)).orderBy(desc(sessions.lastSeenAt));
  }

  /** Every session on the server, for an admin to look through. */
  static async listAll(): Promise<{ session: Session; username: string }[]> {
    const rows = await db
      .select({ session: sessions, username: users.username })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .orderBy(desc(sessions.lastSeenAt));
    return rows;
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

  /** Drops sessions that have run out; called at startup and then every 15 minutes. */
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

  /**
   * Spends the challenge. True only for the caller that actually removed it: two requests racing the same
   * challenge — a double-clicked button, a replayed form — must not both end up with a session.
   */
  static async delete(tokenHash: string): Promise<boolean> {
    const rows = await db
      .delete(mfaChallenges)
      .where(eq(mfaChallenges.tokenHash, tokenHash))
      .returning({ tokenHash: mfaChallenges.tokenHash });
    return rows.length > 0;
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

  /**
   * Moves the signature counter on. It only ever goes up: a counter that didn't advance is how a cloned
   * authenticator shows itself, so the write is conditional and says whether it happened.
   */
  static async touch(id: string, counter: number): Promise<boolean> {
    const rows = await db
      .update(credentials)
      .set({ counter, lastUsedAt: sql`(datetime('now'))` })
      .where(and(eq(credentials.id, id), lt(credentials.counter, counter)))
      .returning({ id: credentials.id });
    if (rows.length === 0) {
      // A device that reports 0 forever (many platform authenticators do) still counts as used
      await db.update(credentials).set({ lastUsedAt: sql`(datetime('now'))` }).where(eq(credentials.id, id));
    }
    return rows.length > 0;
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
  /** Rows keep their secret sealed; the rest of the server only ever sees it opened. */
  private static unseal(device: TotpDevice): TotpDevice {
    return { ...device, secret: open(device.secret) };
  }

  /** Every device, confirmed or not, newest last. */
  static async listByUser(userId: number): Promise<TotpDevice[]> {
    const rows = await db.select().from(totpDevices).where(eq(totpDevices.userId, userId)).orderBy(totpDevices.createdAt);
    return rows.map((row) => TotpDeviceStore.unseal(row));
  }

  /** Only the devices that finished enrolling: these are the ones that can sign somebody in. */
  static async listConfirmed(userId: number): Promise<TotpDevice[]> {
    const rows = await db
      .select()
      .from(totpDevices)
      .where(and(eq(totpDevices.userId, userId), isNotNull(totpDevices.confirmedAt)));
    return rows.map((row) => TotpDeviceStore.unseal(row));
  }

  static async findById(id: number): Promise<TotpDevice | undefined> {
    const row = await db.query.totpDevices.findFirst({ where: eq(totpDevices.id, id) });
    return row ? TotpDeviceStore.unseal(row) : undefined;
  }

  /**
   * Seals any secret still stored in the clear (authenticators enrolled before secrets were sealed at rest). Safe to
   * run on every start: sealed rows are left alone. Returns how many were sealed.
   */
  static async sealLegacy(): Promise<number> {
    const rows = await db.select({ id: totpDevices.id, secret: totpDevices.secret }).from(totpDevices);
    let sealed = 0;
    for (const row of rows.filter((r) => !isSealed(r.secret))) {
      // Only if it is still the plain value read above, so a concurrent change isn't overwritten
      const updated = await db
        .update(totpDevices)
        .set({ secret: seal(row.secret) })
        .where(and(eq(totpDevices.id, row.id), eq(totpDevices.secret, row.secret)))
        .returning({ id: totpDevices.id });
      sealed += updated.length;
    }
    return sealed;
  }

  static async insert(userId: number, name: string, secret: string): Promise<TotpDevice> {
    const [row] = await db.insert(totpDevices).values({ userId, name, secret: seal(secret) }).returning();
    if (!row) throw new Error("failed to store the authenticator");
    return TotpDeviceStore.unseal(row);
  }

  static async confirm(id: number): Promise<void> {
    await db.update(totpDevices).set({ confirmedAt: sql`(datetime('now'))` }).where(eq(totpDevices.id, id));
  }

  /**
   * Claims a time step for this device. False when the step is not newer than the last one used, which is what makes
   * a code single-use: the update only lands if nothing has claimed that step or a later one.
   */
  static async claimStep(id: number, step: number): Promise<boolean> {
    const rows = await db
      .update(totpDevices)
      .set({ lastStep: step, lastUsedAt: sql`(datetime('now'))` })
      .where(and(eq(totpDevices.id, id), or(isNull(totpDevices.lastStep), lt(totpDevices.lastStep, step))))
      .returning({ id: totpDevices.id });
    return rows.length > 0;
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
