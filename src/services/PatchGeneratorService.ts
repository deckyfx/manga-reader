import { envConfig } from "../env-config";
import { catchError } from "../lib/error-handler";

/**
 * Patch Generator Service Response
 */
interface PatchResponse {
  status: "success";
  patchImage: string; // base64 encoded PNG
  size: [number, number];
}

/**
 * Error Response
 */
interface ErrorResponse {
  detail?: string;
  error?: string;
}

/**
 * PatchGeneratorService - Image patch generation service
 *
 * Generates image patches with translated text overlaid on cleaned manga regions.
 * Uses OpenCV for text cleanup and PIL/Pillow for text rendering.
 * Communicates with the manga-ocr FastAPI server via Unix domain socket
 * (reuses same socket, different endpoint for separation of concerns).
 */
export class PatchGeneratorService {
  private static instance: PatchGeneratorService;
  private socketPath: string;

  private constructor() {
    // Reuse manga-ocr socket, just different endpoint
    this.socketPath = envConfig.MANGA_OCR_SOCKET;
  }

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
   *   2
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
    strokeWidth: number
  ): Promise<string> {
    // Send to patch generator endpoint on same socket as manga-ocr
    const response = await fetch("http://localhost/generate-patch", {
      unix: this.socketPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        capturedImage,
        translatedText: lines,
        fontSize,
        fontType,
        textColor,
        strokeColor,
        strokeWidth,
      }),
    });

    if (!response.ok) {
      const error: ErrorResponse = await response.json();
      throw new Error(
        `Patch generation failed: ${error.detail || error.error || response.statusText}`
      );
    }

    const result: PatchResponse = await response.json();
    return result.patchImage;
  }

  /**
   * Check if patch generator service is available
   * (checks if manga-ocr socket is available)
   */
  public async isAvailable(): Promise<boolean> {
    try {
      // Try to reach the socket
      const response = await fetch("http://localhost/health", {
        unix: this.socketPath,
      });
      return response.ok;
    } catch {
      return false;
    }
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
    const response = await fetch("http://localhost/merge-patches", {
      unix: this.socketPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pageImageBase64,
        patches,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      const errorDetail = error.detail || error.error || response.statusText;
      const errorMessage = typeof errorDetail === 'string'
        ? errorDetail
        : JSON.stringify(errorDetail, null, 2);
      throw new Error(`Patch merging failed: ${errorMessage}`);
    }

    const result = await response.json();
    return result.mergedImage;
  }
}
