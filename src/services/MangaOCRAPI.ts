import { envConfig } from "../env-config";
import { catchError } from "../lib/error-handler";

/**
 * OCR Response
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
 * Model Status
 */
export interface ModelStatus {
  name: string;
  ready: boolean;
}

/**
 * Status Response (detailed model information)
 */
export interface StatusResponse {
  models: {
    ocr: ModelStatus;
    cleaner: ModelStatus;
    predict: ModelStatus;
  };
}

/**
 * Patch Response
 */
interface PatchResponse {
  status: "success";
  patchImage: string; // base64 encoded PNG
  size: [number, number];
}

/**
 * Merge Patches Response
 */
interface MergePatchesResponse {
  mergedImage: string; // base64 encoded
}

/**
 * Inpaint Mask Response
 */
interface InpaintMaskResponse {
  status: "success";
  cleanedImage: string; // base64 encoded PNG
}

/**
 * Bounding Box for detected text region
 */
interface BoundingBox {
  type: "rectangle";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
}

/**
 * Predict Regions Response
 */
interface PredictRegionsResponse {
  status: "success";
  regions: BoundingBox[];
  image_size: [number, number];
}

/**
 * Error Response
 */
interface ErrorResponse {
  detail?: string | { msg?: string }[];
  error?: string;
}

/**
 * MangaOCRAPI - Centralized API client for manga OCR server
 *
 * Store-like pattern with static methods for all manga OCR server communication.
 * Handles all fetch requests to the FastAPI server via Unix domain socket.
 *
 * @example
 * ```typescript
 * // Health check
 * const [error, health] = await catchError(MangaOCRAPI.healthCheck());
 *
 * // OCR scan
 * const [error, text] = await catchError(MangaOCRAPI.scan(imageBase64));
 *
 * // Generate patch
 * const [error, patchImage] = await catchError(
 *   MangaOCRAPI.generatePatch(capturedImage, lines, fontSize, ...)
 * );
 * ```
 */
export class MangaOCRAPI {
  private static basePath = "http://localhost";
  private static socketPath = envConfig.MANGA_OCR_SOCKET;

  /**
   * Factory method for all fetch operations
   * Handles common error handling and response parsing
   *
   * @param endpoint - API endpoint (e.g., "/health", "/scan")
   * @param options - Fetch options (method, body, headers)
   * @param errorPrefix - Error message prefix
   * @returns Parsed JSON response
   */
  private static async fetchAPI<T>(
    endpoint: string,
    options: RequestInit = {},
    errorPrefix: string = "API request",
  ): Promise<T> {
    const [fetchError, response] = await catchError(
      fetch(`${this.basePath}${endpoint}`, {
        unix: this.socketPath,
        ...options,
      }),
    );

    if (fetchError) {
      const msg =
        fetchError instanceof Error
          ? fetchError.message
          : JSON.stringify(fetchError);
      throw new Error(`${errorPrefix} failed: ${msg}`);
    }

    if (!response.ok) {
      const [jsonError, error] = await catchError<ErrorResponse>(
        response.json(),
      );

      if (jsonError) {
        throw new Error(`${errorPrefix} failed: ${response.statusText}`);
      }

      const detail = Array.isArray(error.detail)
        ? error.detail.map((d) => d.msg ?? JSON.stringify(d)).join("; ")
        : error.detail;
      throw new Error(
        `${errorPrefix} failed: ${detail || error.error || response.statusText}`,
      );
    }

    const [jsonError, result] = await catchError<T>(response.json());

    if (jsonError) {
      throw new Error(`Failed to parse response: ${jsonError.message}`);
    }

    return result;
  }

  /**
   * Health check endpoint
   *
   * @returns Health status and model loaded state
   */
  static async healthCheck(): Promise<HealthResponse> {
    return this.fetchAPI<HealthResponse>("/health", {}, "Health check");
  }

  /**
   * Get detailed status of all models
   *
   * @returns Status of all loaded models (OCR, AnimeLaMa, YOLO)
   */
  static async getStatus(): Promise<StatusResponse> {
    return this.fetchAPI<StatusResponse>("/status", {}, "Status check");
  }

