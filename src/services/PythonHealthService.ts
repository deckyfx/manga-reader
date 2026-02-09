import { MangaOCRAPI, type StatusResponse, type ModelStatus } from "./MangaOCRAPI";
import { catchError } from "../lib/error-handler";

/**
 * PythonHealthService - Monitor Python OCR server health and model status
 *
 * Provides utilities to check Python server health and display model information
 * on application startup.
 */
export class PythonHealthService {
  /**
   * Get detailed model status from Python server
   *
   * @returns Status response with all model information
   */
  static async getModelStatus(): Promise<StatusResponse | null> {
    const [error, status] = await catchError(MangaOCRAPI.getStatus());

    if (error) {
      console.error("Failed to get Python server status:", error);
      return null;
    }

    return status;
  }

  /**
   * Display model status in console (for server startup)
   *
   * @param status - Status response from Python server
   */
  static displayModelStatus(status: StatusResponse): void {
    console.log("\n📦 Python OCR Server Models:");

    for (const [key, model] of Object.entries(status.models)) {
      const statusIcon = model.ready ? "✅" : "⏳";
      const statusText = model.ready ? "Ready" : "Loading...";
      console.log(`   ${statusIcon} ${model.name} - ${statusText}`);
    }
    console.log("");
  }

  /**
   * Wait for Python server to be ready with timeout
   *
   * @param maxRetries - Maximum number of retry attempts (default: 30)
   * @param retryDelay - Delay between retries in ms (default: 1000)
   * @returns true if server is ready, false if timeout
   */
  static async waitForReady(
    maxRetries: number = 30,
    retryDelay: number = 1000,
  ): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      const [error, available] = await catchError(MangaOCRAPI.isAvailable());

      if (!error && available) {
        return true;
      }

      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }

    return false;
  }

  /**
   * Check if all models are ready
   *
   * @param status - Status response from Python server
   * @returns true if all models are ready
   */
  static areAllModelsReady(status: StatusResponse): boolean {
    return Object.values(status.models).every((model) => model.ready);
  }

  /**
   * Get list of ready models
   *
   * @param status - Status response from Python server
   * @returns Array of ready model names
   */
  static getReadyModels(status: StatusResponse): string[] {
    return Object.values(status.models)
      .filter((model) => model.ready)
      .map((model) => model.name);
  }

  /**
   * Get list of loading models
   *
   * @param status - Status response from Python server
   * @returns Array of loading model names
   */
  static getLoadingModels(status: StatusResponse): string[] {
    return Object.values(status.models)
      .filter((model) => !model.ready)
      .map((model) => model.name);
  }
}
