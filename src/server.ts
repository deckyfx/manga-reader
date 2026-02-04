import { Elysia } from "elysia";
import { serverTiming } from "@elysiajs/server-timing";

import { envConfig } from "./env-config";
import { apiPlugin } from "./plugins/routeApi";
import { appPlugin } from "./plugins/routeApp";
import { MangaOCRService } from "./services/MangaOCRService";
import { MigrationManager } from "./db/migration-manager";
import { createLogger } from "tsuki-logger/elysia";

/**
 * Initialize database migrations
 *
 * Auto-migrate on startup for convenience in containerized environments.
 */
async function initializeDatabase() {
  await MigrationManager.init({
    autoMigrate: true,
  });
}

async function initializeMangaOCR() {
  // Get MangaOCRService singleton
  const ocrService = MangaOCRService.getInstance();

  // Check if OCR service is available
  try {
    const health = await ocrService.healthCheck();
    console.log("✅ Manga OCR service initialized");
    console.log("   Status:", health.status);
    console.log("   Model loaded:", health.model_loaded);
    console.log("   Socket:", envConfig.MANGA_OCR_SOCKET);
  } catch (error) {
    console.warn("⚠️  Manga OCR service not available");
    console.warn("   Socket:", envConfig.MANGA_OCR_SOCKET);
    console.warn(
      "   Error:",
      error instanceof Error ? error.message : "Unknown error",
    );
    console.warn("   OCR features will not work until the service is started");
  }
}

// Initialize database migrations first
await initializeDatabase();

// Initialize Manga OCR service before starting server
await initializeMangaOCR();

/**
 * Main Elysia server with API and React app plugins
 */
const app = new Elysia()
  // Logging middleware // Logging middleware
  .use(
    createLogger({
      level: "debug",
      autoLogging: true,
      customProps: (ctx) => ({}),
    }),
  )

  // Server timing for performance monitoring
  .use(serverTiming())

  .use(apiPlugin) // API routes first
  .use(appPlugin) // React app last (wildcard route)
  .listen(envConfig.SERVER_PORT);

console.log(`🚀 Server running at http://localhost:${envConfig.SERVER_PORT}`);

// Export App type for Eden Treaty
export type App = typeof app;
