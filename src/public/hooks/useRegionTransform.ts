import { useRef, useCallback } from "react";
import {
  CanvasRenderer,
  type HandleType,
  type TransformPreview,
} from "../components/studio/CanvasRenderer";

interface Point {
  x: number;
  y: number;
}

interface CaptionData {
  id: string;
  captionSlug?: string;
  shape: "rectangle" | "polygon" | "oval";
  x: number;
  y: number;
  width: number;
  height: number;
  polygonPoints?: Point[];
}

interface TransformSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
  polygonPoints?: Point[];
}

export interface TransformResult {
  captionId: string;
  captionSlug: string;
  shape: "rectangle" | "polygon" | "oval";
  x: number;
  y: number;
  width: number;
  height: number;
  polygonPoints?: Point[];
}

type TransformMode = "idle" | "dragging" | "resizing";

const MIN_SIZE = 20;

/**
 * Compute anchor point and which axes move for a given resize handle.
 *
 * The anchor is the corner/edge opposite the handle being dragged.
 * moveX/moveY indicate which bounding box edges shift with the mouse.
 */
function getResizeConfig(handle: HandleType, snap: TransformSnapshot) {
  const { x, y, width, height } = snap;
  const right = x + width;
  const bottom = y + height;

  const configs: Record<
    HandleType,
    {
      anchor: Point;
      moveX: boolean;
      moveY: boolean;
      flipX: boolean;
      flipY: boolean;
    }
  > = {
    nw: {
      anchor: { x: right, y: bottom },
      moveX: true,
      moveY: true,
      flipX: true,
      flipY: true,
    },
    n: {
      anchor: { x: x + width / 2, y: bottom },
      moveX: false,
      moveY: true,
      flipX: false,
      flipY: true,
    },
    ne: {
      anchor: { x, y: bottom },
      moveX: true,
      moveY: true,
      flipX: false,
      flipY: true,
    },
    e: {
      anchor: { x, y: y + height / 2 },
      moveX: true,
      moveY: false,
      flipX: false,
      flipY: false,
    },
    se: {
      anchor: { x, y },
      moveX: true,
      moveY: true,
      flipX: false,
      flipY: false,
    },
    s: {
      anchor: { x: x + width / 2, y },
      moveX: false,
      moveY: true,
      flipX: false,
      flipY: false,
    },
    sw: {
      anchor: { x: right, y },
      moveX: true,
      moveY: true,
      flipX: true,
      flipY: false,
    },
    w: {
      anchor: { x: right, y: y + height / 2 },
      moveX: true,
      moveY: false,
      flipX: true,
      flipY: false,
    },
  };

  return configs[handle];
}

/**
 * Hook for drag-to-move and handle-based resize of caption regions.
 *
 * State machine: idle → dragging/resizing → idle
 *
 * Uses a snapshot captured on mousedown so polygon points don't drift
 * from accumulated floating point errors.
 */
