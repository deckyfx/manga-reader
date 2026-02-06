import { useState } from "react";

interface RectangleDrawState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface UseRectangleToolResult {
  currentDraw: RectangleDrawState | null;
  handleMouseDown: (x: number, y: number) => void;
  handleMouseMove: (x: number, y: number) => void;
  handleMouseUp: () => { x: number; y: number; width: number; height: number } | null;
  reset: () => void;
  getRenderData: () => { x: number; y: number; width: number; height: number } | null;
}

/**
 * Hook for rectangle drawing tool
 *
 * Handles the drawing state and calculations for rectangular selections
 */
export function useRectangleTool(): UseRectangleToolResult {
  const [currentDraw, setCurrentDraw] = useState<RectangleDrawState | null>(null);

  /**
   * Start drawing rectangle
   */
  const handleMouseDown = (x: number, y: number) => {
    setCurrentDraw({
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
    });
  };

  /**
   * Update rectangle size while dragging
   */
  const handleMouseMove = (x: number, y: number) => {
    if (!currentDraw) return;

    setCurrentDraw({
      ...currentDraw,
      currentX: x,
      currentY: y,
    });
  };

  /**
   * Finish drawing and return bounding box
   * Returns null if rectangle is too small (< 20px)
   */
  const handleMouseUp = () => {
    if (!currentDraw) return null;

    // Calculate rectangle dimensions
    const x = Math.min(currentDraw.startX, currentDraw.currentX);
    const y = Math.min(currentDraw.startY, currentDraw.currentY);
    const width = Math.abs(currentDraw.currentX - currentDraw.startX);
    const height = Math.abs(currentDraw.currentY - currentDraw.startY);

    // Reset drawing state
    setCurrentDraw(null);

    // Ignore very small rectangles (accidental clicks)
    if (width < 20 || height < 20) {
      return null;
    }

    return { x, y, width, height };
  };

  /**
   * Reset drawing state
   */
  const reset = () => {
    setCurrentDraw(null);
  };

  /**
   * Get normalized rectangle for rendering
   */
  const getRenderData = () => {
    if (!currentDraw) return null;

    return {
      x: Math.min(currentDraw.startX, currentDraw.currentX),
      y: Math.min(currentDraw.startY, currentDraw.currentY),
      width: Math.abs(currentDraw.currentX - currentDraw.startX),
      height: Math.abs(currentDraw.currentY - currentDraw.startY),
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
