import { MigrationManager } from "./migration-manager";

/**
 * CLI migration runner
 * Usage: bun run migrate
 *
 * Uses Drizzle's migrate() under the hood with better UX
 */
async function runMigrations(): Promise<void> {
  await MigrationManager.runMigrations();
}

runMigrations().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
