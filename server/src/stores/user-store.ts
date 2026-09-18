/**
 * Accounts, browser sessions and API keys. Secrets are only ever stored hashed: a session cookie's token and an API
 * key are both kept as SHA-256, so this table tells an attacker nothing they could sign in with.
 */
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/index";
import { apiKeys, sessions, users, type ApiKey, type NewApiKey, type NewUser, type Session, type User } from "@/db/schema";

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
