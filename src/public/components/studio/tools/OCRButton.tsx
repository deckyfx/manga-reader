import React, { useState } from "react";
import { useStudioStore } from "../../../stores/studioFabricStore";
import { api } from "../../../lib/api";
import type { Region } from "../../../../lib/region-types";
import type {
  ExtendedRect,
  ExtendedEllipse,
  ExtendedPolygon,
} from "../../../types/fabric-extensions";
import { FabricImage } from "fabric";
import { useSnackbar } from "../../../hooks/useSnackbar";
import { catchError, catchErrorSync } from "../../../../lib/error-handler";

/**
 * OCR Button Component
 *
 * Triggers OCR + Translation workflow for all mask regions:
 * 1. Find all mask objects (rectangle, oval, polygon) with preview images
 * 2. Call batch OCR API with all regions at once
 * 3. Store OCR results directly in mask object's data field
 * 4. Update region list automatically
 */
export function OCRButton() {
  const fabricCanvas = useStudioStore((s) => s.fabricCanvas);
  const pages = useStudioStore((s) => s.pages);
  const currentPageIndex = useStudioStore((s) => s.currentPageIndex);
  const setImageSrc = useStudioStore((s) => s.setImageSrc);
  const setImageLoaded = useStudioStore((s) => s.setImageLoaded);
  const clearHistory = useStudioStore((s) => s.clearHistory);
  const { showSnackbar, SnackbarComponent } = useSnackbar();

  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState("");
  const [withCleaning, setWithCleaning] = useState(false); // Default: no cleaning

  const currentPage = pages[currentPageIndex];

  /**
   * Generate preview image for a region (reuse RegionListPanel logic)
   */
  const generatePreview = (
    obj: ExtendedRect | ExtendedEllipse | ExtendedPolygon,
  ): string | null => {
    const [error, result] = catchErrorSync(() => {
      if (!fabricCanvas) return null;

      // Get background image from canvas objects
      const objects = fabricCanvas.getObjects();
      const bgImage = objects.find((o) => o.type === "image");
      if (!bgImage) return null;

      // Calculate bounds based on object type
      let bounds: { left: number; top: number; width: number; height: number };

      if (obj.type === "rect") {
        const rect = obj as ExtendedRect;
        bounds = {
          left: rect.left || 0,
          top: rect.top || 0,
          width: (rect.width || 0) * (rect.scaleX || 1),
          height: (rect.height || 0) * (rect.scaleY || 1),
        };
      } else if (obj.type === "ellipse") {
        const ellipse = obj as ExtendedEllipse;
        const rx = (ellipse.rx || 0) * (ellipse.scaleX || 1);
        const ry = (ellipse.ry || 0) * (ellipse.scaleY || 1);
        bounds = {
          left: (ellipse.left || 0) - rx,
          top: (ellipse.top || 0) - ry,
          width: rx * 2,
          height: ry * 2,
        };
      } else if (obj.type === "polygon") {
        bounds = obj.getBoundingRect();
      } else {
        return null;
      }

      // Create off-screen canvas
      const canvas = document.createElement("canvas");
      canvas.width = bounds.width;
      canvas.height = bounds.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      if (!(bgImage instanceof FabricImage)) return null;

      // Get image element
      const img = bgImage._element || bgImage._originalElement;
      if (!img) return null;

      // Draw cropped region
      ctx.drawImage(
        img,
        bounds.left,
        bounds.top,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height,
      );

      return canvas.toDataURL("image/png");
    });

    if (error) {
      console.error("Failed to generate preview:", error);
      return null;
    }

    return result;
  };

  /**
   * Extract region data with preview from Fabric.js objects
   */
  const extractRegionsWithPreview = (): Array<{
    id: string;
    obj: ExtendedRect | ExtendedEllipse | ExtendedPolygon;
    region: Region;
    preview: string;
  }> => {
    if (!fabricCanvas) return [];

    const results = [];
    const objects = fabricCanvas.getObjects();

    for (const obj of objects) {
      // Skip non-mask objects
      if (
        obj.type !== "rect" &&
        obj.type !== "ellipse" &&
        obj.type !== "polygon"
      ) {
        continue;
      }

      const maskObj = obj as ExtendedRect | ExtendedEllipse | ExtendedPolygon;

      // Skip if not a mask (check data.type)
      if (maskObj.data?.type !== "mask") continue;

      // Skip if already cleaned (prevent re-OCR on cleaned regions)
      if (maskObj.data?.cleaned) continue;

      // Generate region data
      let region: Region;

      if (obj.type === "rect") {
        const rect = obj as ExtendedRect;
        region = {
          shape: "rectangle",
          data: {
            x: rect.left || 0,
            y: rect.top || 0,
            width: (rect.width || 0) * (rect.scaleX || 1),
            height: (rect.height || 0) * (rect.scaleY || 1),
          },
        };
      } else if (obj.type === "ellipse") {
        const ellipse = obj as ExtendedEllipse;
        const rx = (ellipse.rx || 0) * (ellipse.scaleX || 1);
        const ry = (ellipse.ry || 0) * (ellipse.scaleY || 1);
        region = {
          shape: "oval",
          data: {
            x: (ellipse.left || 0) - rx,
            y: (ellipse.top || 0) - ry,
            width: rx * 2,
            height: ry * 2,
          },
        };
      } else if (obj.type === "polygon") {
        const polygon = obj as ExtendedPolygon;
        const points = polygon.points || [];

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const pt of points) {
          minX = Math.min(minX, pt.x);
          minY = Math.min(minY, pt.y);
          maxX = Math.max(maxX, pt.x);
          maxY = Math.max(maxY, pt.y);
        }

        const left = polygon.left || 0;
        const top = polygon.top || 0;
        const scaleX = polygon.scaleX || 1;
        const scaleY = polygon.scaleY || 1;

        const transformedPoints = points.map((pt) => ({
          x: left + pt.x * scaleX,
          y: top + pt.y * scaleY,
        }));

        region = {
          shape: "polygon",
          data: {
            x: minX * scaleX + left,
            y: minY * scaleY + top,
            width: (maxX - minX) * scaleX,
            height: (maxY - minY) * scaleY,
            points: transformedPoints,
          },
        };
      } else {
        continue;
      }

      // Generate preview
      const preview = generatePreview(maskObj);
      if (!preview) {
        console.error("Failed to generate preview for region");
        continue;
      }

      results.push({
        id: maskObj.id || `region-${results.length}`,
        obj: maskObj,
        region,
        preview,
      });
    }

    return results;
  };

  /**
   * Generate mask image from all regions (for cleaning)
   */
  const generateMaskImage = (
    regions: Array<{
      obj: ExtendedRect | ExtendedEllipse | ExtendedPolygon;
    }>,
  ): string | null => {
    const [error, result] = catchErrorSync(() => {
      if (!fabricCanvas) return null;

      // Get background image dimensions
      const objects = fabricCanvas.getObjects();
      const bgImage = objects.find((o) => o.type === "image");
      if (!bgImage || !(bgImage instanceof FabricImage)) return null;

      const img = bgImage._element || bgImage._originalElement;
      if (!img) return null;

      // Create mask canvas (same size as image)
      const maskCanvas = document.createElement("canvas");
      const width =
        "naturalWidth" in img && typeof img.naturalWidth === "number"
          ? img.naturalWidth
          : img.width;
      const height =
        "naturalHeight" in img && typeof img.naturalHeight === "number"
          ? img.naturalHeight
          : img.height;
      maskCanvas.width = width;
      maskCanvas.height = height;
      const ctx = maskCanvas.getContext("2d");
      if (!ctx) return null;

      // Fill with black (preserve everything by default)
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

      // Draw white regions (areas to inpaint)
      ctx.fillStyle = "white";

      for (const { obj } of regions) {
        if (obj.type === "rect") {
          const rect = obj as ExtendedRect;
          ctx.fillRect(
            rect.left || 0,
            rect.top || 0,
            (rect.width || 0) * (rect.scaleX || 1),
            (rect.height || 0) * (rect.scaleY || 1),
          );
        } else if (obj.type === "ellipse") {
          const ellipse = obj as ExtendedEllipse;
          const rx = (ellipse.rx || 0) * (ellipse.scaleX || 1);
          const ry = (ellipse.ry || 0) * (ellipse.scaleY || 1);
          const cx = (ellipse.left || 0);
          const cy = (ellipse.top || 0);

          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
          ctx.fill();
        } else if (obj.type === "polygon") {
          const polygon = obj as ExtendedPolygon;
          const points = polygon.points || [];

          if (points.length > 0) {
            const left = polygon.left || 0;
            const top = polygon.top || 0;
            const scaleX = polygon.scaleX || 1;
            const scaleY = polygon.scaleY || 1;

            ctx.beginPath();
            const firstPoint = points[0];
            if (firstPoint) {
              ctx.moveTo(
                left + firstPoint.x * scaleX,
                top + firstPoint.y * scaleY,
              );

              for (let i = 1; i < points.length; i++) {
                const pt = points[i];
                if (pt) {
                  ctx.lineTo(left + pt.x * scaleX, top + pt.y * scaleY);
                }
              }

              ctx.closePath();
              ctx.fill();
            }
          }
        }
      }

      return maskCanvas.toDataURL("image/png");
    });

    if (error) {
      console.error("Failed to generate mask:", error);
      return null;
    }

    return result;
  };

  /**
   * Process all regions with OCR + Translation
   */
  const handleOCR = async () => {
    if (!fabricCanvas || !currentPage) return;

    setIsProcessing(true);

    const [error] = await catchError((async () => {
      const regionsWithPreview = extractRegionsWithPreview();

      if (regionsWithPreview.length === 0) {
        showSnackbar(
          "No mask regions found. Draw rectangles, ovals, or polygons first.",
          "warning"
        );
        return;
      }

      setStatus(
        `Processing ${regionsWithPreview.length} region(s)${withCleaning ? " + cleaning" : ""}...`,
      );

      // Generate mask if cleaning is enabled
      let maskImageBase64: string | undefined;
      if (withCleaning) {
        const mask = generateMaskImage(regionsWithPreview);
        if (!mask) {
          showSnackbar("Failed to generate cleaning mask", "error");
          return;
        }
        maskImageBase64 = mask;
      }

      // Call batch OCR API with all regions at once
      const response = await api.api.studio["ocr-batch"].post({
        pageId: currentPage.id,
        regions: regionsWithPreview.map((item) => ({
          id: item.id,
          capturedImage: item.preview,
          region: item.region,
        })),
        withCleaning,
        maskImageBase64,
      });

      if (!response.data || !response.data.success) {
        throw new Error("Batch OCR request failed");
      }

      const { results } = response.data;

      // Store OCR results in mask object's data field
      for (const result of results) {
        const item = regionsWithPreview.find((r) => r.id === result.id);
        if (!item) continue;

        if (result.success) {
          // Update mask object with OCR data
          if (!item.obj.data) {
            item.obj.data = { type: "mask" };
          }
          item.obj.data.originalText = result.rawText ?? undefined;
          item.obj.data.translatedText = result.translatedText ?? undefined;
          item.obj.data.captionSlug = result.captionSlug ?? undefined;

          // Mark as cleaned if cleaning was performed
          if (withCleaning && response.data.cleaned) {
            item.obj.data.cleaned = true;
          }
        } else {
          console.error(`OCR failed for region ${result.id}:`, result.error);
        }
      }

      // Trigger canvas update to refresh region list
      fabricCanvas.renderAll();

      // Fire update event to refresh region list
      for (const result of results) {
        const item = regionsWithPreview.find((r) => r.id === result.id);
        if (item) {
          fabricCanvas.fire("object:modified", { target: item.obj });
        }
      }

      // If cleaning was performed, reload the page image
      if (withCleaning && response.data.cleaned) {
        setStatus("Reloading cleaned image...");

        // Save regions to preserve (all objects except brush strokes and image)
        const objects = fabricCanvas.getObjects();
        const regionsToPreserve = objects.filter(
          (obj) =>
            obj.type !== "path" && // Remove brush strokes
            obj.type !== "image" && // Remove old image (will be reloaded)
            (obj.type === "rect" ||
              obj.type === "ellipse" ||
              obj.type === "polygon" ||
              obj.type === "textbox"),
        );

        // Clear history
        clearHistory();

        // Reload page image with cache-busting parameter (same as inpaint)
        const timestamp = Date.now();
        const newImageSrc = `${currentPage.originalImage}?t=${timestamp}`;
        setImageSrc(newImageSrc);
        setImageLoaded(false);

        // Force reload and restore regions after image loads
        setTimeout(() => {
          setImageLoaded(true);

          // Re-add preserved regions after image loads
          setTimeout(() => {
            regionsToPreserve.forEach((obj) => fabricCanvas.add(obj));
            fabricCanvas.renderAll();
            setStatus(`Completed ${regionsWithPreview.length} region(s)!`);
            setTimeout(() => setStatus(""), 3000);
          }, 50);
        }, 100);
      } else {
        setStatus(`Completed ${regionsWithPreview.length} region(s)!`);
        setTimeout(() => setStatus(""), 3000);
      }

      // Note: Text overlays are now created manually via "Create Text Object" button in region list
    })());

    if (error) {
      console.error("OCR Error:", error);
      showSnackbar(
        `OCR failed: ${error instanceof Error ? error.message : String(error)}`,
        "error"
      );
    }

    setIsProcessing(false);
  };

  const canProcess = fabricCanvas && currentPage && !isProcessing;

  return (
    <>
      {SnackbarComponent}
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={withCleaning}
            onChange={(e) => setWithCleaning(e.target.checked)}
            disabled={isProcessing}
            className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-pink-500 focus:ring-pink-500 focus:ring-offset-gray-800"
          />
          <span>Clean text after OCR</span>
        </label>

        <button
          onClick={handleOCR}
          disabled={!canProcess}
          className={`px-4 py-2 rounded text-white font-medium ${
            canProcess
              ? "bg-green-600 hover:bg-green-700"
              : "bg-gray-400 cursor-not-allowed"
          }`}
        >
          {isProcessing ? "Processing..." : "OCR & Translate"}
        </button>

        {status && (
          <div className="text-sm text-gray-300 text-center">{status}</div>
        )}
      </div>
    </>
  );
}
