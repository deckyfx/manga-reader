import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Database } from "bun:sqlite";
import { sql } from "drizzle-orm";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { envConfig } from "../env-config";
import { catchError, catchErrorSync } from "../lib/error-handler";

/**
 * Migration manager configuration
 */
export interface MigrationConfig {
  /**
   * Strict mode: Terminate if pending migrations detected
   * Default: false (development mode)
   */
  strict?: boolean;

  /**
   * Auto-migrate: Automatically run pending migrations
   * Default: false (manual only)
   */
  autoMigrate?: boolean;
}

/**
 * MigrationManager - Workflow layer on top of Drizzle migrations
 *
 * Adds Laravel-style features:
 * - Runtime initialization with strict/auto-migrate modes
 * - Better CLI experience
 * - Production safety checks
 *
 * Uses Drizzle's built-in migration system under the hood.
 */
export class MigrationManager {
  private static get dbPath(): string {
    return join(envConfig.DB_DIR, "manga-reader.db");
  }
  private static migrationsDir = "drizzle";

  /**
   * Initialize migration system (for runtime use)
   *
   * @example
   * // Development: Auto-migrate on startup
   * await MigrationManager.init({ autoMigrate: true });
   *
   * @example
   * // Production: Strict mode - terminate if pending
   * await MigrationManager.init({ strict: true });
   */
  static async init(config: MigrationConfig = {}): Promise<void> {
    const { strict = false, autoMigrate = false } = config;

    // Check if migration files exist
    const hasMigrations = await this.hasMigrationFiles();
    if (!hasMigrations) {
      console.log("ℹ️  No migration files found");
      return;
    }

    // Check for pending migrations
    const pendingCount = await this.getPendingCount();

    if (pendingCount === 0) {
      console.log("✅ Database is up to date");
      return;
    }

    // Strict mode: Terminate if pending migrations exist
    if (strict) {
      console.error(`❌ ${pendingCount} pending migration(s) detected`);
      console.error("💡 Run 'bun run migrate' to apply migrations");
      process.exit(1);
    }

    // Auto-migrate mode: Run pending migrations
    if (autoMigrate) {
      console.log(`🔄 Auto-migrating ${pendingCount} pending migration(s)...`);
      await this.runMigrations();
      console.log("✅ Auto-migration completed");
      return;
    }

    // Default: Just warn about pending migrations
    console.warn(`⚠️  Warning: ${pendingCount} pending migration(s) detected`);
    console.warn("💡 Run 'bun run migrate' to apply them");
  }

  /**
   * Run all pending migrations (for CLI use)
   * Uses Drizzle's migrate() under the hood
   */
  static async runMigrations(): Promise<void> {
    console.log("🚀 Running migrations...\n");

    const sqlite = new Database(this.dbPath, { create: true });
    const db = drizzle(sqlite);

    // Use Drizzle's migrate() - handles tracking automatically
    const [error, _result] = await catchError(
      (async () => {
        await migrate(db, { migrationsFolder: this.migrationsDir });
      })(),
    );

    sqlite.close();

    if (error) {
      console.error("\n❌ Migration failed:", error);
      throw error;
    }

    console.log("\n🎉 Migrations completed successfully");
  }

  /**
   * Check if migration files exist
   */
  private static async hasMigrationFiles(): Promise<boolean> {
    const [error, files] = await catchError(readdir(this.migrationsDir));

    if (error) {
      return false;
    }

    return files.some((f) => f.endsWith(".sql"));
  }

  /**
   * Get count of pending migrations
   * Compares migration files vs Drizzle's tracking table
   */
  private static async getPendingCount(): Promise<number> {
    const [readdirError, files] = await catchError(readdir(this.migrationsDir));

    if (readdirError) {
      return 0;
    }

    const migrationFiles = files.filter((f) => f.endsWith(".sql")).sort();

    if (migrationFiles.length === 0) {
      return 0;
    }

    const sqlite = new Database(this.dbPath, { create: true });
    const db = drizzle(sqlite);

    const [queryError, applied] = catchErrorSync(() =>
      db.all<{ hash: string; created_at: number }>(
        sql`SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at`,
      ),
    );

    sqlite.close();

    if (queryError) {
      // If __drizzle_migrations doesn't exist, all migrations are pending
      return migrationFiles.length;
    }

    // Compare counts
    return migrationFiles.length - applied.length;
  }
}
