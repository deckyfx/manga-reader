import { MangaOCRAPI } from "./MangaOCRAPI";
import { catchError } from "../lib/error-handler";

/**
 * CleaningService - Image cleaning and inpainting service
 *
 * Service layer for text removal and image inpainting using AnimeLaMa.
 * Wraps MangaOCRAPI inpaint-mask endpoint.
 *
 * @example
 * ```typescript
 * // Clean text from image using mask
 * const [error, cleanedImage] = await catchError(
 *   CleaningService.inpaintWithMask(imageBlob, maskBlob)
 * );
 *
 * if (error) {
 *   console.error("Cleaning failed:", error);
 *   return;
 * }
 *
 * // cleanedImage is base64 with data:image/png;base64, prefix
 * ```
 */
export class CleaningService {
  /**
   * Inpaint page using binary mask
   *
   * Binary mask format:
   * - White pixels (255,255,255) = areas to inpaint (remove text)
   * - Black pixels (0,0,0) = areas to preserve
   *
   * @param imageBlob - Original page image
   * @param maskBlob - Binary mask PNG
   * @returns Base64 encoded cleaned image with data:image/png;base64, prefix
   * @throws Error if inpainting fails
   */
  static async inpaintWithMask(
    imageBlob: Blob,
    maskBlob: Blob,
  ): Promise<string> {
    return MangaOCRAPI.inpaintMask(imageBlob, maskBlob);
  }

  /**
   * Create binary mask from canvas regions
   *
   * @param canvas - Canvas with image
   * @param regions - Array of regions to mask (white areas to inpaint)
   * @returns Mask blob (white=inpaint, black=preserve)
   */
  static createMaskFromRegions(
    canvas: HTMLCanvasElement,
    regions: Array<{
      type: "rectangle" | "ellipse" | "polygon";
      bounds: { left: number; top: number; width: number; height: number };
      points?: Array<{ x: number; y: number }>;
    }>,
  ): Promise<Blob> {
    // Create mask canvas (same size as image)
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    const ctx = maskCanvas.getContext("2d");

    if (!ctx) {
      throw new Error("Failed to get 2D context for mask canvas");
    }

    // Fill with black (preserve everything by default)
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

    // Draw white regions (areas to inpaint)
    ctx.fillStyle = "white";

    for (const region of regions) {
      if (region.type === "rectangle") {
        ctx.fillRect(
          region.bounds.left,
          region.bounds.top,
          region.bounds.width,
          region.bounds.height,
        );
      } else if (region.type === "ellipse") {
        const cx = region.bounds.left + region.bounds.width / 2;
        const cy = region.bounds.top + region.bounds.height / 2;
        const rx = region.bounds.width / 2;
        const ry = region.bounds.height / 2;

        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
        ctx.fill();
      } else if (region.type === "polygon" && region.points) {
        ctx.beginPath();
        const firstPoint = region.points[0];
        if (firstPoint) {
          ctx.moveTo(firstPoint.x, firstPoint.y);
          for (let i = 1; i < region.points.length; i++) {
            const point = region.points[i];
            if (point) {
              ctx.lineTo(point.x, point.y);
            }
          }
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // Convert to blob
    return new Promise<Blob>((resolve, reject) => {
      maskCanvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to create mask blob"));
        }
      }, "image/png");
    });
  }

  /**
   * Clean multiple regions from image
   *
   * @param imageBlob - Original page image
   * @param canvas - Canvas with image (for creating mask)
   * @param regions - Regions to clean
   * @returns Base64 encoded cleaned image
   * @throws Error if cleaning fails
   */
  static async cleanRegions(
    imageBlob: Blob,
    canvas: HTMLCanvasElement,
    regions: Array<{
      type: "rectangle" | "ellipse" | "polygon";
      bounds: { left: number; top: number; width: number; height: number };
      points?: Array<{ x: number; y: number }>;
    }>,
  ): Promise<string> {
    // Create mask from regions
    const maskBlob = await this.createMaskFromRegions(canvas, regions);

    // Inpaint using mask
    return this.inpaintWithMask(imageBlob, maskBlob);
  }
}
