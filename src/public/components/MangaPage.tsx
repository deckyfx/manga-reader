import React, { useState, useRef } from "react";
import html2canvas from "html2canvas";
import { CaptionBubble } from "./CaptionBubble";

interface Rectangle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  saved: boolean;
  capturedImage?: string;
}

interface MangaPageProps {
  src: string;
  alt?: string;
}

/**
 * MangaPage Component
 *
 * Reusable manga page viewer with inline OCR editing
 * - Toggle edit mode
 * - Click and drag to create OCR regions
 * - Inline popover shows captured image, progress, and results
 * - Save/Discard workflow
 */
export function MangaPage({ src, alt = "Manga page" }: MangaPageProps) {
  const [editMode, setEditMode] = useState(false);
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
   * Handle mouse down - start drawing rectangle
   */
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editMode || !containerRef.current) return;

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
    if (!currentDraw || !containerRef.current) return;

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
    if (!currentDraw || !imageRef.current) return;

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
        saved: false,
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
    height: number
  ): Promise<string | null> => {
    if (!imageRef.current) return null;

    try {
      // Get displayed and canvas dimensions
      const imgRect = imageRef.current.getBoundingClientRect();
      const displayedWidth = imgRect.width;
      const displayedHeight = imgRect.height;

      // Capture image
      const canvas = await html2canvas(imageRef.current, {
        useCORS: true,
        allowTaint: true,
      });

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
        naturalRect.height
      );

      return croppedCanvas.toDataURL("image/png");
    } catch (error) {
      console.error("Capture Error:", error);
      return null;
    }
  };

  /**
   * Save a rectangle with text (keep it on the page)
   */
  const handleSave = (rectId: string, text: string) => {
    setRectangles((prev) =>
      prev.map((r) => (r.id === rectId ? { ...r, text, saved: true } : r))
    );
    setActiveRectId(null);
  };

  /**
   * Discard a rectangle (remove it)
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
      {/* Edit Mode Toggle */}
      <div className="flex justify-end">
        <button
          onClick={() => {
            setEditMode(!editMode);
            if (editMode) {
              // Exiting edit mode - clear active popover
              setActiveRectId(null);
            }
          }}
          className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
            editMode
              ? "bg-green-500 hover:bg-green-600 text-white"
              : "bg-blue-500 hover:bg-blue-600 text-white"
          }`}
        >
          {editMode ? "✓ Done Edit" : "✏️ Edit"}
        </button>
      </div>

      {/* Image Container */}
      <div
        ref={containerRef}
        className="relative inline-block select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{ cursor: editMode ? "crosshair" : "default" }}
      >
        <img
          ref={imageRef}
          src={src}
          alt={alt}
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
          <div key={rect.id}>
            {/* Rectangle overlay */}
            <div
              className={`absolute border-2 pointer-events-none ${
                rect.saved
                  ? "border-green-500 bg-green-300"
                  : "border-blue-500 bg-blue-300"
              } bg-opacity-20`}
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.height,
              }}
            />

            {/* Caption bubble (only show for active unsaved rectangles) */}
            {activeRectId === rect.id && !rect.saved && rect.capturedImage && (
              <CaptionBubble
                capturedImage={rect.capturedImage}
                x={rect.x + rect.width + 10}
                y={rect.y}
                onSave={(text) => handleSave(rect.id, text)}
                onDiscard={() => handleDiscard(rect.id)}
              />
            )}

            {/* Saved caption indicator */}
            {rect.saved && (
              <div
                className="absolute bg-green-500 text-white text-xs px-2 py-1 rounded-full pointer-events-auto cursor-pointer hover:bg-green-600"
                style={{
                  left: rect.x,
                  top: rect.y - 8,
                }}
                onClick={() => setActiveRectId(rect.id === activeRectId ? null : rect.id)}
              >
                ✓
              </div>
            )}

            {/* Show saved text on hover/click */}
            {activeRectId === rect.id && rect.saved && rect.text && (
              <div
                className="absolute bg-white rounded-lg shadow-xl border-2 border-green-500 p-3 z-10 pointer-events-auto"
                style={{
                  left: rect.x + rect.width + 10,
                  top: rect.y,
                  minWidth: 200,
                  maxWidth: 300,
                }}
              >
                <div className="text-sm text-gray-700 mb-2 max-h-32 overflow-y-auto">
                  <pre className="whitespace-pre-wrap font-sans">{rect.text}</pre>
                </div>
                <button
                  onClick={() => setActiveRectId(null)}
                  className="w-full px-3 py-1 bg-gray-500 hover:bg-gray-600 text-white text-sm rounded transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Saved rectangles list (when not in edit mode) */}
      {!editMode && rectangles.length > 0 && (
        <div className="bg-white rounded-lg shadow-lg p-4">
          <h3 className="text-sm font-semibold text-gray-800 mb-2">
            📝 Extracted Text ({rectangles.length})
          </h3>
          <div className="space-y-2">
            {rectangles.map((rect, index) => (
              <div
                key={rect.id}
                className="text-sm p-2 bg-gray-50 rounded cursor-pointer hover:bg-gray-100"
                onClick={() => setActiveRectId(rect.id)}
              >
                <span className="font-medium text-gray-600">Region {index + 1}:</span>{" "}
                {rect.text || "No text"}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
