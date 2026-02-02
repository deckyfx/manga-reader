import { Elysia } from "elysia";
import { envConfig } from "./env-config";
import { apiPlugin } from "./plugins/routeApi";
import { appPlugin } from "./plugins/routeApp";
import { FileWatcher } from "./services/FileWatcher";
import { MigrationManager } from "./db/migration-manager";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import staticPlugin from "@elysiajs/static";

async function initializeDatabase() {
  // Initialize migrations (auto-migrate in development, strict in production)
  await MigrationManager.init({
    autoMigrate: envConfig.isDevelopment,
    strict: envConfig.isProduction,
  });
}

async function initializeFileWatcher() {
  // Ensure directories exist
  await mkdir(envConfig.OCR_INPUT_DIR, { recursive: true });
  await mkdir(dirname(envConfig.OCR_OUTPUT_FILE), { recursive: true });

  // Get FileWatcher singleton
  const watcher = FileWatcher.getInstance();

  // Start watching (subscriptions are managed per-request by OcrResultManager)
  await watcher.startWatching(
    envConfig.OCR_OUTPUT_FILE,
    envConfig.OCR_INPUT_DIR,
  );

  console.log("✅ FileWatcher initialized");
  console.log("   Watching:", envConfig.OCR_OUTPUT_FILE);
  console.log("   Cleaning:", envConfig.OCR_INPUT_DIR);
}

// Initialize database and FileWatcher before starting server
await initializeDatabase();
await initializeFileWatcher();

/**
 * Main Elysia server with API and React app plugins
 */
const app = new Elysia()

  .use(apiPlugin) // API routes first
  .use(appPlugin) // React app last (wildcard route)
  .listen(envConfig.SERVER_PORT);

console.log(`🚀 Server running at http://localhost:${envConfig.SERVER_PORT}`);

// Export App type for Eden Treaty
export type App = typeof app;
