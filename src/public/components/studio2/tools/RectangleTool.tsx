import { useRef } from "react";
import type { Canvas, Rect, TPointerEvent, TPointerEventInfo } from "fabric";
import { Rect as FabricRect } from "fabric";
import { StudioToolType } from "../types";
import type { StudioTool } from "../types";
import { MaskingToolHandlerBase } from "./MaskingToolHandlerBase";

/**
 * Rectangle tool button component
 */
interface RectangleToolButtonProps {
  tool: StudioTool;
  onToggle: (tool: StudioTool) => void;
}

export function RectangleToolButton({
  tool,
  onToggle,
}: RectangleToolButtonProps) {
  const isActive = tool === StudioToolType.RECTANGLE;

  return (
    <button
      onClick={() =>
        onToggle(isActive ? StudioToolType.NONE : StudioToolType.RECTANGLE)
      }
      className={`aspect-square rounded flex items-center justify-center transition-colors ${
        isActive
          ? "bg-pink-500 text-white"
          : "bg-gray-700 text-gray-300 hover:bg-gray-600"
      }`}
      title="Rectangle Tool"
    >
      <i className="fa-regular fa-square text-xl"></i>
    </button>
  );
}

/**
 * Rectangle tool handler class
 */
export class RectangleToolHandler extends MaskingToolHandlerBase<Rect> {
  private currentRect: Rect | null = null;
  private startPoint: { x: number; y: number } | null = null;

  /**
   * Activate tool - set cursor
   */
  protected onActivate(): void {
    this.canvas.defaultCursor = "crosshair";
    this.canvas.hoverCursor = "crosshair";
    this.canvas.renderAll();
  }

  /**
   * Deactivate tool - reset cursor
   */
  protected onDeactivate(): void {
    this.canvas.defaultCursor = "default";
    this.canvas.hoverCursor = "move";

    // Clean up any in-progress rectangle
    if (this.currentRect) {
      this.canvas.remove(this.currentRect);
      this.currentRect = null;
    }
    this.startPoint = null;
  }

  /**
   * Handle mouse down - start drawing rectangle
   */
  handleMouseDown = (event: TPointerEventInfo<TPointerEvent>): void => {
    const pointer = this.canvas.getViewportPoint(event.e);
    const x = pointer.x;
    const y = pointer.y;

    this.startPoint = { x, y };

    const rect = new FabricRect({
      left: x,
      top: y,
      width: 0,
      height: 0,
      strokeWidth: 2,
      stroke: "rgba(236, 72, 153, 0.8)",
      fill: "rgba(236, 72, 153, 0.1)",
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      originX: "left",
      originY: "top",
    });

    this.canvas.add(rect);
    this.currentRect = rect;
    this.canvas.renderAll();
  }

  /**
   * Handle mouse move - update rectangle size
   */
  handleMouseMove = (event: TPointerEventInfo<TPointerEvent>): void => {
    if (!this.startPoint || !this.currentRect) return;

    const pointer = this.canvas.getViewportPoint(event.e);
    const x = pointer.x;
    const y = pointer.y;

    const width = Math.abs(x - this.startPoint.x);
    const height = Math.abs(y - this.startPoint.y);
    const left = x < this.startPoint.x ? x : this.startPoint.x;
    const top = y < this.startPoint.y ? y : this.startPoint.y;

    this.currentRect.set({ left, top, width, height });
    this.canvas.renderAll();
  }

  /**
   * Handle mouse up - finalize rectangle
   */
  handleMouseUp = (): void => {
    if (!this.currentRect || !this.startPoint) return;

    const rect = this.currentRect;
    rect.set({
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
    });

    // Only save if rectangle is large enough
    if (rect.width! > 5 && rect.height! > 5) {
      this.onSaveHistory(rect);
    } else {
      this.canvas.remove(rect);
    }

    this.currentRect = null;
    this.startPoint = null;
    this.canvas.renderAll();
  }

  /**
   * Attach event handlers to canvas
   */
  protected attachEventHandlers(): void {
    this.canvas.on("mouse:down", this.handleMouseDown);
    this.canvas.on("mouse:move", this.handleMouseMove);
    this.canvas.on("mouse:up", this.handleMouseUp);
  }

  /**
   * Detach event handlers from canvas
   */
  protected detachEventHandlers(): void {
    this.canvas.off("mouse:down", this.handleMouseDown);
    this.canvas.off("mouse:move", this.handleMouseMove);
    this.canvas.off("mouse:up", this.handleMouseUp);
  }
}

/**
 * Hook to use Rectangle tool
 */
export function useRectangleTool(
  canvas: Canvas | null,
  isActive: boolean,
  onSaveHistory: (obj: Rect) => void,
) {
  const handlerRef = useRef<RectangleToolHandler | null>(null);

  if (!canvas) return;

  // Create handler if active and not exists
  if (isActive && !handlerRef.current) {
    handlerRef.current = new RectangleToolHandler(canvas, onSaveHistory);
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
}
