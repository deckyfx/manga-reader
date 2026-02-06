import type { DrawingToolType } from "../hooks/useDrawingTool";

interface Point {
  x: number;
  y: number;
}

interface DrawingResult {
  x: number;
  y: number;
  width: number;
  height: number;
  points?: Point[];
}

interface DrawingState {
  rectangleRenderData: { x: number; y: number; width: number; height: number } | null;
  polygonRenderData: { points: Point[]; cursorPos: Point | null } | null;
  finishPolygon: () => DrawingResult | null;
}

interface DrawingOverlayProps {
  drawingTool: DrawingToolType;
  drawing: DrawingState;
  editMode: boolean;
  onComplete: (result: DrawingResult) => void;
}

/**
 * DrawingOverlay Component
 *
 * Displays drawing preview for rectangle and polygon tools
 * - Shows blue rectangle preview while drawing rectangles
 * - Shows purple polygon preview with points and cursor while drawing polygons
 * - Displays DONE button for polygon tool to finish drawing
 * - Manages its own preview rendering state
 */
export function DrawingOverlay({
  drawingTool,
  drawing,
  editMode,
  onComplete,
}: DrawingOverlayProps) {
  if (!editMode) return null;

  const handlePolygonDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    const result = drawing.finishPolygon();
    if (result) {
      onComplete(result);
    }
  };

  const handlePolygonDoneMouseDown = (e: React.MouseEvent) => {
    // Stop propagation on mousedown to prevent adding extra point
    e.stopPropagation();
  };

  return (
    <>
      {/* Rectangle drawing preview */}
      {drawing.rectangleRenderData && (
        <div
          className="absolute border-2 border-blue-500 bg-blue-300 bg-opacity-30 pointer-events-none"
          style={{
            left: drawing.rectangleRenderData.x,
            top: drawing.rectangleRenderData.y,
            width: drawing.rectangleRenderData.width,
            height: drawing.rectangleRenderData.height,
          }}
        />
      )}

      {/* Polygon drawing preview */}
      {drawing.polygonRenderData && drawing.polygonRenderData.points.length > 0 && (
        <svg
          className="absolute inset-0 pointer-events-none"
          style={{ width: "100%", height: "100%" }}
        >
          {/* Filled polygon (3+ points) */}
          {drawing.polygonRenderData.points.length >= 3 && (
            <polygon
              points={drawing.polygonRenderData.points
                .map((p) => `${p.x},${p.y}`)
                .join(" ")}
              fill="rgba(147, 51, 234, 0.3)"
              stroke="#9333ea"
              strokeWidth="2"
            />
          )}

          {/* Connecting lines (2 points) */}
          {drawing.polygonRenderData.points.length >= 2 &&
            drawing.polygonRenderData.points.length < 3 && (
              <polyline
                points={drawing.polygonRenderData.points
                  .map((p) => `${p.x},${p.y}`)
                  .join(" ")}
                fill="none"
                stroke="#9333ea"
                strokeWidth="2"
              />
            )}

          {/* Preview line from last point to cursor */}
          {drawing.polygonRenderData.cursorPos &&
            drawing.polygonRenderData.points.length > 0 &&
            (() => {
              const lastPoint =
                drawing.polygonRenderData!.points[
                  drawing.polygonRenderData!.points.length - 1
                ];
              return (
                <line
                  x1={lastPoint!.x}
                  y1={lastPoint!.y}
                  x2={drawing.polygonRenderData!.cursorPos!.x}
                  y2={drawing.polygonRenderData!.cursorPos!.y}
                  stroke="#9333ea"
                  strokeWidth="2"
                  strokeDasharray="5,5"
                />
              );
            })()}

          {/* Draw points with enhanced visibility */}
          {drawing.polygonRenderData.points.map((point, i) => (
            <g key={i}>
              <circle
                cx={point.x}
                cy={point.y}
                r="6"
                fill="#9333ea"
                stroke="white"
                strokeWidth="2"
              />
              {/* Mark first point with double ring */}
              {i === 0 && (
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="9"
                  fill="none"
                  stroke="#9333ea"
                  strokeWidth="2"
                />
              )}
            </g>
          ))}
        </svg>
      )}

      {/* DONE button for polygon (positioned near first point) */}
      {drawingTool === "polygon" &&
        drawing.polygonRenderData &&
        drawing.polygonRenderData.points.length > 0 && (
          <button
            onClick={handlePolygonDone}
            onMouseDown={handlePolygonDoneMouseDown}
            className="absolute bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded-lg font-semibold shadow-lg z-50"
            style={{
              left: drawing.polygonRenderData.points[0]!.x - 30,
              top: drawing.polygonRenderData.points[0]!.y - 35,
              pointerEvents: "auto",
            }}
          >
            DONE
          </button>
        )}
    </>
  );
}
