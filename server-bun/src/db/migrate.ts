/**
 * CLI migration runner — run with: bun run db:migrate
 * Applies embedded migrations; works identically in source and compiled-binary modes.
 */
import { MigrationManager } from "@/db/migration-manager";

MigrationManager.runMigrations().catch((err) => {
  console.error(err);
  process.exit(1);
});
