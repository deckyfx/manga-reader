import { Elysia } from "elysia";
import { serverTiming } from "@elysiajs/server-timing";

import { envConfig } from "./env-config";
import { apiPlugin } from "./plugins/routeApi";
import { appPlugin } from "./plugins/routeApp";
import { appPluginBinary } from "./plugins/routeAppBinary";
import { MangaOCRService } from "./services/MangaOCRService";
import { PythonHealthService } from "./services/PythonHealthService";
import { MigrationManager } from "./db/migration-manager";
import { createLogger } from "tsuki-logger/elysia";
import { catchError } from "./lib/error-handler";

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
  const [error, health] = await catchError(ocrService.healthCheck());

  if (error) {
    console.warn("⚠️  Manga OCR service not available");
    console.warn("   Socket:", envConfig.MANGA_OCR_SOCKET);
    console.warn("   Error:", error.message);
    console.warn("   OCR features will not work until the service is started");
    return;
  }

  console.log("✅ Manga OCR service initialized");
  console.log("   Status:", health.status);
  console.log("   Model loaded:", health.model_loaded);
  console.log("   Socket:", envConfig.MANGA_OCR_SOCKET);

  // Get and display detailed model status
  const modelStatus = await PythonHealthService.getModelStatus();
  if (modelStatus) {
    PythonHealthService.displayModelStatus(modelStatus);
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
  // Logging middleware
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
  .use(envConfig.IS_BINARY_MODE ? appPluginBinary : appPlugin) // Load correct app plugin based on run mode
  .listen(envConfig.SERVER_PORT);

console.log(`🚀 Server running at http://localhost:${envConfig.SERVER_PORT}`);

// Export App type for Eden Treaty
export type App = typeof app;
