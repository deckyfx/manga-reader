import { useRef, useEffect } from "react";
import type {
  Canvas,
  Polygon,
  Circle,
  TPointerEventInfo,
  TPointerEvent,
} from "fabric";
import { Polygon as FabricPolygon, Circle as FabricCircle } from "fabric";
import { Polyline } from "fabric";
import type { ExtendedPolygon, MaskData } from "../../../types/fabric-extensions";
import { StudioToolType } from "../types";
import type { StudioTool } from "../types";
import { MaskingToolHandlerBase } from "./MaskingToolHandlerBase";
import { useStudioStore } from "../../../stores/studioFabricStore";

/**
 * Polygon tool button component
 */
interface PolygonToolButtonProps {
  tool: StudioTool;
  onToggle: (tool: StudioTool) => void;
}

export function PolygonToolButton({ tool, onToggle }: PolygonToolButtonProps) {
  const isActive = tool === StudioToolType.POLYGON;

  return (
    <button
      onClick={() =>
        onToggle(isActive ? StudioToolType.NONE : StudioToolType.POLYGON)
      }
      className={`aspect-square rounded flex items-center justify-center transition-colors ${
        isActive
          ? "bg-pink-500 text-white"
          : "bg-gray-700 text-gray-300 hover:bg-gray-600"
      }`}
      title="Polygon Tool"
    >
      <i className="fa-solid fa-draw-polygon text-xl"></i>
    </button>
  );
}

/**
 * Polygon tool handler class
 */
export class PolygonToolHandler extends MaskingToolHandlerBase<Polygon> {
  private points: { x: number; y: number }[] = [];
  private polyline: Polyline | null = null;
  private dots: Circle[] = [];
  private onPointsChange: (points: { x: number; y: number }[]) => void;

  constructor(
    canvas: Canvas,
    onSaveHistory: (obj: Polygon) => void,
    onPointsChange: (points: { x: number; y: number }[]) => void,
  ) {
    super(canvas, onSaveHistory);
    this.onPointsChange = onPointsChange;
  }

  /**
   * Activate tool - set cursor
   */
  protected onActivate(): void {
    this.canvas.defaultCursor = "crosshair";
    this.canvas.hoverCursor = "crosshair";
    this.canvas.renderAll();
  }

  /**
   * Deactivate tool - reset cursor and clear temporary state
   */
  protected onDeactivate(): void {
    this.canvas.defaultCursor = "default";
    this.canvas.hoverCursor = "move";

    // Remove temporary visuals
    if (this.polyline) {
      this.canvas.remove(this.polyline);
      this.polyline = null;
    }

    this.dots.forEach((dot) => this.canvas.remove(dot));
    this.dots = [];

    this.points = [];
    this.onPointsChange([]);
  }

  /**
   * Handle mouse down - add polygon point
   */
  handleMouseDown = (event: TPointerEventInfo<TPointerEvent>): void => {
    const pointer = this.canvas.getViewportPoint(event.e);
    const x = pointer.x;
    const y = pointer.y;

    // Add point
    this.points.push({ x, y });
    // Pass new array reference so React/Zustand detects the change
    this.onPointsChange([...this.points]);

    // Add visual dot for this point
    const dot = new FabricCircle({
      left: x,
      top: y,
      radius: 4,
      fill: "rgba(236, 72, 153, 1)",
      originX: "center",
      originY: "center",
      selectable: false,
      evented: false,
    });
    this.canvas.add(dot);
    this.dots.push(dot);

    // Update or create polyline
    if (this.points.length === 2) {
      // Second point - create polyline (need at least 2 points to draw a line)
      this.polyline = new Polyline([...this.points], {
        stroke: "rgba(236, 72, 153, 0.8)",
        strokeWidth: 2,
        fill: "",
        selectable: false,
        evented: false,
      });
      this.canvas.add(this.polyline);
    } else if (this.polyline && this.points.length > 2) {
      // Third point onwards - remove old polyline and create new one
      this.canvas.remove(this.polyline);
      this.polyline = new Polyline([...this.points], {
        stroke: "rgba(236, 72, 153, 0.8)",
        strokeWidth: 2,
        fill: "",
        selectable: false,
        evented: false,
      });
      this.canvas.add(this.polyline);
    }

    this.canvas.renderAll();
  }

  /**
   * Handle mouse move - not used for polygon tool
   */
  handleMouseMove = (): void => {
    // No-op: Polygon tool doesn't use mouse move
  };

  /**
   * Handle mouse up - not used for polygon tool
   */
  handleMouseUp = (): void => {
    // No-op: Polygon tool uses double-click to finish
  };

  /**
   * Handle double click - finish polygon
   */
  private handleDblClick = (): void => {
    this.finish();
  }

