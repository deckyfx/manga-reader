import { useState } from "react";

interface OvalDrawState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface OvalResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OvalRenderData {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

interface UseOvalToolResult {
  currentDraw: OvalDrawState | null;
  handleMouseDown: (x: number, y: number) => void;
  handleMouseMove: (x: number, y: number) => void;
  handleMouseUp: () => OvalResult | null;
  reset: () => void;
  getRenderData: () => OvalRenderData | null;
}

/**
 * Hook for oval drawing tool
 *
 * Handles drawing state for elliptical selections. Drag to define bounding box,
 * result is the bounding box only — ellipse points are derived on-the-fly
 * via getRegionPolygonPoints() from region-types.ts.
 */
export function useOvalTool(): UseOvalToolResult {
  const [currentDraw, setCurrentDraw] = useState<OvalDrawState | null>(null);

  /** Start drawing oval */
  const handleMouseDown = (x: number, y: number) => {
    setCurrentDraw({
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
    });
  };

  /** Update oval size while dragging */
  const handleMouseMove = (x: number, y: number) => {
    if (!currentDraw) return;

    setCurrentDraw({
      ...currentDraw,
      currentX: x,
      currentY: y,
    });
  };

  /**
   * Finish drawing and return bounding box (no points — derived on-the-fly).
   * Returns null if oval is too small (< 20px in either dimension).
   */
  const handleMouseUp = (): OvalResult | null => {
    if (!currentDraw) return null;

    const x = Math.min(currentDraw.startX, currentDraw.currentX);
    const y = Math.min(currentDraw.startY, currentDraw.currentY);
    const width = Math.abs(currentDraw.currentX - currentDraw.startX);
    const height = Math.abs(currentDraw.currentY - currentDraw.startY);

    setCurrentDraw(null);

    if (width < 20 || height < 20) {
      return null;
    }

    return { x, y, width, height };
  };

  /** Reset drawing state */
  const reset = () => {
    setCurrentDraw(null);
  };

  /** Get ellipse render data (center + radii) for live preview */
  const getRenderData = (): OvalRenderData | null => {
    if (!currentDraw) return null;

    const x = Math.min(currentDraw.startX, currentDraw.currentX);
    const y = Math.min(currentDraw.startY, currentDraw.currentY);
    const width = Math.abs(currentDraw.currentX - currentDraw.startX);
    const height = Math.abs(currentDraw.currentY - currentDraw.startY);

    return {
      cx: x + width / 2,
      cy: y + height / 2,
      rx: width / 2,
      ry: height / 2,
    };
  };

  return {
    currentDraw,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    reset,
    getRenderData,
  };
}
