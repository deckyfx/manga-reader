import { useState } from "react";

interface Point {
  x: number;
  y: number;
}

interface UsePolygonToolResult {
  points: Point[];
  handleMouseDown: (x: number, y: number, isDoubleClick: boolean) => void;
  handleMouseMove: (x: number, y: number) => void;
  handleMouseUp: () => { x: number; y: number; width: number; height: number; points: Point[] } | null;
  finish: () => { x: number; y: number; width: number; height: number; points: Point[] } | null;
  reset: () => void;
  getRenderData: () => { points: Point[]; cursorPos: Point | null } | null;
}

/**
 * Hook for polygon drawing tool
 *
 * Handles the drawing state and calculations for polygon selections
 * - Single click: Add point
 * - Double click: Close polygon
 */
export function usePolygonTool(): UsePolygonToolResult {
  const [points, setPoints] = useState<Point[]>([]);
  const [shouldClose, setShouldClose] = useState(false);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);

  /**
   * Check if a point is too close to any existing point
   */
  const isTooCloseToExistingPoint = (x: number, y: number, threshold = 10): boolean => {
    return points.some((point) => {
      const dx = point.x - x;
      const dy = point.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      return distance < threshold;
    });
  };

  /**
   * Add point to polygon or signal to close polygon
   */
  const handleMouseDown = (x: number, y: number, isDoubleClick: boolean) => {
    if (isDoubleClick) {
      // Double-click: Signal to close polygon (don't add point)
      setShouldClose(true);
      return;
    }

    // Prevent adding point if too close to existing point
    if (isTooCloseToExistingPoint(x, y)) {
      return;
    }

    // Single-click: Add point
    setPoints([...points, { x, y }]);
  };

  /**
   * Update cursor position (for preview line)
   */
  const handleMouseMove = (x: number, y: number) => {
    // Track cursor position for preview line
    if (points.length > 0) {
      setCursorPos({ x, y });
    }
  };

  /**
   * Close polygon and return bounding box + points
   * Only closes if shouldClose flag is set (via double-click)
   * Returns null if not ready to close or polygon has < 3 points
   */
  const handleMouseUp = () => {
    // Only close if double-click happened AND we have enough points
    if (!shouldClose || points.length < 3) {
      setShouldClose(false); // Reset flag for next time
      return null;
    }

    // Calculate bounding box
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;

    // Reset state
    const polygonPoints = [...points];
    setPoints([]);
    setShouldClose(false);

    // Ignore very small polygons
    if (width < 20 || height < 20) {
      return null;
    }

    return { x, y, width, height, points: polygonPoints };
  };

  /**
   * Manually finish/close the polygon
   * Used by the "DONE" button
   */
  const finish = () => {
    if (points.length < 3) {
      return null;
    }

    // Calculate bounding box
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;

    // Reset state
    const polygonPoints = [...points];
    setPoints([]);
    setCursorPos(null);
    setShouldClose(false);

    // Ignore very small polygons
    if (width < 20 || height < 20) {
      return null;
    }

    return { x, y, width, height, points: polygonPoints };
  };

  /**
   * Reset drawing state
   */
  const reset = () => {
    setPoints([]);
    setCursorPos(null);
    setShouldClose(false);
  };

  /**
   * Get points and cursor position for rendering
   */
  const getRenderData = () => {
    return points.length > 0 ? { points, cursorPos } : null;
  };

  return {
    points,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    finish,
    reset,
    getRenderData,
  };
}
