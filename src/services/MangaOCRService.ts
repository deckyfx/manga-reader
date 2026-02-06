import { MangaOCRAPI } from "./MangaOCRAPI";


/**
 * MangaOCRService - Wrapper service for MangaOCRAPI
 *
 * Provides instance-based interface for backward compatibility.
 * Delegates all operations to the centralized MangaOCRAPI.
 */
export class MangaOCRService {
  private static instance: MangaOCRService;

  private constructor() {}

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
  public async healthCheck() {
    return MangaOCRAPI.healthCheck();
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
    return MangaOCRAPI.scan(base64Image);
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
    return MangaOCRAPI.scanUpload(filePath);
  }

  /**
   * Extract text with full response details
   *
   * @param imageBuffer - Image data as Buffer or Uint8Array
   * @returns Full OCR response including text and image size
   */
  public async extractTextWithDetails(imageBuffer: Buffer | Uint8Array) {
    const base64Image = Buffer.from(imageBuffer).toString("base64");
    return MangaOCRAPI.scanWithDetails(base64Image);
  }

  /**
   * Check if OCR service is available
   */
  public async isAvailable(): Promise<boolean> {
    return MangaOCRAPI.isAvailable();
  }
}
