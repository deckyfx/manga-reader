import React, { useState, useRef, useEffect } from "react";
import html2canvas from "html2canvas";
import { UserCaptionHost } from "./UserCaptionHost";
import { DrawingOverlay } from "./DrawingOverlay";
import { api } from "../lib/api";
import { catchError } from "../../lib/error-handler";
import { useDrawingTool, type DrawingToolType } from "../hooks/useDrawingTool";

interface Point {
  x: number;
  y: number;
}

interface Rectangle {
  id: string;
  captionId?: number; // Database ID for existing captions
  captionSlug?: string; // Database slug for existing captions
  x: number;
  y: number;
  width: number;
  height: number;
  polygonPoints?: Point[]; // Optional polygon points for polygon-shaped captions
  capturedImage?: string;
  rawText?: string;
  translatedText?: string;
  patchImagePath?: string; // Path to generated patch image
  patchGeneratedAt?: Date; // When patch was generated
}

interface PageData {
  id: number;
  slug?: string | null;
  originalImage: string;
  createdAt: Date;
}

interface MangaPageProps {
  page: PageData;
  onPrevious?: () => void;
  onNext?: () => void;
  editMode: boolean;
  drawingTool: DrawingToolType;
  onEditModeChange: (editMode: boolean) => void;
  onPatchPage?: (handler: () => Promise<void>) => void;
  onPatchesAvailable?: (available: boolean) => void;
  showNotification?: (message: string, type: "success" | "error" | "info") => void;
}

/**
 * MangaPage Component
 *
 * Reusable manga page viewer with inline OCR editing
 * - Receives complete page data from parent
 * - Toggle edit mode
 * - Click and drag to create OCR regions
 * - Inline popover shows captured image, progress, and editable results
 * - Captions are automatically persisted to database
 * - Update/Discard workflow
 */
