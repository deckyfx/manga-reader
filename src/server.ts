import { Elysia } from "elysia";
import { envConfig } from "./env-config";
import { apiPlugin } from "./plugins/routeApi";
import { appPlugin } from "./plugins/routeApp";
import { MangaOCRService } from "./services/MangaOCRService";

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
    console.warn("   Error:", error instanceof Error ? error.message : "Unknown error");
    console.warn("   OCR features will not work until the service is started");
  }
}

// Initialize Manga OCR service before starting server
await initializeMangaOCR();

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
