import React, { useState, useEffect } from "react";
import { useStudioStore } from "../../stores/studioFabricStore";
import type { Region } from "../../../lib/region-types";
import {
  FabricImage,
  type FabricObject,
  type TEvent,
  type TPointerEvent,
} from "fabric";
import type {
  ExtendedTextbox,
  ExtendedRect,
  ExtendedEllipse,
  ExtendedPolygon,
} from "../../types/fabric-extensions";
import { api } from "../../lib/api";
import { useSnackbar } from "../../hooks/useSnackbar";
import { RegionListItem } from "./RegionListItem";
import { AddAllTextsButton } from "./AddAllTextsButton";
import { catchErrorSync, catchError } from "../../../lib/error-handler";

type SelectionEvent = Partial<TEvent<TPointerEvent>> & {
  selected: FabricObject[];
};

type ExtendedFabricObject =
  | ExtendedTextbox
  | ExtendedRect
  | ExtendedEllipse
  | ExtendedPolygon;

interface RegionItem {
  id: string;
  type: "rectangle" | "oval" | "polygon";
  region?: Region;
  fabricObject: FabricObject;
  preview?: string; // Base64 preview image
  originalText?: string; // OCR extracted text
  translatedText?: string; // Translated text
}

/**
 * RegionListPanel - Shows list of all regions on canvas
 *
 * Features:
 * - Lists all mask regions (rectangle, oval, polygon)
 * - Preview thumbnails
 * - Click to select region on canvas
 * - Embedded text editing controls for each region
 * - Manual "Create Text Object" button
 * - Delete region button
 */
