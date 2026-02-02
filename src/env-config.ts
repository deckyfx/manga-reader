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
   * OCR output file path
   */
  get OCR_OUTPUT_FILE(): string {
    const customPath = Bun.env.OCR_OUTPUT_FILE;
    return customPath
      ? join(process.cwd(), customPath)
      : join(process.cwd(), "data/ocroutput/results.txt");
  }

  /**
   * OCR input directory path
   */
  get OCR_INPUT_DIR(): string {
    const customPath = Bun.env.OCR_INPUT_DIR;
    return customPath
      ? join(process.cwd(), customPath)
      : join(process.cwd(), "data/ocrinput");
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