  /**
   * Scan image with OCR (base64 input)
   *
   * @param imageBase64 - Base64 encoded image
   * @returns Extracted text from the image
   */
  static async scan(imageBase64: string): Promise<string> {
    const result = await this.fetchAPI<OCRResponse>(
      "/scan",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageBase64 }),
      },
      "OCR scan",
    );
    return result.text;
  }

  /**
   * Scan image with OCR (file upload)
   *
   * @param filePath - Path to image file
   * @returns Extracted text from the image
   */
  static async scanUpload(filePath: string): Promise<string> {
    const file = Bun.file(filePath);
    const formData = new FormData();
    formData.append("file", file);

    const result = await this.fetchAPI<OCRResponse>(
      "/scan-upload",
      {
        method: "POST",
        body: formData,
      },
      "OCR scan upload",
    );
    return result.text;
  }

  /**
   * Scan image with full response details
   *
   * @param imageBase64 - Base64 encoded image
   * @returns Full OCR response including text and image size
   */
  static async scanWithDetails(imageBase64: string): Promise<OCRResponse> {
    return this.fetchAPI<OCRResponse>(
      "/scan",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageBase64 }),
      },
      "OCR scan",
    );
  }

  /**
   * Generate patch image with translated text overlay
   *
   * @param capturedImage - Base64 encoded image of the manga region
   * @param lines - Array of text lines to render
   * @param fontSize - Font size in pixels
   * @param fontType - Font type: "regular", "bold", or "italic"
   * @param textColor - Text color in hex format (e.g., "#FFFFFF")
   * @param strokeColor - Stroke color in hex format or null for no stroke
   * @param strokeWidth - Stroke width in pixels (0 for no stroke)
   * @param polygonPoints - Optional polygon points for masking (relative to captured image)
   * @param cleanerThreshold - Threshold for text detection (0-255, default 200, lower = more aggressive)
   * @param alphaBackground - Transparent background (skip cleaning, text only)
   * @returns Base64 encoded PNG patch image
   */
  static async generatePatch(
    capturedImage: string,
    lines: string[],
    fontSize: number,
    fontType: "regular" | "bold" | "italic",
    textColor: string,
    strokeColor: string | null,
    strokeWidth: number,
    polygonPoints?: Array<{ x: number; y: number }>,
    cleanerThreshold: number = 200,
    alphaBackground: boolean = false,
  ): Promise<string> {
    const result = await this.fetchAPI<PatchResponse>(
      "/generate-patch",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capturedImage,
          translatedText: lines,
          fontSize,
          fontType,
          textColor,
          strokeColor,
          strokeWidth,
          polygonPoints,
          cleanerThreshold,
          alphaBackground,
        }),
      },
      "Patch generation",
    );
    return result.patchImage;
  }

  /**
   * Merge patches onto page image
   *
   * @param pageImageBase64 - Base64 encoded page image
   * @param patches - Array of patches with positions
   * @returns Base64 encoded merged image
   */
  static async mergePatches(
    pageImageBase64: string,
    patches: Array<{
      patchImageBase64: string;
      x: number;
      y: number;
      width?: number;
      height?: number;
    }>,
  ): Promise<string> {
    const result = await this.fetchAPI<MergePatchesResponse>(
      "/merge-patches",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageImageBase64,
          patches,
        }),
      },
      "Patch merging",
    );
    return result.mergedImage;
  }

  /**
   * Inpaint page using binary mask (AnimeLaMa)
   *
   * @param imageBlob - Page image blob
   * @param maskBlob - Binary mask PNG (white=inpaint, black=preserve)
   * @returns Base64 encoded cleaned image (with data:image/png;base64, prefix)
   */
  static async inpaintMask(imageBlob: Blob, maskBlob: Blob): Promise<string> {
    const formData = new FormData();
    formData.append("image", imageBlob, "page.png");
    formData.append("mask", maskBlob, "mask.png");

    const result = await this.fetchAPI<InpaintMaskResponse>(
      "/inpaint-mask",
      {
        method: "POST",
        body: formData,
      },
      "Inpaint mask",
    );
    return result.cleanedImage;
  }

  /**
   * Predict text regions using YOLO
   *
   * @param imageBase64 - Base64 encoded image
   * @returns Array of bounding boxes with confidence scores
   */
  static async predictRegions(
    imageBase64: string,
  ): Promise<PredictRegionsResponse> {
    return this.fetchAPI<PredictRegionsResponse>(
      "/predict-regions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageBase64 }),
      },
      "Region prediction",
    );
  }

  /**
   * Check if OCR service is available and healthy
   *
   * @returns true if service is healthy and model is loaded
   */
  static async isAvailable(): Promise<boolean> {
    const [error, health] = await catchError(this.healthCheck());

    if (error) {
      return false;
    }

    return health.status === "healthy" && health.model_loaded;
  }
}
