import { watch, type FSWatcher } from "fs";
import { readFile, writeFile, readdir, unlink } from "fs/promises";
import { join } from "path";

/**
 * Type for OCR result data
 */
export interface OCRResult {
  content: string;
  timestamp: Date;
  filePath: string;
}

/**
 * Type for subscriber callback
 */
export type OCRResultCallback = (result: OCRResult) => void | Promise<void>;

/**
 * Singleton class to watch a file for changes
 * When content changes, notifies subscribers, logs it, and clears the file
 */
export class FileWatcher {
  private static instance: FileWatcher;
  private watcher: FSWatcher | null = null;
  private filePath: string = "";
  private inputDir: string = "";
  private isProcessing: boolean = false;
  private subscribers: Set<OCRResultCallback> = new Set();

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): FileWatcher {
    if (!FileWatcher.instance) {
      FileWatcher.instance = new FileWatcher();
    }
    return FileWatcher.instance;
  }

  /**
   * Start watching a file
   * @param filePath - Path to the file to watch
   * @param inputDir - Directory containing input files to clean up after processing
   */
  public async startWatching(
    filePath: string,
    inputDir: string = ""
  ): Promise<void> {
    if (this.watcher) {
      return;
    }

    this.filePath = filePath;
    this.inputDir = inputDir;

    this.watcher = watch(filePath, async (eventType) => {
      if (eventType === "change" && !this.isProcessing) {
        await this.handleFileChange();
      }
    });
  }

  /**
   * Handle file change event
   */
  private async handleFileChange(): Promise<void> {
    this.isProcessing = true;

    try {
      // Read file content
      const content = await readFile(this.filePath, "utf-8");

      // Skip if file is empty
      if (!content.trim()) {
        this.isProcessing = false;
        return;
      }

      // Create result object
      const result: OCRResult = {
        content: content.trim(),
        timestamp: new Date(),
        filePath: this.filePath,
      };

      // Notify all subscribers
      await this.notifySubscribers(result);

      // Clear the output file
      await writeFile(this.filePath, "", "utf-8");

      // Clean up input directory if specified
      if (this.inputDir) {
        await this.cleanupInputDirectory();
      }
    } catch (error) {
      console.error("❌ Error processing file:", error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Clean up all files in the input directory
   */
  private async cleanupInputDirectory(): Promise<void> {
    try {
      const files = await readdir(this.inputDir);

      for (const file of files) {
        const filePath = join(this.inputDir, file);
        await unlink(filePath);
      }
    } catch (error) {
      console.error("Error cleaning input directory:", error);
    }
  }

  /**
   * Notify all subscribers with the OCR result
   */
  private async notifySubscribers(result: OCRResult): Promise<void> {
    if (this.subscribers.size === 0) {
      return;
    }

    const promises = Array.from(this.subscribers).map(async (callback) => {
      try {
        await callback(result);
      } catch (error) {
        console.error("Error in subscriber callback:", error);
      }
    });

    await Promise.all(promises);
  }

  /**
   * Stop watching the file
   */
  public stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Check if currently watching a file
   */
  public isWatching(): boolean {
    return this.watcher !== null;
  }

  /**
   * Get the path of the file being watched
   */
  public getWatchedFile(): string {
    return this.filePath;
  }

  /**
   * Subscribe to OCR result events
   * @param callback - Function to call when OCR results are available
   * @returns Unsubscribe function
   */
  public subscribe(callback: OCRResultCallback): () => void {
    this.subscribers.add(callback);

    // Return unsubscribe function
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Get the number of active subscribers
   */
  public getSubscriberCount(): number {
    return this.subscribers.size;
  }
}
