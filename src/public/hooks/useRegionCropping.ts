import { useCallback } from "react";
import { FabricImage, type Canvas } from "fabric";
import type { Region, BoundingBox } from "../../lib/region-types";
import {
  getRegionBounds,
  getRegionPolygonPoints,
} from "../../lib/region-types";

/**
 * Hook for cropping region images from Fabric.js canvas for OCR submission
 *
 * Handles all three region types:
 * - Rectangle: simple bounding box crop
 * - Oval: elliptical clipping path
 * - Polygon: polygon clipping path
 *
 * Returns base64 PNG string for API submission.
 */
export function useRegionCropping(canvas: Canvas | null) {
  /**
   * Crop a rectangle region from the canvas
   */
  const cropRectangle = useCallback(
    (bounds: BoundingBox): string | null => {
      if (!canvas) return null;

      // Get background image (the page image)
      const bgImage = canvas.backgroundImage;
      if (!bgImage || bgImage.type !== "image") return null;

      if (!(bgImage instanceof FabricImage)) return null;

      const img = bgImage;
      if (!img._element) return null;

      // Create off-screen canvas at region size
      const offCanvas = document.createElement("canvas");
      offCanvas.width = bounds.width;
      offCanvas.height = bounds.height;
      const ctx = offCanvas.getContext("2d");
      if (!ctx) return null;

      // Draw cropped portion of background image
      ctx.drawImage(
        img._element,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height,
      );

      // Return base64 PNG
      return offCanvas.toDataURL("image/png");
    },
    [canvas],
  );

  /**
   * Crop an oval region from the canvas with elliptical clipping
   */
  const cropOval = useCallback(
    (bounds: BoundingBox): string | null => {
      if (!canvas) return null;

      // Get background image
      const bgImage = canvas.backgroundImage;
      if (!bgImage || bgImage.type !== "image") return null;

      if (!(bgImage instanceof FabricImage)) return null;

      const img = bgImage;
      if (!img._element) return null;

      // Create off-screen canvas at region size
      const offCanvas = document.createElement("canvas");
      offCanvas.width = bounds.width;
      offCanvas.height = bounds.height;
      const ctx = offCanvas.getContext("2d");
      if (!ctx) return null;

      // Create elliptical clipping path
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(
        bounds.width / 2,
        bounds.height / 2,
        bounds.width / 2,
        bounds.height / 2,
        0,
        0,
        2 * Math.PI,
      );
      ctx.clip();

      // Draw background image within clipped region
      ctx.drawImage(
        img._element,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height,
      );

      ctx.restore();

      // Return base64 PNG
      return offCanvas.toDataURL("image/png");
    },
    [canvas],
  );

  /**
   * Crop a polygon region from the canvas with polygon clipping
   */
  const cropPolygon = useCallback(
    (
      bounds: BoundingBox,
      points: { x: number; y: number }[],
    ): string | null => {
      if (!canvas) return null;

      // Get background image
      const bgImage = canvas.backgroundImage;
      if (!bgImage || bgImage.type !== "image") return null;

      if (!(bgImage instanceof FabricImage)) return null;

      const img = bgImage;
      if (!img._element) return null;

      // Create off-screen canvas at region size
      const offCanvas = document.createElement("canvas");
      offCanvas.width = bounds.width;
      offCanvas.height = bounds.height;
      const ctx = offCanvas.getContext("2d");
      if (!ctx) return null;

      // Translate points to local coords (subtract bounds.x/y)
      const localPoints = points.map((p) => ({
        x: p.x - bounds.x,
        y: p.y - bounds.y,
      }));

      // Create polygon clipping path
      ctx.save();
      ctx.beginPath();
      if (localPoints.length > 0) {
        const first = localPoints[0];
        if (first) {
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i < localPoints.length; i++) {
            const pt = localPoints[i];
            if (pt) {
              ctx.lineTo(pt.x, pt.y);
            }
          }
          ctx.closePath();
        }
      }
      ctx.clip();

      // Draw background image within clipped region
      ctx.drawImage(
        img._element,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height,
      );

      ctx.restore();

      // Return base64 PNG
      return offCanvas.toDataURL("image/png");
    },
    [canvas],
  );

  /**
   * Crop a region image based on its shape type
   *
   * @param region - Region to crop
   * @returns Base64 PNG string or null if failed
   */
  const cropRegion = useCallback(
    (region: Region): string | null => {
      const bounds = getRegionBounds(region);

      switch (region.shape) {
        case "rectangle":
          return cropRectangle(bounds);

        case "oval":
          return cropOval(bounds);

        case "polygon": {
          const points = getRegionPolygonPoints(region);
          if (!points) return null;
          return cropPolygon(bounds, points);
        }

        default:
          return null;
      }
    },
    [cropRectangle, cropOval, cropPolygon],
  );

  return { cropRegion };
}