export function RegionListPanel() {
  const fabricCanvas = useStudioStore((s) => s.fabricCanvas);
  const pages = useStudioStore((s) => s.pages);
  const currentPageIndex = useStudioStore((s) => s.currentPageIndex);
  const { showSnackbar, SnackbarComponent } = useSnackbar();
  const [regions, setRegions] = useState<RegionItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [processingRegion, setProcessingRegion] = useState<string | null>(null);

  const currentPage = pages[currentPageIndex];

  /**
   * Generate preview image for a mask region (cropped from background)
   */
  const generatePreview = (obj: FabricObject): string | undefined => {
    const [error, result] = catchErrorSync(() => {
      if (!fabricCanvas) {
        console.log("No canvas");
        return undefined;
      }

      // Get background image from canvas objects (it's the first object)
      const objects = fabricCanvas.getObjects();
      const bgImage = objects.find((o) => o.type === "image");

      if (!bgImage || !(bgImage instanceof FabricImage)) {
        console.log("No background image found in canvas objects");
        return undefined;
      }

      // Calculate correct bounds based on object type
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
        // Fallback to getBoundingRect for other types
        bounds = obj.getBoundingRect();
      }

      // Create off-screen canvas for preview
      const canvas = document.createElement("canvas");
      const previewSize = 80; // Preview size in pixels
      canvas.width = previewSize;
      canvas.height = previewSize;
      const ctx = canvas.getContext("2d");
      if (!ctx) return undefined;

      // Calculate scale to fit preview
      const scale = Math.min(
        previewSize / bounds.width,
        previewSize / bounds.height,
      );

      // Draw white background
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, previewSize, previewSize);

      // Get the image element from FabricImage
      const img =
        bgImage._element ||
        bgImage._originalElement ||
        bgImage.getElement?.() ||
        bgImage;

      const sx = bounds.left;
      const sy = bounds.top;
      const sw = bounds.width;
      const sh = bounds.height;
      const dx = previewSize / 2 - (bounds.width * scale) / 2;
      const dy = previewSize / 2 - (bounds.height * scale) / 2;
      const dw = bounds.width * scale;
      const dh = bounds.height * scale;

      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);

      return canvas.toDataURL("image/png");
    });

    if (error) {
      console.error("Failed to generate preview:", error);
      return undefined;
    }

    return result;
  };

  /**
   * Extract regions from Fabric.js canvas
   */
  const updateRegionList = () => {
    if (!fabricCanvas) {
      setRegions([]);
      return;
    }

    const items: RegionItem[] = [];
    const objects = fabricCanvas.getObjects();

    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      if (!obj) continue;

      // Skip background image
      if (obj === fabricCanvas.backgroundImage) continue;

      const extObj = obj as ExtendedFabricObject;

      // Skip objects that are currently being drawn
      if (extObj._isDrawing) {
        continue;
      }
      const id = extObj.id || `obj-${i}`;

      // Skip textbox objects (we don't use separate text patches anymore)
      if (obj.type === "textbox") {
        continue;
      }

      // Rectangle masks
      if (obj.type === "rect") {
        const rect = obj as ExtendedRect;
        items.push({
          id,
          type: "rectangle",
          region: {
            shape: "rectangle",
            data: {
              x: rect.left || 0,
              y: rect.top || 0,
              width: rect.width * (rect.scaleX || 1),
              height: rect.height * (rect.scaleY || 1),
            },
          },
          fabricObject: obj,
          preview: generatePreview(obj),
          originalText: rect.data?.originalText,
          translatedText: rect.data?.translatedText,
        });
      }

      // Oval masks
      if (obj.type === "ellipse") {
        const ellipse = obj as ExtendedEllipse;
        const rx = (ellipse.rx || 50) * (ellipse.scaleX || 1);
        const ry = (ellipse.ry || 50) * (ellipse.scaleY || 1);

        items.push({
          id,
          type: "oval",
          region: {
            shape: "oval",
            data: {
              x: (ellipse.left || 0) - rx,
              y: (ellipse.top || 0) - ry,
              width: rx * 2,
              height: ry * 2,
            },
          },
          fabricObject: obj,
          preview: generatePreview(obj),
          originalText: ellipse.data?.originalText,
          translatedText: ellipse.data?.translatedText,
        });
      }

      // Polygon masks
      if (obj.type === "polygon") {
        const polygon = obj as ExtendedPolygon;
        const points = polygon.points || [];

        // Calculate bounding box
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

        items.push({
          id,
          type: "polygon",
          region: {
            shape: "polygon",
            data: {
              x: minX * scaleX + left,
              y: minY * scaleY + top,
              width: (maxX - minX) * scaleX,
              height: (maxY - minY) * scaleY,
              points: transformedPoints,
            },
          },
          fabricObject: obj,
          preview: generatePreview(obj),
          originalText: polygon.data?.originalText,
          translatedText: polygon.data?.translatedText,
        });
      }
    }

    setRegions(items);
  };

  /**
   * Listen to canvas changes
   */
  useEffect(() => {
    if (!fabricCanvas) return;

    // Update list on canvas events (with slight delay for rendering)
    const handleUpdate = () => {
      requestAnimationFrame(() => {
        updateRegionList();
      });
    };

    fabricCanvas.on("object:added", handleUpdate);
    fabricCanvas.on("object:removed", handleUpdate);
    fabricCanvas.on("object:modified", handleUpdate);

    // Initial load
    updateRegionList();

    return () => {
      fabricCanvas.off("object:added", handleUpdate);
      fabricCanvas.off("object:removed", handleUpdate);
      fabricCanvas.off("object:modified", handleUpdate);
    };
  }, [fabricCanvas]);

  /**
   * Listen to selection changes
   */
  useEffect(() => {
    if (!fabricCanvas) return;

    const handleSelection = (e: SelectionEvent) => {
      const obj = e.selected?.[0];
      if (obj) {
        const extObj = obj as ExtendedFabricObject;
        const id = extObj.id || findObjectId(obj);
        setSelectedId(id);
      }
    };

    const handleClear = () => {
      setSelectedId(null);
    };

    fabricCanvas.on("selection:created", handleSelection);
    fabricCanvas.on("selection:updated", handleSelection);
    fabricCanvas.on("selection:cleared", handleClear);

    return () => {
      fabricCanvas.off("selection:created", handleSelection);
      fabricCanvas.off("selection:updated", handleSelection);
      fabricCanvas.off("selection:cleared", handleClear);
    };
  }, [fabricCanvas]);

  /**
   * Find object ID from fabricObject
   */
  const findObjectId = (fabricObj: FabricObject): string | null => {
    for (const item of regions) {
      if (item.fabricObject === fabricObj) {
        return item.id;
      }
    }
    return null;
  };

  /**
   * Select region on canvas
   */
  const selectRegion = (item: RegionItem) => {
    if (!fabricCanvas) return;
    fabricCanvas.setActiveObject(item.fabricObject);
    fabricCanvas.renderAll();
    setSelectedId(item.id);
  };

  /**
   * Delete region from canvas
   */
  const deleteRegion = (item: RegionItem) => {
    if (!fabricCanvas) return;
    fabricCanvas.remove(item.fabricObject);
    fabricCanvas.renderAll();
    updateRegionList();
  };

  /**
   * Update text in region's data
   */
  const updateRegionText = (
    item: RegionItem,
    field: "originalText" | "translatedText",
    value: string
  ) => {
    const extObj = item.fabricObject as ExtendedFabricObject;
    if (!extObj.data || extObj.data.type !== "mask") {
      extObj.data = { type: "mask" };
    }
    // Now TypeScript knows it's MaskData
    extObj.data[field] = value || undefined;
    updateRegionList();
  };

  /**
   * Generate preview image for OCR (full region crop)
   */
  const generateOCRPreview = (
    obj: FabricObject,
  ): string | null => {
    const [error, result] = catchErrorSync(() => {
      if (!fabricCanvas) return null;

      // Get background image from canvas objects
      const objects = fabricCanvas.getObjects();
      const bgImage = objects.find((o) => o.type === "image");
      if (!bgImage || !(bgImage instanceof FabricImage)) return null;

      // Calculate bounds
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
      } else {
        bounds = obj.getBoundingRect();
      }

      // Create off-screen canvas
      const canvas = document.createElement("canvas");
      canvas.width = bounds.width;
      canvas.height = bounds.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

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
      console.error("Failed to generate OCR preview:", error);
      return null;
    }

    return result;
  };

  /**
   * Toggle clean flag for a region
   */
  const toggleClean = (item: RegionItem) => {
    const extObj = item.fabricObject as ExtendedFabricObject;
    if (!extObj.data || extObj.data.type !== "mask") {
      extObj.data = { type: "mask" };
    }
    extObj.data.clean = !extObj.data.clean;
    updateRegionList();
  };

  /**
   * Run OCR on a single region
   */
  const runOCR = async (item: RegionItem) => {
    if (!fabricCanvas || !currentPage) return;

    const extObj = item.fabricObject as ExtendedFabricObject;
    setProcessingRegion(item.id);

    const [error] = await catchError((async () => {
      // Generate region preview
      const preview = generateOCRPreview(item.fabricObject);
      if (!preview) {
        showSnackbar("Failed to generate region preview", "error");
        return;
      }

      // Get clean flag from mask data
      const withCleaning =
        extObj.data?.type === "mask" ? extObj.data.clean || false : false;

      // Call batch OCR API with single region
      const response = await api.api.studio["ocr-batch"].post({
        pageId: currentPage.id,
        regions: [
          {
            id: item.id,
            capturedImage: preview,
            region: item.region!,
          },
        ],
        withCleaning,
      });

      if (!response.data || !response.data.success) {
        throw new Error("OCR request failed");
      }

      const result = response.data.results[0];
      if (result && result.success) {
        // Update mask object with OCR data
        if (!extObj.data || extObj.data.type !== "mask") {
          extObj.data = { type: "mask" };
        }
        // Eden Treaty infers the success type
        extObj.data.originalText = result.rawText ?? undefined;
        extObj.data.translatedText = result.translatedText ?? undefined;
        extObj.data.captionSlug = result.captionSlug ?? undefined;

        // Trigger canvas update
        fabricCanvas.renderAll();
        fabricCanvas.fire("object:modified", { target: extObj });
      } else {
        throw new Error(result?.error || "OCR failed");
      }
    })());

    if (error) {
      console.error("OCR Error:", error);
      showSnackbar(
        `OCR failed: ${error.message}`,
        "error"
      );
    }

    setProcessingRegion(null);
  };

  /**
   * Re-translate existing text
   */
  const runReTranslate = async (item: RegionItem) => {
    const extObj = item.fabricObject as ExtendedFabricObject;

    // Check if we have mask data
    if (!extObj.data || extObj.data.type !== "mask") {
      showSnackbar("Invalid region data", "error");
      return;
    }

    const captionSlug = extObj.data.captionSlug;
    const originalText = extObj.data.originalText;

    if (!originalText) {
      showSnackbar("No original text to translate. Run OCR first.", "warning");
      return;
    }

    if (!captionSlug) {
      showSnackbar("No caption found. Run OCR first to create a caption.", "warning");
      return;
    }

    if (!fabricCanvas) return;

    setProcessingRegion(item.id);

    const [error] = await catchError((async () => {
      // Call caption translate API
      const response = await api.api.studio.captions({ slug: captionSlug }).translate.post();

      if (!response.data) {
        throw new Error("No response data");
      }

      // Eden Treaty infers discriminated union: { success: true; ... } | { success: false; error: string }
      if (response.data.success === false) {
        throw new Error(response.data.error || "Translation failed");
      }

      // Update mask object with new translation
      // TypeScript narrows to success type after the check above
      if (extObj.data && extObj.data.type === "mask") {
        extObj.data.translatedText = response.data.translatedText ?? undefined;
      }

      // Trigger canvas update
      fabricCanvas.renderAll();
      fabricCanvas.fire("object:modified", { target: extObj });
    })());

    if (error) {
      console.error("Translation Error:", error);
      showSnackbar(
        `Translation failed: ${error.message}`,
        "error"
      );
    }

    setProcessingRegion(null);
  };


  return (
    <>
      {SnackbarComponent}
      <div className="flex flex-col overflow-hidden h-full">
        <div className="p-3 border-b border-gray-700">
          <h3 className="text-white text-sm font-semibold">Region List</h3>
          <p className="text-gray-400 text-xs mt-1">
            {regions.length} region{regions.length !== 1 ? "s" : ""} on canvas
          </p>
        </div>

      <div className="flex-1 overflow-y-auto">
        {regions.length > 0 && (
          <div className="p-4">
            {/* Add All Texts Button */}
            <div className="mb-4">
              <AddAllTextsButton />
            </div>

            {/* Region List */}
            <div className="space-y-2">
              {regions.map((item, index) => (
                <RegionListItem
                  key={item.id}
                  item={item}
                  index={index}
                  isSelected={selectedId === item.id}
                  isProcessing={processingRegion === item.id}
                  onSelect={selectRegion}
                  onDelete={deleteRegion}
                  onToggleClean={toggleClean}
                  onRunOCR={runOCR}
                  onRunReTranslate={runReTranslate}
                  onUpdateText={updateRegionText}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {regions.length === 0 && (
          <div className="p-8 text-center">
            <svg
              className="w-12 h-12 mx-auto text-gray-600 mb-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16m-7 6h7"
              />
            </svg>
            <p className="text-gray-400 text-sm">No regions yet</p>
            <p className="text-gray-500 text-xs mt-1">
              Draw rectangles, ovals, or polygons to get started
            </p>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