  /**
   * Finish polygon and save to history
   */
  finish(): void {
    if (this.points.length < 3) return;

    // Create polygon from points
    const polygon = new FabricPolygon(this.points, {
      strokeWidth: 2,
      stroke: "rgba(236, 72, 153, 0.8)",
      fill: "rgba(236, 72, 153, 0.1)",
      selectable: true,    // Make clickable
      evented: true,       // Enable events
      hasControls: false,  // No resize handles
      hasBorders: false,   // No border
    }) as ExtendedPolygon;

    // Assign unique ID
    polygon.id = `polygon-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Assign mask data
    const maskData: MaskData = { type: "mask" };
    polygon.data = maskData;

    // Add to canvas and save
    this.canvas.add(polygon);
    this.onSaveHistory(polygon);

    // Automatically select the newly created polygon to make it clickable
    this.canvas.setActiveObject(polygon);

    // Remove temporary visuals
    if (this.polyline) {
      this.canvas.remove(this.polyline);
      this.polyline = null;
    }

    this.dots.forEach((dot) => this.canvas.remove(dot));
    this.dots = [];

    // Reset state
    this.points = [];
    this.onPointsChange(this.points);
    this.canvas.renderAll();
  }

  /**
   * Get current points
   */
  getPoints(): { x: number; y: number }[] {
    return this.points;
  }

  /**
   * Attach event handlers to canvas
   */
  protected attachEventHandlers(): void {
    this.canvas.on("mouse:down", this.handleMouseDown);
    this.canvas.on("mouse:dblclick", this.handleDblClick);
  }

  /**
   * Detach event handlers from canvas
   */
  protected detachEventHandlers(): void {
    this.canvas.off("mouse:down", this.handleMouseDown);
    this.canvas.off("mouse:dblclick", this.handleDblClick);
  }
}

/**
 * Polygon finish button component - manages its own state via Zustand
 */
export function PolygonFinishButton() {
  const tool = useStudioStore((state) => state.tool);
  const polygonPoints = useStudioStore((state) => state.polygonPoints);
  const fabricCanvas = useStudioStore((state) => state.fabricCanvas);
  const saveHistory = useStudioStore((state) => state.saveHistory);
  const setPolygonPoints = useStudioStore((state) => state.setPolygonPoints);

  // Don't show if not in polygon mode or less than 3 points
  if (tool !== StudioToolType.POLYGON || polygonPoints.length < 3) {
    return null;
  }

  const handleFinish = () => {
    if (!fabricCanvas || polygonPoints.length < 3) return;

    // Create polygon from points
    const polygon = new FabricPolygon(polygonPoints, {
      strokeWidth: 2,
      stroke: "rgba(236, 72, 153, 0.8)",
      fill: "rgba(236, 72, 153, 0.1)",
      selectable: true,    // Make clickable
      evented: true,       // Enable events
      hasControls: false,  // No resize handles
      hasBorders: false,   // No border
    }) as ExtendedPolygon;

    // Assign unique ID
    polygon.id = `polygon-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Assign mask data
    const maskData: MaskData = { type: "mask" };
    polygon.data = maskData;

    // Add to canvas and save
    fabricCanvas.add(polygon);
    saveHistory(polygon);

    // Automatically select the newly created polygon to make it clickable
    fabricCanvas.setActiveObject(polygon);

    // Remove temporary visuals
    const objects = fabricCanvas.getObjects();
    objects.forEach((obj) => {
      // Remove dots and polylines (temporary visual helpers)
      if (
        obj.type === "circle" ||
        (obj.type === "polyline" && obj.fill === "")
      ) {
        fabricCanvas.remove(obj);
      }
    });

    // Reset points
    setPolygonPoints([]);
    fabricCanvas.renderAll();
  };

  return (
    <button
      onClick={handleFinish}
      className="absolute top-4 left-1/2 -translate-x-1/2 bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded-lg font-semibold shadow-lg z-50"
    >
      Finish Polygon ({polygonPoints.length} points)
    </button>
  );
}

/**
 * Hook to use Polygon tool - uses Zustand store for state
 */
export function usePolygonTool(
  canvas: Canvas | null,
  isActive: boolean,
  onSaveHistory: (obj: Polygon) => void
) {
  const handlerRef = useRef<PolygonToolHandler | null>(null);
  const setPolygonPoints = useStudioStore((state) => state.setPolygonPoints);

  useEffect(() => {
    if (!canvas) return;

    // Create handler if active and not exists
    if (isActive && !handlerRef.current) {
      handlerRef.current = new PolygonToolHandler(
        canvas,
        onSaveHistory,
        setPolygonPoints
      );
      handlerRef.current.attach();
    }

    // Cleanup handler if inactive
    if (!isActive && handlerRef.current) {
      handlerRef.current.dispose();
      handlerRef.current = null;
    }

    // Cleanup on unmount
    return () => {
      if (handlerRef.current) {
        handlerRef.current.dispose();
        handlerRef.current = null;
      }
    };
  }, [canvas, isActive, onSaveHistory, setPolygonPoints]);
}
