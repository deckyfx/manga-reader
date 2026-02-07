import { useRectangleTool } from "./useRectangleTool";
import { usePolygonTool } from "./usePolygonTool";
import { useOvalTool } from "./useOvalTool";

export type DrawingToolType = "none" | "rectangle" | "polygon" | "oval";

interface Point {
  x: number;
  y: number;
}

interface DrawingResult {
  x: number;
  y: number;
  width: number;
  height: number;
  points?: Point[]; // Only for polygon
}

interface UseDrawingToolResult {
  // Mouse handlers (normalized API)
  handleMouseDown: (x: number, y: number, isDoubleClick?: boolean) => void;
  handleMouseMove: (x: number, y: number) => void;
  handleMouseUp: () => DrawingResult | null;
  finishPolygon: () => DrawingResult | null;
  reset: () => void;

  // Render data
  rectangleRenderData: { x: number; y: number; width: number; height: number } | null;
  polygonRenderData: { points: Point[]; cursorPos: Point | null } | null;
  ovalRenderData: { cx: number; cy: number; rx: number; ry: number } | null;

  // Current tool info
  isDrawing: boolean;
}

/**
 * Main drawing tool hook that manages rectangle and polygon tools
 *
 * Switches between tools and provides a unified API
 *
 * @example
 * ```tsx
 * const drawing = useDrawingTool(drawingTool);
 *
 * <div
 *   onMouseDown={(e) => drawing.handleMouseDown(e.clientX, e.clientY, e.detail === 2)}
 *   onMouseMove={(e) => drawing.handleMouseMove(e.clientX, e.clientY)}
 *   onMouseUp={() => {
 *     const result = drawing.handleMouseUp();
 *     if (result) {
 *       // result.x, result.y, result.width, result.height, result.points (polygon only)
 *     }
 *   }}
 * />
 * ```
 */
export function useDrawingTool(toolType: DrawingToolType): UseDrawingToolResult {
  const rectangleTool = useRectangleTool();
  const polygonTool = usePolygonTool();
  const ovalTool = useOvalTool();

  const isNone = toolType === "none";
  const isRectangle = toolType === "rectangle";
  const isOval = toolType === "oval";
  const isPolygon = toolType === "polygon";

  /**
   * Handle mouse down - start drawing or add point
   */
  const handleMouseDown = (x: number, y: number, isDoubleClick = false) => {
    if (isNone) return;
    if (isRectangle) {
      rectangleTool.handleMouseDown(x, y);
    } else if (isOval) {
      ovalTool.handleMouseDown(x, y);
    } else {
      polygonTool.handleMouseDown(x, y, isDoubleClick);
    }
  };

  /**
   * Handle mouse move - update drawing
   */
  const handleMouseMove = (x: number, y: number) => {
    if (isRectangle) {
      rectangleTool.handleMouseMove(x, y);
    } else if (isOval) {
      ovalTool.handleMouseMove(x, y);
    } else {
      polygonTool.handleMouseMove(x, y);
    }
  };

  /**
   * Handle mouse up - finish drawing
   * Returns bounding box and points (for polygon/oval)
   */
  const handleMouseUp = (): DrawingResult | null => {
    if (isRectangle) {
      return rectangleTool.handleMouseUp();
    } else if (isOval) {
      return ovalTool.handleMouseUp();
    } else {
      return polygonTool.handleMouseUp();
    }
  };

  /**
   * Manually finish polygon drawing (for DONE button)
   */
  const finishPolygon = (): DrawingResult | null => {
    if (!isPolygon) {
      return null; // Only works for polygon
    }
    return polygonTool.finish();
  };

  /**
   * Reset drawing state
   */
  const reset = () => {
    rectangleTool.reset();
    polygonTool.reset();
    ovalTool.reset();
  };

  /**
   * Check if currently drawing
   */
  const isDrawing = isNone
    ? false
    : isRectangle
      ? rectangleTool.currentDraw !== null
      : isOval
        ? ovalTool.currentDraw !== null
        : polygonTool.points.length > 0;

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    finishPolygon,
    reset,
    rectangleRenderData: isRectangle ? rectangleTool.getRenderData() : null,
    polygonRenderData: isPolygon ? polygonTool.getRenderData() : null,
    ovalRenderData: isOval ? ovalTool.getRenderData() : null,
    isDrawing,
  };
}
