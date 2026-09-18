/**
 * Self-sufficient migration runner that works in both source and compiled-binary modes.
 *
 * SQL files are imported at build time (see migrations-embedded.ts) and materialised
 * to a temp directory at startup, so the binary needs no external migration folder.
 */

import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { embeddedMigrations, embeddedMigrationCount } from "@/db/migrations-embedded";
import { env } from "@/env";
import { childLogger } from "@/lib/logger";

const log = childLogger("db");

export class MigrationManager {
  /** Temp dir where embedded SQL is written before Drizzle's migrator runs.
   *  Rewritten on every startup so it always matches the running binary. */
  private static get migrationsDir(): string {
    return join(tmpdir(), "web-ocr-bun-migrations");
  }

  /** Write embedded SQL files to the temp dir.
   *  Prunes stale .sql files from older builds before writing. */
  private static materialise(): void {
    const dir = this.migrationsDir;
    const metaDir = join(dir, "meta");
    mkdirSync(metaDir, { recursive: true });

    // Remove .sql files that this build does not carry (protects against rollback
    // leaving a newer migration on disk that the journal cannot explain).
    const expected = new Set(Object.keys(embeddedMigrations.files));
    try {
      for (const file of readdirSync(dir)) {
        if (file.endsWith(".sql") && !expected.has(file)) {
          rmSync(join(dir, file), { force: true });
        }
      }
    } catch { /* first run — dir was just created */ }

    for (const [name, content] of Object.entries(embeddedMigrations.files)) {
      writeFileSync(join(dir, name), content);
    }
    writeFileSync(join(metaDir, "_journal.json"), embeddedMigrations.journal);
  }

  /** Apply pending migrations.  Used by both the CLI runner and server startup. */
  static async runMigrations(): Promise<void> {
    this.guardEmbedded();
    this.materialise();

    const sqlite = new Database(env.DATABASE_URL);
    const db = drizzle(sqlite);
    try {
      await db.run(sql`PRAGMA journal_mode = WAL`);
      await this.applyMigrations(db);
      log.info("DB migrations applied.");
    } finally {
      sqlite.close();
    }
  }

  /**
   * Called at server startup.  Validates schema compatibility then applies any
   * pending migrations.  Exits the process if the database is ahead of this build.
   */
  static async init(): Promise<void> {
    this.guardEmbedded();
    this.materialise();

    const sqlite = new Database(env.DATABASE_URL);
    const db = drizzle(sqlite);
    try {
      await db.run(sql`PRAGMA journal_mode = WAL`);
      await db.run(sql`PRAGMA foreign_keys = ON`);

      // Hash-based divergence check — catches rollbacks and cross-branch schema drift.
      // Drizzle stores SHA-256 of the raw SQL content in __drizzle_migrations.hash.
      const embeddedHashes = new Set(
        Object.values(embeddedMigrations.files).map(s =>
          createHash("sha256").update(s).digest("hex")
        )
      );

      let appliedRows: { hash: string }[] = [];
      try {
        appliedRows = await db.all<{ hash: string }>(
          sql`SELECT hash FROM __drizzle_migrations ORDER BY created_at`
        );
      } catch {
        // Table absent — fresh database; all migrations are pending.
      }

      const appliedHashes = new Set(appliedRows.map(r => r.hash));
      const unknown = [...appliedHashes].filter(h => !embeddedHashes.has(h));
      if (unknown.length > 0) {
        log.error(
          `❌ The database has ${unknown.length} migration(s) this build does not recognise.`
        );
        log.error(
          "   This binary is older than the database schema."
        );
        log.error(
          "   Restore a newer build, or restore the database from a backup."
        );
        process.exit(1);
      }

      const pending = [...embeddedHashes].filter(h => !appliedHashes.has(h)).length;
      if (pending > 0) {
        console.log(`Running ${pending} pending migration(s)…`);
      }

      await this.applyMigrations(db);

      if (pending > 0) {
        log.info("DB migrations applied.");
      } else {
        log.info("DB up to date.");
      }
    } finally {
      sqlite.close();
    }
  }

  /**
   * Runs the pending migrations with foreign keys disabled, then turns them back on and checks the result.
   *
   * A `PRAGMA foreign_keys` written inside a migration is silently ignored, because Drizzle runs each migration in a
   * transaction and SQLite makes that pragma a no-op there. Table rebuilds (create new, copy, drop old, rename) would
   * then fire ON DELETE CASCADE on the dropped parent and take its children with it, so enforcement is switched off
   * here, around the whole run, where it does take effect.
   */
  private static async applyMigrations(db: ReturnType<typeof drizzle>): Promise<void> {
    await db.run(sql`PRAGMA foreign_keys = OFF`);
    try {
      await migrate(db, { migrationsFolder: this.migrationsDir });
    } finally {
      await db.run(sql`PRAGMA foreign_keys = ON`);
    }
    const violations = await db.all<Record<string, unknown>>(sql`PRAGMA foreign_key_check`);
    if (violations.length > 0) {
      log.error(`❌ The migrated database has ${violations.length} foreign key violation(s).`);
      log.error(`   ${JSON.stringify(violations.slice(0, 5))}`);
      throw new Error("migration left foreign key violations");
    }
  }

  private static guardEmbedded(): void {
    if (embeddedMigrationCount === 0) {
      log.error("❌ No migrations compiled into this binary — database cannot be initialised.");
      log.error("   This is a packaging fault; re-run \"bun run build\".");
      process.exit(1);
    }
  }
}
