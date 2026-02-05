import { envConfig } from "../env-config";
import { catchError } from "../lib/error-handler";

/**
 * Manga OCR Service Response
 */
interface OCRResponse {
  status: "success";
  text: string;
  image_size: [number, number];
}

/**
 * Health Check Response
 */
interface HealthResponse {
  status: "healthy" | "unhealthy";
  model_loaded: boolean;
}

/**
 * Error Response
 */
interface ErrorResponse {
  detail?: string;
  error?: string;
}

/**
 * MangaOCRService - Simplified OCR service using FastAPI Unix socket
 *
 * Replaces the old OcrResultManager and ocrService with a simple fetch-based approach.
 * Communicates with the manga-ocr FastAPI server via Unix domain socket.
 */
export class MangaOCRService {
  private static instance: MangaOCRService;
  private socketPath: string;

  private constructor() {
    this.socketPath = envConfig.MANGA_OCR_SOCKET;
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): MangaOCRService {
    if (!MangaOCRService.instance) {
      MangaOCRService.instance = new MangaOCRService();
    }
    return MangaOCRService.instance;
  }

  /**
   * Check if OCR service is healthy and model is loaded
   */
  public async healthCheck(): Promise<HealthResponse> {
    const response = await fetch("http://localhost/health", {
      unix: this.socketPath,
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Extract text from image buffer using base64 encoding
   *
   * @param imageBuffer - Image data as Buffer or Uint8Array
   * @returns Extracted text from the image
   *
   * @example
   * ```typescript
   * const service = MangaOCRService.getInstance();
   * const imageBuffer = await Bun.file("manga.jpg").arrayBuffer();
   * const text = await service.extractText(Buffer.from(imageBuffer));
   * ```
   */
  public async extractText(imageBuffer: Buffer | Uint8Array): Promise<string> {
    // Convert to base64
    const base64Image = Buffer.from(imageBuffer).toString("base64");

    // Send to OCR service
    const response = await fetch("http://localhost/scan", {
      unix: this.socketPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image: base64Image,
      }),
    });

    if (!response.ok) {
      const error: ErrorResponse = await response.json();
      throw new Error(
        `OCR request failed: ${error.detail || error.error || response.statusText}`
      );
    }

    const result: OCRResponse = await response.json();
    return result.text;
  }

  /**
   * Extract text from image file using file upload
   *
   * @param filePath - Path to image file
   * @returns Extracted text from the image
   *
   * @example
   * ```typescript
   * const service = MangaOCRService.getInstance();
   * const text = await service.extractTextFromFile("manga.jpg");
   * ```
   */
  public async extractTextFromFile(filePath: string): Promise<string> {
    const file = Bun.file(filePath);

    // Create form data
    const formData = new FormData();
    formData.append("file", file);

    // Send to OCR service
    const response = await fetch("http://localhost/scan-upload", {
      unix: this.socketPath,
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error: ErrorResponse = await response.json();
      throw new Error(
        `OCR request failed: ${error.detail || error.error || response.statusText}`
      );
    }

    const result: OCRResponse = await response.json();
    return result.text;
  }

  /**
   * Extract text with full response details
   *
   * @param imageBuffer - Image data as Buffer or Uint8Array
   * @returns Full OCR response including text and image size
   */
  public async extractTextWithDetails(
    imageBuffer: Buffer | Uint8Array
  ): Promise<OCRResponse> {
    const base64Image = Buffer.from(imageBuffer).toString("base64");

    const response = await fetch("http://localhost/scan", {
      unix: this.socketPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image: base64Image,
      }),
    });

    if (!response.ok) {
      const error: ErrorResponse = await response.json();
      throw new Error(
        `OCR request failed: ${error.detail || error.error || response.statusText}`
      );
    }

    return await response.json();
  }

  /**
   * Check if OCR service is available
   */
  public async isAvailable(): Promise<boolean> {
    const [error, health] = await catchError(this.healthCheck());

    if (error) {
      return false;
    }

    return health.status === "healthy" && health.model_loaded;
  }
}
