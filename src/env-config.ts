import { join } from "node:path";

/**
 * Singleton class for typed environment configuration
 */
class EnvConfig {
  private static instance: EnvConfig;

  private constructor() {
    // Private constructor prevents direct instantiation
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): EnvConfig {
    if (!EnvConfig.instance) {
      EnvConfig.instance = new EnvConfig();
    }
    return EnvConfig.instance;
  }

  /**
   * Server port from environment or default 3000
   */
  get SERVER_PORT(): number {
    const port = Bun.env.SERVER_PORT;
    return port ? parseInt(port, 10) : 3000;
  }

  /**
   * Environment mode
   */
  get NODE_ENV(): string {
    return Bun.env.NODE_ENV ?? "development";
  }

  /**
   * Application name
   */
  get APP_NAME(): string {
    return Bun.env.APP_NAME ?? "comic-reader";
  }

  /**
   * Check if running in development mode
   */
  get isDevelopment(): boolean {
    return this.NODE_ENV === "development";
  }

  /**
   * Check if running in production mode
   */
  get isProduction(): boolean {
    return this.NODE_ENV === "production";
  }

  /**
   * Base data directory path
   */
  get DATA_DIR(): string {
    const dataDir = Bun.env.DATA_DIR;
    return dataDir
      ? join(process.cwd(), dataDir)
      : join(process.cwd(), "data");
  }

  /**
   * Database directory path
   * Container: /app/db (via env)
   * Standalone: ./data/db
   */
  get DB_DIR(): string {
    return Bun.env.DB_DIR || join(this.DATA_DIR, "db");
  }

  /**
   * Manga uploads directory path
   * Container: /app/manga (via env)
   * Standalone: ./data/manga
   */
  get MANGA_DIR(): string {
    return Bun.env.MANGA_DIR || join(this.DATA_DIR, "manga");
  }

  /**
   * Manga OCR Unix socket path
   * Container: /app/sock/manga-ocr.sock (via env)
   * Standalone: ./data/sock/manga-ocr.sock
   */
  get MANGA_OCR_SOCKET(): string {
    return Bun.env.MANGA_OCR_SOCKET || join(this.DATA_DIR, "sock/manga-ocr.sock");
  }

  /**
   * DeepL API key for translation
   */
  get DEEPL_API_KEY(): string {
    const apiKey = Bun.env.DEEPL_API_KEY;
    if (!apiKey) {
      throw new Error("DEEPL_API_KEY is not defined in environment variables");
    }
    return apiKey;
  }
}

// Export singleton instance
export const envConfig = EnvConfig.getInstance();
