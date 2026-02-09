import { MangaOCRAPI } from "./MangaOCRAPI";
import { catchError } from "../lib/error-handler";

/**
 * Bounding Box for detected text region
 */
export interface BoundingBox {
  type: "rectangle";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
}

/**
 * Prediction Result
 */
export interface PredictionResult {
  regions: BoundingBox[];
  imageSize: [number, number];
}

/**
 * BBPredictionService - Bounding Box Prediction Service
 *
 * Service layer for automatic text region detection using YOLO.
 * Wraps MangaOCRAPI predict-regions endpoint.
 *
 * @example
 * ```typescript
 * // Predict regions from base64 image
 * const [error, result] = await catchError(
 *   BBPredictionService.predictRegions(imageBase64)
 * );
 *
 * if (error) {
 *   console.error("Prediction failed:", error);
 *   return;
 * }
 *
 * console.log(`Found ${result.regions.length} regions`);
 * result.regions.forEach(region => {
 *   console.log(`Region: ${region.x1},${region.y1} -> ${region.x2},${region.y2}`);
 * });
 * ```
 */
export class BBPredictionService {
  /**
   * Predict text regions in manga page using YOLO
   *
   * @param imageBase64 - Base64 encoded image (without data:image prefix)
   * @returns Detected bounding boxes and image size
   * @throws Error if prediction fails
   */
  static async predictRegions(imageBase64: string): Promise<PredictionResult> {
    const response = await MangaOCRAPI.predictRegions(imageBase64);

    return {
      regions: response.regions,
      imageSize: response.image_size,
    };
  }

  /**
   * Predict regions from canvas
   *
   * @param canvas - HTML Canvas element
   * @returns Detected bounding boxes and image size
   * @throws Error if prediction fails
   */
  static async predictFromCanvas(canvas: HTMLCanvasElement): Promise<PredictionResult> {
    // Get base64 image from canvas (remove data:image/png;base64, prefix)
    const dataURL = canvas.toDataURL("image/png");
    const base64 = dataURL.split(",")[1];

    if (!base64) {
      throw new Error("Failed to extract base64 from canvas");
    }

    return this.predictRegions(base64);
  }

  /**
   * Predict regions from image blob
   *
   * @param blob - Image blob
   * @returns Detected bounding boxes and image size
   * @throws Error if prediction fails
   */
  static async predictFromBlob(blob: Blob): Promise<PredictionResult> {
    // Convert blob to base64
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        "",
      ),
    );

    return this.predictRegions(base64);
  }
}
