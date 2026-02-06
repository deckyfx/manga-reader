import React, { useState, useRef, useEffect } from "react";
import html2canvas from "html2canvas";
import { CaptionRectangle } from "./CaptionRectangle";
import { api } from "../lib/api";
import { catchError } from "../../lib/error-handler";

interface Rectangle {
  id: string;
  captionId?: number; // Database ID for existing captions
  captionSlug?: string; // Database slug for existing captions
  x: number;
  y: number;
  width: number;
  height: number;
  capturedImage?: string;
  rawText?: string;
  translatedText?: string;
  patchImagePath?: string; // Path to generated patch image
  patchGeneratedAt?: Date; // When patch was generated
}

interface PageData {
  id: number;
  originalImage: string;
  createdAt: Date;
}

interface MangaPageProps {
  page: PageData;
  onPrevious?: () => void;
  onNext?: () => void;
  editMode: boolean;
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
  onEditModeChange,
  onPatchPage,
  onPatchesAvailable,
  showNotification,
}: MangaPageProps) {
  const [rectangles, setRectangles] = useState<Rectangle[]>([]);
  const [currentDraw, setCurrentDraw] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const [activeRectId, setActiveRectId] = useState<string | null>(null);
  const [isPatching, setIsPatching] = useState(false);
  const [imageSrc, setImageSrc] = useState(`${page.originalImage}?t=${Date.now()}`);
  const [isCreatingCaption, setIsCreatingCaption] = useState(false);
  const [creatingCaptionPos, setCreatingCaptionPos] = useState<{ x: number; y: number } | null>(null);

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
    }
  }, [editMode]);

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
   * Handle mouse down - start drawing rectangle
   */
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Don't allow drawing when editing a caption or not in edit mode
    if (!editMode || !containerRef.current || activeRectId !== null) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setCurrentDraw({
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
    });
  };

  /**
   * Handle mouse move - update rectangle size
   */
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    // Don't update drawing when editing a caption
    if (!currentDraw || !containerRef.current || activeRectId !== null) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setCurrentDraw({
      ...currentDraw,
      currentX: x,
      currentY: y,
    });
  };

  /**
   * Handle mouse up - finish drawing and process OCR
   */
  const handleMouseUp = async () => {
    // Don't complete drawing when editing a caption
    if (!currentDraw || !imageRef.current || activeRectId !== null) return;

    // Calculate rectangle dimensions
    const x = Math.min(currentDraw.startX, currentDraw.currentX);
    const y = Math.min(currentDraw.startY, currentDraw.currentY);
    const width = Math.abs(currentDraw.currentX - currentDraw.startX);
    const height = Math.abs(currentDraw.currentY - currentDraw.startY);

    // Ignore very small rectangles (accidental clicks)
    if (width < 20 || height < 20) {
      setCurrentDraw(null);
      return;
    }

    setCurrentDraw(null);

    // Capture the region
    const capturedImage = await captureRegion(x, y, width, height);

    if (!capturedImage) {
      return;
    }

    // Show loading popup
    setIsCreatingCaption(true);
    setCreatingCaptionPos({ x: x + width / 2, y: y + height / 2 });

    // Create placeholder in database immediately to get real ID
    console.log("🔄 Creating placeholder caption in database...");
    const [error, result] = await catchError(
      api.api.ocr.post({
        pageId: page.id,
        imagePath: page.originalImage,
        x,
        y,
        width,
        height,
        capturedImage,
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

    // Get displayed and canvas dimensions
    const imgRect = imageRef.current.getBoundingClientRect();
    const displayedWidth = imgRect.width;
    const displayedHeight = imgRect.height;

    // Capture image
    const [error, canvas] = await catchError(
      html2canvas(imageRef.current, {
        useCORS: true,
        allowTaint: true,
      })
    );

    if (error) {
      console.error("Capture Error:", error);
      return null;
    }

    // Calculate scale factors
    const scaleX = canvas.width / displayedWidth;
    const scaleY = canvas.height / displayedHeight;

    // Scale coordinates
    const naturalRect = {
      x: x * scaleX,
      y: y * scaleY,
      width: width * scaleX,
      height: height * scaleY,
    };

    // Crop region
    const croppedCanvas = document.createElement("canvas");
    const ctx = croppedCanvas.getContext("2d");
    if (!ctx) return null;

    croppedCanvas.width = naturalRect.width;
    croppedCanvas.height = naturalRect.height;

    ctx.drawImage(
      canvas,
      naturalRect.x,
      naturalRect.y,
      naturalRect.width,
      naturalRect.height,
      0,
      0,
      naturalRect.width,
      naturalRect.height,
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
   * Handle patching the entire page - permanently merges all patches onto page image
   */
  const handlePatchPage = async () => {
    setIsPatching(true);

    try {
      // Get displayed image dimensions
      const displayedWidth = imageRef.current?.getBoundingClientRect().width || 0;
      const displayedHeight = imageRef.current?.getBoundingClientRect().height || 0;

      const response = await fetch(`/api/pages/${page.id}/patch-page`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          displayedWidth,
          displayedHeight,
        }),
      });

      const result = await response.json();

      if (result.success) {
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
          `Failed to patch page: ${result.error || "Unknown error"}`,
          "error"
        );
      }
    } catch (error) {
      console.error("[MangaPage] Patch page failed:", error);
      showNotification?.(
        `Failed to patch page: ${error instanceof Error ? error.message : "Unknown error"}`,
        "error"
      );
    } finally {
      setIsPatching(false);
    }
  };

  /**
   * Expose patch handler to parent
   */
  useEffect(() => {
    onPatchPage?.(handlePatchPage);
  }, [onPatchPage]);

  /**
   * Get normalized rectangle coordinates for rendering
   */
  const getNormalizedRect = (draw: typeof currentDraw) => {
    if (!draw) return null;
    return {
      x: Math.min(draw.startX, draw.currentX),
      y: Math.min(draw.startY, draw.currentY),
      width: Math.abs(draw.currentX - draw.startX),
      height: Math.abs(draw.currentY - draw.startY),
    };
  };

  const drawingRect = getNormalizedRect(currentDraw);

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

        {/* Drawing rectangle (while dragging) */}
        {editMode && drawingRect && (
          <div
            className="absolute border-2 border-blue-500 bg-blue-300 bg-opacity-30 pointer-events-none"
            style={{
              left: drawingRect.x,
              top: drawingRect.y,
              width: drawingRect.width,
              height: drawingRect.height,
            }}
          />
        )}

        {/* Caption rectangles */}
        {rectangles.map((rect) => (
          <CaptionRectangle
            key={rect.id}
            id={rect.id}
            captionId={rect.captionId}
            captionSlug={rect.captionSlug}
            pageId={page.id}
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
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
