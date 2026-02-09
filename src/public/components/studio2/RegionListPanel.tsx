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
  const syncTextOverlays = useStudioStore((s) => s.syncTextOverlays);
  const pages = useStudioStore((s) => s.pages);
  const currentPageIndex = useStudioStore((s) => s.currentPageIndex);
  const [regions, setRegions] = useState<RegionItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [processingRegion, setProcessingRegion] = useState<string | null>(null);

  const currentPage = pages[currentPageIndex];

  /**
   * Generate preview image for a mask region (cropped from background)
   */
  const generatePreview = (obj: FabricObject): string | undefined => {
    try {
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
    } catch (error) {
      console.error("Failed to generate preview:", error);
      return undefined;
    }
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
    try {
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
    } catch (error) {
      console.error("Failed to generate OCR preview:", error);
      return null;
    }
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

    try {
      // Generate region preview
      const preview = generateOCRPreview(item.fabricObject);
      if (!preview) {
        alert("Failed to generate region preview");
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
        extObj.data.originalText = result.rawText ?? undefined;
        extObj.data.translatedText = result.translatedText ?? undefined;
        extObj.data.captionSlug = result.captionSlug ?? undefined;

        // Trigger canvas update
        fabricCanvas.renderAll();
        fabricCanvas.fire("object:modified", { target: extObj });
      } else {
        throw new Error(result?.error || "OCR failed");
      }
    } catch (error) {
      console.error("OCR Error:", error);
      alert(
        `OCR failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setProcessingRegion(null);
    }
  };

  /**
   * Re-translate existing text
   */
  const runReTranslate = async (item: RegionItem) => {
    const extObj = item.fabricObject as ExtendedFabricObject;

    // Check if we have mask data
    if (!extObj.data || extObj.data.type !== "mask") {
      alert("Invalid region data");
      return;
    }

    const captionSlug = extObj.data.captionSlug;
    const originalText = extObj.data.originalText;

    if (!originalText) {
      alert("No original text to translate. Run OCR first.");
      return;
    }

    if (!captionSlug) {
      alert("No caption found. Run OCR first to create a caption.");
      return;
    }

    if (!fabricCanvas) return;

    setProcessingRegion(item.id);

    try {
      // Call caption translate API
      const response = await api.api.studio.captions({ slug: captionSlug }).translate.post();

      if (!response.data) {
        throw new Error("No response data");
      }

      if (!response.data.success) {
        throw new Error(response.data.error || "Translation failed");
      }

      // Update mask object with new translation
      // TypeScript knows response.data.success is true here
      if ("translatedText" in response.data) {
        const text = response.data.translatedText;
        extObj.data.translatedText =
          typeof text === "string" ? text : undefined;
      }

      // Trigger canvas update
      fabricCanvas.renderAll();
      fabricCanvas.fire("object:modified", { target: extObj });
    } catch (error) {
      console.error("Translation Error:", error);
      alert(
        `Translation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setProcessingRegion(null);
    }
  };

  /**
   * Create text object for a specific region
   * Creates independent text object and removes the region
   */
  const createTextObject = (item: RegionItem) => {
    if (!fabricCanvas) return;
    const extObj = item.fabricObject as ExtendedFabricObject;

    // Ensure the region has translated text and is a mask
    if (!extObj.data || extObj.data.type !== "mask" || !extObj.data.translatedText) {
      alert("No translated text available. Run OCR first or enter text manually.");
      return;
    }

    // Set default font size to 16 if not already set
    if (!extObj.data.customFontSize) {
      extObj.data.customFontSize = 16;
    }

    // Store originalText in mask data before creating text object
    // This will be copied to the textbox in syncTextOverlays
    if (!extObj.data.originalText && item.originalText) {
      extObj.data.originalText = item.originalText;
    }

    // Call syncTextOverlays to create/update text overlays for all regions
    // This will create text overlay for regions that have translatedText
    syncTextOverlays();

    // Remove the region after creating text object (make text independent)
    fabricCanvas.remove(item.fabricObject);

    fabricCanvas.renderAll();
    updateRegionList();
  };

  return (
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
            <div className="space-y-2">
              {regions.map((item, index) => {
                const hasText = item.originalText || item.translatedText;
                const extObj = item.fabricObject as ExtendedFabricObject;
                const cleanEnabled =
                  extObj.data?.type === "mask" ? extObj.data.clean || false : false;
                const isProcessing = processingRegion === item.id;

                return (
                  <div
                    key={item.id}
                    className={`p-3 rounded-lg transition-colors ${
                      selectedId === item.id
                        ? "bg-blue-600/50"
                        : "bg-gray-700 hover:bg-gray-650"
                    }`}
                  >
                    {/* Header: Preview, Name, Delete */}
                    <div className="flex items-center justify-between mb-2">
                      <div
                        className="flex items-center gap-3 flex-1 cursor-pointer"
                        onClick={() => selectRegion(item)}
                      >
                        {/* Preview image */}
                        {item.preview && (
                          <img
                            src={item.preview}
                            alt={`${item.type} preview`}
                            className="w-12 h-12 object-contain bg-gray-600 rounded border border-gray-500"
                          />
                        )}

                        <span className="text-white text-sm font-medium capitalize">
                          {item.type} #{index + 1}
                        </span>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteRegion(item);
                        }}
                        className="text-red-400 hover:text-red-300 p-1.5 rounded hover:bg-red-900/20 transition-colors"
                        title="Delete region"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>

                    {/* OCR Controls */}
                    <div
                      className="flex flex-col gap-2 mb-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Clean checkbox */}
                      <label className="flex items-center gap-2 text-gray-300 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={cleanEnabled}
                          onChange={() => toggleClean(item)}
                          className="w-3 h-3 rounded border-gray-600 accent-green-600 hover:accent-green-600 focus:accent-green-600"
                        />
                        <span>Clean (inpaint when OCR)</span>
                      </label>

                      {/* OCR and ReTranslate buttons */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => runOCR(item)}
                          disabled={isProcessing}
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            isProcessing
                              ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                              : "bg-green-600 hover:bg-green-700 text-white"
                          }`}
                        >
                          {isProcessing ? "..." : "OCR"}
                        </button>
                        <button
                          onClick={() => runReTranslate(item)}
                          disabled={isProcessing || !item.originalText}
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            isProcessing || !item.originalText
                              ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                              : "bg-purple-600 hover:bg-purple-700 text-white"
                          }`}
                        >
                          {isProcessing ? "..." : "ReTranslate"}
                        </button>
                      </div>
                    </div>

                    {/* Text editing section - only show if has OCR data */}
                    {hasText && (
                      <div
                        className="space-y-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Original Text */}
                        <div>
                          <label className="text-gray-300 text-xs font-medium block mb-1">
                            Original
                          </label>
                          <input
                            type="text"
                            value={item.originalText || ""}
                            onChange={(e) =>
                              updateRegionText(item, "originalText", e.target.value)
                            }
                            placeholder="Original text..."
                            className="w-full px-2 py-1.5 text-xs bg-gray-800 text-gray-300 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                          />
                        </div>

                        {/* Translated Text */}
                        <div>
                          <label className="text-gray-300 text-xs font-medium block mb-1">
                            Translated
                          </label>
                          <input
                            type="text"
                            value={item.translatedText || ""}
                            onChange={(e) =>
                              updateRegionText(item, "translatedText", e.target.value)
                            }
                            placeholder="Translated text..."
                            className="w-full px-2 py-1.5 text-xs bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                          />
                        </div>

                        {/* Create Text Object Button */}
                        {item.translatedText && (
                          <button
                            onClick={() => createTextObject(item)}
                            className="w-full px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-medium rounded"
                          >
                            Create Text Object
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
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
  );
}
