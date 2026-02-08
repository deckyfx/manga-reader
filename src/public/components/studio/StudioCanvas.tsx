import React, { useRef, useEffect, useCallback, useState } from "react";
import { useCanvasCoords } from "../../hooks/useCanvasCoords";
import { useCanvasImage } from "../../hooks/useCanvasImage";
import {
  useDrawingTool,
  type DrawingToolType,
} from "../../hooks/useDrawingTool";
import {
  useRegionTransform,
  type TransformResult,
} from "../../hooks/useRegionTransform";
import { useFabricBrush } from "../../hooks/useFabricBrush";
import { CanvasRenderer } from "./CanvasRenderer";
import { api } from "../../lib/api";
import { catchError } from "../../../lib/error-handler";
import { getRegionPolygonPoints } from "../../../lib/region-types";
import type { Region } from "../../../lib/region-types";

interface Point {
  x: number;
  y: number;
}

interface CaptionRect {
  id: string;
  captionId?: number;
  captionSlug?: string;
  shape: "rectangle" | "polygon" | "oval";
  x: number;
  y: number;
  width: number;
  height: number;
  polygonPoints?: Point[];
  capturedImage?: string;
  rawText?: string;
  translatedText?: string;
  patchImagePath?: string;
  patchGeneratedAt?: Date;
}

interface StudioCanvasProps {
  pageId: number;
  imageSrc: string;
  captions: CaptionRect[];
  selectedCaptionId: string | null;
  drawingTool: DrawingToolType;
  zoom: number;
  onCaptionCreated: (caption: CaptionRect) => void;
  onSelectCaption: (id: string | null) => void;
  onCaptionMoved: () => void;
  onNotification: (msg: string, type: "success" | "error" | "info") => void;
  showOverlay: boolean;
}

/**
 * StudioCanvas — Center column of the Studio layout.
 *
 * Renders a zoomable canvas with drawing tools. Canvas internal resolution
 * always matches the image's natural resolution. CSS sizing controls zoom.
 */