export function useRegionTransform() {
  const modeRef = useRef<TransformMode>("idle");
  const captionRef = useRef<CaptionData | null>(null);
  const handleRef = useRef<HandleType | null>(null);
  const snapshotRef = useRef<TransformSnapshot | null>(null);
  const startMouseRef = useRef<Point | null>(null);
  const previewRef = useRef<TransformPreview | null>(null);
  // Force re-renders by bumping a counter
  const renderTick = useRef(0);

  const isActive = useCallback(() => modeRef.current !== "idle", []);

  /**
   * Attempt to start a transform on mousedown.
   * Returns true if the event was consumed (handle hit or body hit on selected caption).
   */
  const handleMouseDown = useCallback(
    (
      x: number,
      y: number,
      captions: CaptionData[],
      selectedCaptionId: string | null,
    ): boolean => {
      if (!selectedCaptionId) return false;

      const caption = captions.find((c) => c.id === selectedCaptionId);
      if (!caption) return false;

      // Check handle hit first
      const handle = CanvasRenderer.hitTestHandle(x, y, caption);
      if (handle) {
        modeRef.current = "resizing";
        captionRef.current = caption;
        handleRef.current = handle;
        snapshotRef.current = {
          x: caption.x,
          y: caption.y,
          width: caption.width,
          height: caption.height,
          polygonPoints: caption.polygonPoints
            ? caption.polygonPoints.map((p) => ({ ...p }))
            : undefined,
        };
        startMouseRef.current = { x, y };
        previewRef.current = null;
        return true;
      }

      // Check body hit
      const hitId = CanvasRenderer.hitTestCaption(x, y, [caption]);
      if (hitId === caption.id) {
        modeRef.current = "dragging";
        captionRef.current = caption;
        handleRef.current = null;
        snapshotRef.current = {
          x: caption.x,
          y: caption.y,
          width: caption.width,
          height: caption.height,
          polygonPoints: caption.polygonPoints
            ? caption.polygonPoints.map((p) => ({ ...p }))
            : undefined,
        };
        startMouseRef.current = { x, y };
        previewRef.current = null;
        return true;
      }

      return false;
    },
    [],
  );

  /** Update preview during mousemove */
  const handleMouseMove = useCallback((x: number, y: number): void => {
    const mode = modeRef.current;
    const snap = snapshotRef.current;
    const start = startMouseRef.current;
    if (mode === "idle" || !snap || !start) return;

    if (mode === "dragging") {
      const dx = x - start.x;
      const dy = y - start.y;

      previewRef.current = {
        x: snap.x + dx,
        y: snap.y + dy,
        width: snap.width,
        height: snap.height,
        polygonPoints: snap.polygonPoints?.map((p) => ({
          x: p.x + dx,
          y: p.y + dy,
        })),
      };
      return;
    }

    if (mode === "resizing") {
      const handle = handleRef.current;
      if (!handle) return;

      const config = getResizeConfig(handle, snap);
      const { anchor, moveX, moveY, flipX, flipY } = config;

      // Compute the moving edge position from mouse
      let newX = snap.x;
      let newY = snap.y;
      let newW = snap.width;
      let newH = snap.height;

      if (moveX) {
        if (flipX) {
          // Left edge moves: anchor is right
          newX = Math.min(x, anchor.x - MIN_SIZE);
          newW = anchor.x - newX;
        } else {
          // Right edge moves: anchor is left
          newW = Math.max(x - anchor.x, MIN_SIZE);
          newX = anchor.x;
        }
      }

      if (moveY) {
        if (flipY) {
          // Top edge moves: anchor is bottom
          newY = Math.min(y, anchor.y - MIN_SIZE);
          newH = anchor.y - newY;
        } else {
          // Bottom edge moves: anchor is top
          newH = Math.max(y - anchor.y, MIN_SIZE);
          newY = anchor.y;
        }
      }

      // Enforce minimum
      if (newW < MIN_SIZE) newW = MIN_SIZE;
      if (newH < MIN_SIZE) newH = MIN_SIZE;

      // Scale polygon points relative to anchor
      let scaledPoints: Point[] | undefined;
      if (snap.polygonPoints && snap.width > 0 && snap.height > 0) {
        const sx = newW / snap.width;
        const sy = newH / snap.height;
        // Anchor in the snapshot's coordinate space
        const snapAnchorX = moveX
          ? flipX
            ? snap.x + snap.width
            : snap.x
          : snap.x;
        const snapAnchorY = moveY
          ? flipY
            ? snap.y + snap.height
            : snap.y
          : snap.y;

        scaledPoints = snap.polygonPoints.map((p) => ({
          x: newX + (p.x - snapAnchorX) * sx + (moveX && flipX ? 0 : 0),
          y: newY + (p.y - snapAnchorY) * sy + (moveY && flipY ? 0 : 0),
        }));

        // Correct: offset relative to new origin
        // The anchor in image space maps to a specific corner of the new bbox.
        // snapAnchor maps to (flipX ? newX+newW : newX, flipY ? newY+newH : newY)
        // Actually simpler: transform each point from snap-anchor-relative to new-anchor-relative
        const newAnchorX = flipX ? newX + newW : newX;
        const newAnchorY = flipY ? newY + newH : newY;
        scaledPoints = snap.polygonPoints.map((p) => ({
          x: newAnchorX + (p.x - snapAnchorX) * sx,
          y: newAnchorY + (p.y - snapAnchorY) * sy,
        }));
      }

      previewRef.current = {
        x: newX,
        y: newY,
        width: newW,
        height: newH,
        polygonPoints: scaledPoints,
      };
      return;
    }
  }, []);

  /**
   * Finish the transform on mouseup.
   * Returns the final transform result, or null if nothing changed.
   */
  const handleMouseUp = useCallback((): TransformResult | null => {
    const mode = modeRef.current;
    const caption = captionRef.current;
    const preview = previewRef.current;

    // Reset state
    modeRef.current = "idle";
    captionRef.current = null;
    handleRef.current = null;
    snapshotRef.current = null;
    startMouseRef.current = null;
    previewRef.current = null;
    renderTick.current++;

    if (mode === "idle" || !caption || !preview) return null;

    // Check if anything actually changed
    const dx = Math.abs(preview.x - caption.x);
    const dy = Math.abs(preview.y - caption.y);
    const dw = Math.abs(preview.width - caption.width);
    const dh = Math.abs(preview.height - caption.height);
    if (dx < 1 && dy < 1 && dw < 1 && dh < 1) return null;

    return {
      captionId: caption.id,
      captionSlug: caption.captionSlug || "",
      shape: caption.shape,
      x: Math.round(preview.x),
      y: Math.round(preview.y),
      width: Math.round(preview.width),
      height: Math.round(preview.height),
      polygonPoints: preview.polygonPoints?.map((p) => ({
        x: Math.round(p.x),
        y: Math.round(p.y),
      })),
    };
  }, []);

  /**
   * Get the appropriate cursor for the current hover position.
   * Returns a CSS cursor string, or null if not hovering anything transformable.
   */
  const getCursor = useCallback(
    (
      x: number,
      y: number,
      captions: CaptionData[],
      selectedCaptionId: string | null,
    ): string | null => {
      if (!selectedCaptionId) return null;

      const caption = captions.find((c) => c.id === selectedCaptionId);
      if (!caption) return null;

      // Check handle hover
      const handle = CanvasRenderer.hitTestHandle(x, y, caption);
      if (handle) {
        return CanvasRenderer.getCursorForHandle(handle);
      }

      // Check body hover
      const hitId = CanvasRenderer.hitTestCaption(x, y, [caption]);
      if (hitId === caption.id) {
        return "move";
      }

      return null;
    },
    [],
  );

  return {
    isActive,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    get preview(): TransformPreview | null {
      return previewRef.current;
    },
    getCursor,
    get mode(): TransformMode {
      return modeRef.current;
    },
    get activeHandle(): HandleType | null {
      return handleRef.current;
    },
  };
}