export function MangaPage({
  page,
  onPrevious,
  onNext,
  editMode,
  drawingTool,
  onEditModeChange,
  onPatchPage,
  onPatchesAvailable,
  showNotification,
}: MangaPageProps) {
  const [rectangles, setRectangles] = useState<Rectangle[]>([]);
  const [activeRectId, setActiveRectId] = useState<string | null>(null);
  const [isPatching, setIsPatching] = useState(false);
  const [imageSrc, setImageSrc] = useState(`${page.originalImage}?t=${Date.now()}`);
  const [isCreatingCaption, setIsCreatingCaption] = useState(false);
  const [creatingCaptionPos, setCreatingCaptionPos] = useState<{ x: number; y: number } | null>(null);

  // Use drawing tool hook
  const drawing = useDrawingTool(drawingTool);

  /**
   * Update image source when page prop changes
   */
  useEffect(() => {
    const baseUrl = page.originalImage.split('?')[0];
    setImageSrc(`${baseUrl}?t=${Date.now()}`);
  }, [page.originalImage]);

  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Load saved captions from database
   */
  const loadCaptions = async () => {
    const [error, result] = await catchError(
      api.api.captions.get({
        query: { pageId: page.id },
      })
    );

    if (error) {
      console.error("[MangaPage] Failed to load captions:", error);
      return;
    }

    if (result.data?.success && result.data.captions) {
      // Convert database captions to Rectangle format
      const loadedRectangles: Rectangle[] = result.data.captions.map(
        (caption) => ({
          id: `caption-${caption.id}`,
          captionId: caption.id, // Store database ID
          captionSlug: caption.slug || undefined, // Store database slug (convert null to undefined)
          x: caption.x,
          y: caption.y,
          width: caption.width,
          height: caption.height,
          polygonPoints: caption.polygonPoints || undefined, // Polygon points (already parsed from JSON)
          capturedImage: caption.capturedImage,
          rawText: caption.rawText,
          translatedText: caption.translatedText || undefined,
          patchImagePath: caption.patchImagePath || undefined,
          patchGeneratedAt: caption.patchGeneratedAt
            ? new Date(caption.patchGeneratedAt)
            : undefined,
        }),
      );

      setRectangles(loadedRectangles);
    }
  };

  /**
   * Load captions on mount
   */
  useEffect(() => {
    loadCaptions();
  }, [page.id]);

  /**
   * Notify parent when patches are available
   */
  useEffect(() => {
    const hasPatches = rectangles.some((r) => r.patchImagePath);
    onPatchesAvailable?.(hasPatches);
  }, [rectangles, onPatchesAvailable]);

  /**
   * Reload captions and clear active popover when exiting edit mode
   */
  useEffect(() => {
    if (!editMode) {
      loadCaptions();
      setActiveRectId(null);
      drawing.reset(); // Clear any partial drawing
    }
  }, [editMode]);

  /**
   * Reset drawing state when switching between drawing tools
   */
  useEffect(() => {
    drawing.reset();
  }, [drawingTool]);

  /**
   * Handle image click for navigation (when not in edit mode)
   */
  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only handle navigation when NOT in edit mode
    if (editMode || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;

    // Left half = previous, right half = next
    if (clickX < width / 2) {
      onPrevious?.();
    } else {
      onNext?.();
    }
  };

  /**
   * Handle mouse down - start drawing
   */
  /**
   * Convert DOM coordinates to image pixel coordinates
   * GPT AI guidance: Scale from displayed size to actual image size
   */
  const domToImageCoords = (domX: number, domY: number) => {
    if (!containerRef.current || !imageRef.current) return { x: domX, y: domY };

    const rect = containerRef.current.getBoundingClientRect();
    const img = imageRef.current;

    // Scale from DOM pixels to image pixels
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;

    return {
      x: domX * scaleX,
      y: domY * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Don't allow drawing when editing a caption or not in edit mode
    if (!editMode || !containerRef.current || activeRectId !== null) return;

    const rect = containerRef.current.getBoundingClientRect();
    const domX = e.clientX - rect.left;
    const domY = e.clientY - rect.top;
    const isDoubleClick = e.detail === 2;

    // Convert DOM coordinates to image pixel coordinates
    const { x, y } = domToImageCoords(domX, domY);

    drawing.handleMouseDown(x, y, isDoubleClick);
  };

  /**
   * Handle mouse move - update drawing
   */
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    // Don't update drawing when editing a caption or not drawing
    if (!drawing.isDrawing || !containerRef.current || activeRectId !== null) return;

    const rect = containerRef.current.getBoundingClientRect();
    const domX = e.clientX - rect.left;
    const domY = e.clientY - rect.top;

    // Convert DOM coordinates to image pixel coordinates
    const { x, y } = domToImageCoords(domX, domY);

    drawing.handleMouseMove(x, y);
  };

  /**
   * Handle mouse up - finish drawing and process OCR
   */
  const handleMouseUp = async () => {
    // Don't complete drawing when editing a caption
    if (!drawing.isDrawing || !imageRef.current || activeRectId !== null) return;

    // Finish drawing and get result (bbox + points for polygon)
    const drawResult = drawing.handleMouseUp();

    // Ignore if result is null (too small or incomplete)
    if (!drawResult) {
      return;
    }

    const { x, y, width, height, points } = drawResult;

    // Capture the region
    const capturedImage = await captureRegion(x, y, width, height);

    if (!capturedImage) {
      return;
    }

    // Show loading popup
    setIsCreatingCaption(true);
    setCreatingCaptionPos({ x: x + width / 2, y: y + height / 2 });

    // Create placeholder in database immediately to get real ID
    const [error, result] = await catchError(
      api.api.ocr.post({
        pageId: page.id,
        imagePath: page.originalImage,
        x,
        y,
        width,
        height,
        capturedImage,
        polygonPoints: points, // Include polygon points if available
      })
    );

    // Hide loading popup
    setIsCreatingCaption(false);
    setCreatingCaptionPos(null);

    if (error) {
      console.error("❌ Failed to create caption:", error);
      showNotification?.("Failed to create caption", "error");
      return;
    }

    if (!result.data?.success || !result.data.captionId) {
      console.error("❌ No caption ID returned from API");
      showNotification?.("Failed to create caption", "error");
      return;
    }

    // Got real database ID - create rectangle with it
    const captionId = result.data.captionId;
    const captionSlug = result.data.captionSlug || undefined;
    const rectId = `caption-${captionId}`;

    console.log("✅ Caption created in database:", {
      captionId,
      captionSlug,
      rectId,
    });

    const newRect: Rectangle = {
      id: rectId,
      captionId: captionId,
      captionSlug: captionSlug,
      x,
      y,
      width,
      height,
      capturedImage,
      rawText: result.data.rawText,
      translatedText: result.data.translatedText || undefined,
    };

    setRectangles([...rectangles, newRect]);
    setActiveRectId(rectId);
    console.log("🎯 Rectangle created with real database ID:", rectId);
  };

  /**
   * Capture region and return data URL
   */
  const captureRegion = async (
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<string | null> => {
    if (!imageRef.current) return null;

    // Capture image (force scale=1 to ignore device pixel ratio)
    const [error, canvas] = await catchError(
      html2canvas(imageRef.current, {
        useCORS: true,
        allowTaint: true,
        scale: 1, // Force 1x scale, ignore DPR to match image pixel coordinates
      })
    );

    if (error) {
      console.error("Capture Error:", error);
      return null;
    }

    // Coordinates are in image pixel space, scale to canvas space
    // With scale=1, canvas should match natural image size (scaleX/Y ≈ 1.0)
    const imgNaturalWidth = imageRef.current.naturalWidth;
    const imgNaturalHeight = imageRef.current.naturalHeight;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    // Scale from image pixels to canvas pixels (should be ~1.0 with scale=1)
    const scaleX = canvasWidth / imgNaturalWidth;
    const scaleY = canvasHeight / imgNaturalHeight;

    const canvasRect = {
      x: Math.round(x * scaleX),
      y: Math.round(y * scaleY),
      width: Math.round(width * scaleX),
      height: Math.round(height * scaleY),
    };

    // Crop region
    const croppedCanvas = document.createElement("canvas");
    const ctx = croppedCanvas.getContext("2d");
    if (!ctx) return null;

    croppedCanvas.width = canvasRect.width;
    croppedCanvas.height = canvasRect.height;

    ctx.drawImage(
      canvas,
      canvasRect.x,
      canvasRect.y,
      canvasRect.width,
      canvasRect.height,
      0,
      0,
      canvasRect.width,
      canvasRect.height,
    );

    return croppedCanvas.toDataURL("image/png");
  };

  /**
   * Discard a rectangle (remove it from UI after database deletion)
   */
  const handleDiscard = (rectId: string) => {
    setRectangles((prev) => prev.filter((r) => r.id !== rectId));
    if (activeRectId === rectId) {
      setActiveRectId(null); // Close popover when discarding
    }
  };

  /**
   * Handle drawing completion (rectangle or polygon)
   */
  const handleDrawingComplete = async (drawResult: {
    x: number;
    y: number;
    width: number;
    height: number;
    points?: Point[];
  }) => {
    const { x, y, width, height, points } = drawResult;

    // Capture the region
    const capturedImage = await captureRegion(x, y, width, height);
    if (!capturedImage) return;

    // Show loading popup
    setIsCreatingCaption(true);
    setCreatingCaptionPos({ x: x + width / 2, y: y + height / 2 });

    // Create caption in DB
    const [error, result] = await catchError(
      api.api.ocr.post({
        pageId: page.id,
        imagePath: page.originalImage,
        x,
        y,
        width,
        height,
        capturedImage,
        polygonPoints: points,
      })
    );

    setIsCreatingCaption(false);
    setCreatingCaptionPos(null);

    if (error) {
      console.error("❌ Failed to create caption:", error);
      showNotification?.("Failed to create caption", "error");
      return;
    }

    if (!result.data?.success || !result.data.captionId) {
      console.error("❌ No caption ID returned from API");
      showNotification?.("Failed to create caption", "error");
      return;
    }

    // Create rectangle with database ID
    const captionId = result.data.captionId;
    const captionSlug = result.data.captionSlug || undefined;
    const rectId = `caption-${captionId}`;

    const newRect: Rectangle = {
      id: rectId,
      captionId: captionId,
      captionSlug: captionSlug,
      x,
      y,
      width,
      height,
      polygonPoints: points,
      capturedImage,
      rawText: result.data.rawText,
      translatedText: result.data.translatedText || undefined,
    };

    setRectangles([...rectangles, newRect]);
    setActiveRectId(rectId);
  };

  /**
   * Handle patching the entire page - permanently merges all patches onto page image
   */
  const handlePatchPage = async () => {
    if (!page.slug) {
      showNotification?.("Page slug not found", "error");
      return;
    }

    setIsPatching(true);

    // Get displayed image dimensions
    const displayedWidth = imageRef.current?.getBoundingClientRect().width || 0;
    const displayedHeight = imageRef.current?.getBoundingClientRect().height || 0;

    // Use Eden Treaty for type-safe API call
    const [error, response] = await catchError(
      api.api.pages.page.patch({
        pageSlug: page.slug,
        displayedWidth,
        displayedHeight,
      })
    );

    if (error) {
      console.error("[MangaPage] Patch page failed:", error);
      showNotification?.(
        `Failed to patch page: ${error.message}`,
        "error"
      );
      setIsPatching(false);
      return;
    }

    // Type the response data
    const result = response?.data as { success?: boolean; message?: string; error?: string } | undefined;

    if (result?.success) {
      // Clear all rectangles and reload
      setRectangles([]);
      setActiveRectId(null);
      // Force reload the page image with aggressive cache-busting
      const baseUrl = page.originalImage.split('?')[0];
      setImageSrc(`${baseUrl}?t=${Date.now()}`);
      showNotification?.(
        result.message || "Page patched successfully!",
        "success"
      );
      // Exit edit mode after successful patching
      onEditModeChange(false);
    } else {
      showNotification?.(
        `Failed to patch page: ${result?.error || "Unknown error"}`,
        "error"
      );
    }

    setIsPatching(false);
  };

  /**
   * Expose patch handler to parent
   */
  useEffect(() => {
    onPatchPage?.(handlePatchPage);
  }, [onPatchPage]);


  return (
    <div className="space-y-4">
      {/* Image Container */}
      <div
        ref={containerRef}
        className="relative inline-block select-none"
        onClick={handleImageClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{ cursor: editMode ? "crosshair" : "pointer" }}
      >
        <img
          ref={imageRef}
          src={imageSrc}
          alt={`Manga page ${page.id}`}
          className="max-w-full h-auto rounded-lg shadow-lg"
          crossOrigin="anonymous"
          draggable={false}
        />

        {/* Drawing preview overlay (rectangle or polygon) */}
        <DrawingOverlay
          drawingTool={drawingTool}
          drawing={drawing}
          editMode={editMode}
          onComplete={handleDrawingComplete}
        />

        {/* Caption rectangles */}
        {rectangles.map((rect) => (
          <UserCaptionHost
            key={rect.id}
            id={rect.id}
            captionId={rect.captionId}
            captionSlug={rect.captionSlug}
            pageId={page.id}
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            polygonPoints={rect.polygonPoints}
            capturedImage={rect.capturedImage || ""}
            rawText={rect.rawText}
            translatedText={rect.translatedText}
            patchImagePath={rect.patchImagePath}
            imagePath={page.originalImage}
            editMode={editMode}
            isActive={activeRectId === rect.id}
            onActivate={() => setActiveRectId(rect.id)}
            onDiscard={() => handleDiscard(rect.id)}
            onUpdate={loadCaptions}
            onClose={() => setActiveRectId(null)}
          />
        ))}

        {/* Loading popup while creating caption */}
        {isCreatingCaption && creatingCaptionPos && (
          <div
            className="absolute bg-white rounded-lg shadow-2xl border-2 border-blue-500 p-4 pointer-events-none z-50"
            style={{
              left: creatingCaptionPos.x - 75,
              top: creatingCaptionPos.y - 40,
              width: 150,
            }}
          >
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              <span className="text-sm text-gray-700 font-medium">
                Creating...
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
