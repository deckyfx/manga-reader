import { MangaOCRAPI } from "./MangaOCRAPI";

/**
 * PatchGeneratorService - Wrapper service for MangaOCRAPI patch operations
 *
 * Provides instance-based interface for backward compatibility.
 * Delegates all operations to the centralized MangaOCRAPI.
 */
export class PatchGeneratorService {
  private static instance: PatchGeneratorService;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): PatchGeneratorService {
    if (!PatchGeneratorService.instance) {
      PatchGeneratorService.instance = new PatchGeneratorService();
    }
    return PatchGeneratorService.instance;
  }

  /**
   * Generate patch image with translated text overlay (manual control)
   *
   * @param capturedImage - Base64 encoded image of the manga region
   * @param lines - Array of text lines to render
   * @param fontSize - Font size in pixels
   * @param fontType - Font type: "regular", "bold", or "italic"
   * @param textColor - Text color in hex format (e.g., "#FFFFFF")
   * @param strokeColor - Stroke color in hex format or null for no stroke
   * @param strokeWidth - Stroke width in pixels (0 for no stroke)
   * @param polygonPoints - Optional polygon points for masking (relative to captured image)
   * @returns Base64 encoded PNG patch image
   *
   * @example
   * ```typescript
   * const service = PatchGeneratorService.getInstance();
   * const patchImage = await service.generatePatch(
   *   capturedImageBase64,
   *   ["Line 1", "Line 2"],
   *   40,
   *   "regular",
   *   "#FFFFFF",
   *   "#000000",
   *   2,
   *   [{ x: 10, y: 20 }, { x: 50, y: 30 }] // Optional polygon points
   * );
   * ```
   */
  public async generatePatch(
    capturedImage: string,
    lines: string[],
    fontSize: number,
    fontType: "regular" | "bold" | "italic",
    textColor: string,
    strokeColor: string | null,
    strokeWidth: number,
    polygonPoints?: Array<{ x: number; y: number }>
  ): Promise<string> {
    return MangaOCRAPI.generatePatch(
      capturedImage,
      lines,
      fontSize,
      fontType,
      textColor,
      strokeColor,
      strokeWidth,
      polygonPoints
    );
  }

  /**
   * Check if patch generator service is available
   * (checks if manga-ocr socket is available)
   */
  public async isAvailable(): Promise<boolean> {
    return MangaOCRAPI.isAvailable();
  }

  /**
   * Merge patches onto page image
   *
   * @param pageImageBase64 - Base64 encoded page image
   * @param patches - Array of patches with positions
   * @returns Base64 encoded merged image
   */
  public async mergePatches(
    pageImageBase64: string,
    patches: Array<{ patchImageBase64: string; x: number; y: number }>
  ): Promise<string> {
    return MangaOCRAPI.mergePatches(pageImageBase64, patches);
  }
}
