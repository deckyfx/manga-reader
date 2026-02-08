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
  const syncTextOverlays = useStudioStore((s) => s.syncTextOverlays);

  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState("");

  const currentPage = pages[currentPageIndex];

  /**
   * Generate preview image for a region (reuse RegionListPanel logic)
   */
  const generatePreview = (
    obj: ExtendedRect | ExtendedEllipse | ExtendedPolygon,
  ): string | null => {
    try {
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
    } catch (error) {
      console.error("Failed to generate preview:", error);
      return null;
    }
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
   * Process all regions with OCR + Translation
   */
  const handleOCR = async () => {
    if (!fabricCanvas || !currentPage) return;

    setIsProcessing(true);

    try {
      const regionsWithPreview = extractRegionsWithPreview();

      if (regionsWithPreview.length === 0) {
        alert(
          "No mask regions found. Draw rectangles, ovals, or polygons first.",
        );
        return;
      }

      setStatus(`Processing ${regionsWithPreview.length} region(s)...`);

      // Call batch OCR API with all regions at once
      const response = await api.api.studio["ocr-batch"].post({
        pageId: currentPage.id,
        regions: regionsWithPreview.map((item) => ({
          id: item.id,
          capturedImage: item.preview,
          region: item.region,
        })),
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

      // Note: Text overlays are now created manually via "Create Text Object" button in region list

      setStatus(`Completed ${regionsWithPreview.length} region(s)!`);
      setTimeout(() => setStatus(""), 3000);
    } catch (error) {
      console.error("OCR Error:", error);
      alert(
        `OCR failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const canProcess = fabricCanvas && currentPage && !isProcessing;

  return (
    <div className="flex flex-col gap-2">
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
  );
}
