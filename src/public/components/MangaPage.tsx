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
}: MangaPageProps) {
  const [rectangles, setRectangles] = useState<Rectangle[]>([]);
  const [currentDraw, setCurrentDraw] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const [activeRectId, setActiveRectId] = useState<string | null>(null);

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

    // Create rectangle and capture immediately
    const rectId = `rect-${Date.now()}`;

    setCurrentDraw(null);
    setActiveRectId(rectId);

    // Capture the region
    const capturedImage = await captureRegion(x, y, width, height);

    if (capturedImage) {
      const newRect: Rectangle = {
        id: rectId,
        x,
        y,
        width,
        height,
        capturedImage,
      };

      setRectangles([...rectangles, newRect]);
    }
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
      setActiveRectId(null);
    }
  };

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
          src={page.originalImage}
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
            imagePath={page.originalImage}
            editMode={editMode}
            isActive={activeRectId === rect.id}
            onActivate={() => setActiveRectId(rect.id)}
            onDiscard={() => handleDiscard(rect.id)}
            onUpdate={loadCaptions}
            onClose={() => setActiveRectId(null)}
          />
        ))}
      </div>

    </div>
  );
}
