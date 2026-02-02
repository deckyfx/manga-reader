import { FileWatcher, type OCRResult } from "./FileWatcher";

/**
 * OCR Result Manager
 *
 * Manages per-request OCR subscriptions with auto-unsubscribe
 */

interface PendingRequest {
  filename: string;
  resolve: (text: string) => void;
  timeout: Timer;
  unsubscribe: () => void;
}

export class OcrResultManager {
  private static instance: OcrResultManager;
  private pendingRequests: Map<string, PendingRequest> = new Map();

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): OcrResultManager {
    if (!OcrResultManager.instance) {
      OcrResultManager.instance = new OcrResultManager();
    }
    return OcrResultManager.instance;
  }

  /**
   * Wait for OCR result for a specific file with auto-subscribing
   * @param filename - Filename to wait for
   * @param timeoutMs - Timeout in milliseconds (default 5000)
   * @returns Promise that resolves with OCR text or rejects on timeout
   */
  public waitForResult(filename: string, timeoutMs: number = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
      // Subscribe to FileWatcher for this specific request
      const watcher = FileWatcher.getInstance();

      const unsubscribe = watcher.subscribe(async (result: OCRResult) => {
        // Check if this result is for our file
        const pending = this.pendingRequests.get(filename);
        if (pending) {
          // Found our result!
          clearTimeout(pending.timeout);
          pending.unsubscribe(); // Unsubscribe immediately
          this.pendingRequests.delete(filename);
          resolve(result.content);
        }
      });

      // Set timeout
      const timeout = setTimeout(() => {
        const pending = this.pendingRequests.get(filename);
        if (pending) {
          pending.unsubscribe(); // Unsubscribe on timeout
          this.pendingRequests.delete(filename);
          reject(new Error("OCR timeout"));
        }
      }, timeoutMs);

      // Store pending request with unsubscribe function
      this.pendingRequests.set(filename, {
        filename,
        resolve,
        timeout,
        unsubscribe,
      });
    });
  }

  /**
   * Get count of pending requests
   */
  public getPendingCount(): number {
    return this.pendingRequests.size;
  }
}