export function StudioCanvas({
  pageId,
  imageSrc,
  captions,
  selectedCaptionId,
  drawingTool,
  zoom,
  onCaptionCreated,
  onSelectCaption,
  onCaptionMoved,
  onNotification,
  showOverlay,
}: StudioCanvasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const dirtyRef = useRef(true);
  const patchImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());

  const [isCreating, setIsCreating] = React.useState(false);

  // Reuse V2 hooks
  const { toImageCoords, toDisplayCoords} = useCanvasCoords(canvasRef);
  const { loaded, imageElement, naturalWidth, naturalHeight } = useCanvasImage(
    canvasRef,
    imageSrc,
  );
  const drawing = useDrawingTool(drawingTool);
  const transform = useRegionTransform();
  const [canvasCursor, setCanvasCursor] = useState("default");

  // Fabric.js brush for masking tool
  const fabricBrush = useFabricBrush({
    width: naturalWidth * zoom,
    height: naturalHeight * zoom,
    brushSize: 20, // Fixed brush size
    enabled: drawingTool === "brush",
  });

  // Reset drawing on tool change
  useEffect(() => {
    drawing.reset();
  }, [drawingTool]);

  // Scroll canvas to selected caption's position
  useEffect(() => {
    if (!selectedCaptionId || !scrollRef.current) return;
    const caption = captions.find((c) => c.id === selectedCaptionId);
    if (!caption) return;

    const container = scrollRef.current;
    const centerX = (caption.x + caption.width / 2) * zoom;
    const centerY = (caption.y + caption.height / 2) * zoom;

    container.scrollTo({
      left: centerX - container.clientWidth / 2,
      top: centerY - container.clientHeight / 2,
      behavior: "smooth",
    });
  }, [selectedCaptionId]);

  // Load patch images when captions change
  useEffect(() => {
    const currentMap = patchImagesRef.current;
    const activeIds = new Set<string>();

    for (const c of captions) {
      if (!c.patchImagePath) continue;
      activeIds.add(c.id);

      // Build a cache key that includes generation timestamp
      const cacheKey = c.patchGeneratedAt
        ? `${c.patchImagePath}?t=${c.patchGeneratedAt.getTime()}`
        : c.patchImagePath;

      const existing = currentMap.get(c.id);
      // Skip if already loaded with the same src + timestamp
      if (existing && existing.dataset.cacheKey === cacheKey) continue;

      const img = new Image();
      img.dataset.cacheKey = cacheKey;
      img.onload = () => {
        dirtyRef.current = true;
      };
      img.src = cacheKey;
      currentMap.set(c.id, img);
    }

    // Remove stale entries
    for (const key of currentMap.keys()) {
      if (!activeIds.has(key)) {
        currentMap.delete(key);
      }
    }

    dirtyRef.current = true;
  }, [captions]);

  // ─── Render loop ──────────────────────────────
  const scheduleRedraw = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  useEffect(() => {
    // Always mark dirty when deps change so we guarantee a redraw
    // (fixes race where dirtyRef was consumed before imageElement loaded)
    dirtyRef.current = true;

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      const canvas = canvasRef.current;
      if (!canvas || !imageElement) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      CanvasRenderer.redraw(
        ctx,
        imageElement,
        captions,
        selectedCaptionId,
        drawingTool === "brush" ? "none" : drawingTool,
        drawing.rectangleRenderData,
        drawing.polygonRenderData,
        patchImagesRef.current,
        drawing.ovalRenderData,
        transform.preview,
        showOverlay,
      );
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [
    imageElement,
    captions,
    selectedCaptionId,
    drawingTool,
    drawing.rectangleRenderData,
    drawing.polygonRenderData,
    drawing.ovalRenderData,
    showOverlay,
  ]);

  // ─── Drawing completion ───────────────────────
  const createCaptionFromDrawing = async (drawResult: {
    x: number;
    y: number;
    width: number;
    height: number;
    points?: Point[];
  }) => {
    const { x, y, width, height, points } = drawResult;
    if (!imageElement) return;

    // Build Region based on active drawing tool
    let region: Region;
    if (drawingTool === "polygon" && points) {
      region = { shape: "polygon", data: { x, y, width, height, points } };
    } else if (drawingTool === "oval") {
      region = { shape: "oval", data: { x, y, width, height } };
    } else {
      region = { shape: "rectangle", data: { x, y, width, height } };
    }

    // Derive polygon points for capture clipping
    const clipPoints = getRegionPolygonPoints(region);

    // Capture from source image (not canvas) to avoid overlay contamination
    const capturedImage = CanvasRenderer.captureRegion(
      imageElement,
      x,
      y,
      width,
      height,
      clipPoints,
    );
    if (!capturedImage) return;

    setIsCreating(true);

    const [error, result] = await catchError(
      api.api.studio.ocr.post({
        pageId,
        capturedImage,
        region,
      }),
    );

    setIsCreating(false);

    if (error) {
      onNotification("Failed to create caption", "error");
      return;
    }

    if (!result.data?.success || !result.data.captionId) {
      onNotification("Failed to create caption", "error");
      return;
    }

    // Show warning if OCR/translation failed (caption is still saved)
    if (result.data.warning) {
      onNotification(result.data.warning, "error");
    }

    const newCaption: CaptionRect = {
      id: `caption-${result.data.captionId}`,
      captionId: result.data.captionId,
      captionSlug: result.data.captionSlug || undefined,
      shape: region.shape,
      x,
      y,
      width,
      height,
      polygonPoints: clipPoints,
      capturedImage,
      rawText: result.data.rawText,
      translatedText: result.data.translatedText || undefined,
    };

    onCaptionCreated(newCaption);
    scheduleRedraw();
  };

  // ─── Persist region update after move/resize ──
  const persistRegionUpdate = async (result: TransformResult) => {
    if (!imageElement || !result.captionSlug) return;

    // Build Region from transform result
    let region: Region;
    if (result.shape === "polygon" && result.polygonPoints) {
      region = {
        shape: "polygon",
        data: {
          x: result.x,
          y: result.y,
          width: result.width,
          height: result.height,
          points: result.polygonPoints,
        },
      };
    } else if (result.shape === "oval") {
      region = {
        shape: "oval",
        data: {
          x: result.x,
          y: result.y,
          width: result.width,
          height: result.height,
        },
      };
    } else {
      region = {
        shape: "rectangle",
        data: {
          x: result.x,
          y: result.y,
          width: result.width,
          height: result.height,
        },
      };
    }

    // Capture from source image (not canvas) to avoid overlay contamination
    const clipPoints = getRegionPolygonPoints(region);
    const capturedImage = CanvasRenderer.captureRegion(
      imageElement,
      result.x,
      result.y,
      result.width,
      result.height,
      clipPoints,
    );
    if (!capturedImage) {
      onNotification("Failed to capture region image", "error");
      return;
    }

    const [error] = await catchError(
      api.api.studio.captions({ slug: result.captionSlug }).region.patch({
        region,
        capturedImage,
      }),
    );

    if (error) {
      onNotification("Failed to update region", "error");
      return;
    }

    onCaptionMoved();
  };

  // ─── Mouse handlers ───────────────────────────
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = toImageCoords(e);

    // When tool="none", try transform first on the selected caption
    if (drawingTool === "none" && !drawing.isDrawing) {
      const consumed = transform.handleMouseDown(
        x,
        y,
        captions,
        selectedCaptionId,
      );
      if (consumed) return;
    }

    // Hit test for caption selection
    if (selectedCaptionId !== null && !drawing.isDrawing) {
      const hitId = CanvasRenderer.hitTestCaption(x, y, captions);
      if (hitId) {
        onSelectCaption(hitId);
        return;
      }
      onSelectCaption(null);
    }

    const isDoubleClick = e.detail === 2;

    if (!drawing.isDrawing && !isDoubleClick) {
      const hitId = CanvasRenderer.hitTestCaption(x, y, captions);
      if (hitId) {
        onSelectCaption(hitId);
        return;
      }
    }

    if (drawingTool === "none") return;
    drawing.handleMouseDown(x, y, isDoubleClick);
    scheduleRedraw();
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = toImageCoords(e);

    // Transform in progress — update preview
    if (transform.isActive()) {
      transform.handleMouseMove(x, y);
      scheduleRedraw();
      return;
    }

    // Update cursor when tool="none" (lightweight, no redraw)
    if (drawingTool === "none" && !drawing.isDrawing) {
      const cursor = transform.getCursor(x, y, captions, selectedCaptionId);
      setCanvasCursor(cursor ?? "default");
    }

    // Drawing in progress
    if (drawing.isDrawing) {
      drawing.handleMouseMove(x, y);
      scheduleRedraw();
    }
  };

  const handleMouseUp = async () => {
    // Transform in progress — finish and persist
    if (transform.isActive()) {
      const result = transform.handleMouseUp();
      scheduleRedraw();
      if (result) {
        await persistRegionUpdate(result);
      }
      return;
    }

    // Drawing in progress
    if (!drawing.isDrawing) return;
    const drawResult = drawing.handleMouseUp();
    scheduleRedraw();
    if (!drawResult) return;
    await createCaptionFromDrawing(drawResult);
  };

  // ─── Polygon DONE ─────────────────────────────
  const handlePolygonDone = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const result = drawing.finishPolygon();
    scheduleRedraw();
    if (result) {
      await createCaptionFromDrawing(result);
    }
  };

  // Compute polygon DONE button position
  const polygonFirstPoint =
    drawingTool === "polygon" &&
    drawing.polygonRenderData &&
    drawing.polygonRenderData.points.length > 0
      ? toDisplayCoords(
          drawing.polygonRenderData.points[0]!.x,
          drawing.polygonRenderData.points[0]!.y,
        )
      : null;

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto bg-gray-800 relative">
      {/* Canvas container sized by zoom */}
      <div
        className="relative"
        style={{
          width: naturalWidth * zoom,
          height: naturalHeight * zoom,
        }}
      >
        <canvas
          ref={canvasRef}
          className="block"
          style={{
            width: "100%",
            height: "100%",
            cursor: isCreating
              ? "wait"
              : transform.isActive()
                ? transform.mode === "resizing" && transform.activeHandle
                  ? CanvasRenderer.getCursorForHandle(transform.activeHandle)
                  : "move"
                : drawingTool !== "none"
                  ? "crosshair"
                  : canvasCursor,
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        />

        {/* Fabric.js Brush Canvas Overlay */}
        {drawingTool === "brush" && loaded && (
          <canvas
            ref={fabricBrush.canvasRef}
            className="absolute top-0 left-0 pointer-events-auto"
            style={{
              width: "100%",
              height: "100%",
              cursor: "crosshair",
            }}
          />
        )}
      </div>

      {/* Polygon DONE button */}
      {polygonFirstPoint && (
        <button
          onClick={handlePolygonDone}
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded-lg font-semibold shadow-lg z-50"
          style={{
            left: polygonFirstPoint.left - 30,
            top: polygonFirstPoint.top - 35,
            pointerEvents: "auto",
          }}
        >
          DONE
        </button>
      )}

      {/* Loading spinner while creating caption */}
      {isCreating && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white rounded-lg shadow-2xl border-2 border-blue-500 px-4 py-2 z-50 flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500" />
          <span className="text-sm text-gray-700 font-medium">
            Creating region...
          </span>
        </div>
      )}
    </div>
  );
}
