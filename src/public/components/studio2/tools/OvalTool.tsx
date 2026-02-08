import { useRef } from "react";
import type { Canvas, Ellipse, TPointerEvent, TPointerEventInfo } from "fabric";
import { Ellipse as FabricEllipse } from "fabric";
import { StudioToolType } from "../types";
import type { StudioTool } from "../types";
import { MaskingToolHandlerBase } from "./MaskingToolHandlerBase";

/**
 * Oval tool button component
 */
interface OvalToolButtonProps {
  tool: StudioTool;
  onToggle: (tool: StudioTool) => void;
}

export function OvalToolButton({ tool, onToggle }: OvalToolButtonProps) {
  const isActive = tool === StudioToolType.OVAL;

  return (
    <button
      onClick={() =>
        onToggle(isActive ? StudioToolType.NONE : StudioToolType.OVAL)
      }
      className={`aspect-square rounded flex items-center justify-center transition-colors ${
        isActive
          ? "bg-pink-500 text-white"
          : "bg-gray-700 text-gray-300 hover:bg-gray-600"
      }`}
      title="Oval Tool"
    >
      <i className="fa-regular fa-circle text-xl"></i>
    </button>
  );
}

/**
 * Oval tool handler class
 */
export class OvalToolHandler extends MaskingToolHandlerBase<Ellipse> {
  private currentEllipse: Ellipse | null = null;
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

    // Clean up any in-progress ellipse
    if (this.currentEllipse) {
      this.canvas.remove(this.currentEllipse);
      this.currentEllipse = null;
    }
    this.startPoint = null;
  }

  /**
   * Handle mouse down - start drawing ellipse
   */
  handleMouseDown = (event: TPointerEventInfo<TPointerEvent>): void => {
    const pointer = this.canvas.getViewportPoint(event.e);
    const x = pointer.x;
    const y = pointer.y;

    this.startPoint = { x, y };

    const ellipse = new FabricEllipse({
      left: x,
      top: y,
      rx: 0,
      ry: 0,
      strokeWidth: 2,
      stroke: "rgba(236, 72, 153, 0.8)",
      fill: "rgba(236, 72, 153, 0.1)",
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      originX: "center",
      originY: "center",
    });

    this.canvas.add(ellipse);
    this.currentEllipse = ellipse;
    this.canvas.renderAll();
  };

  /**
   * Handle mouse move - update ellipse size
   */
  handleMouseMove = (event: TPointerEventInfo<TPointerEvent>): void => {
    if (!this.startPoint || !this.currentEllipse) return;

    const pointer = this.canvas.getViewportPoint(event.e);
    const x = pointer.x;
    const y = pointer.y;

    const rx = Math.abs(x - this.startPoint.x) / 2;
    const ry = Math.abs(y - this.startPoint.y) / 2;
    const centerX = (x + this.startPoint.x) / 2;
    const centerY = (y + this.startPoint.y) / 2;

    this.currentEllipse.set({ left: centerX, top: centerY, rx, ry });
    this.canvas.renderAll();
  };

  /**
   * Handle mouse up - finalize ellipse
   */
  handleMouseUp = (): void => {
    if (!this.currentEllipse || !this.startPoint) return;

    const ellipse = this.currentEllipse;
    ellipse.set({
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
    });

    // Only save if ellipse is large enough
    if (ellipse.rx! > 5 && ellipse.ry! > 5) {
      this.onSaveHistory(ellipse);
    } else {
      this.canvas.remove(ellipse);
    }

    this.currentEllipse = null;
    this.startPoint = null;
    this.canvas.renderAll();
  };

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
 * Hook to use Oval tool
 */
export function useOvalTool(
  canvas: Canvas | null,
  isActive: boolean,
  onSaveHistory: (obj: Ellipse) => void,
) {
  const handlerRef = useRef<OvalToolHandler | null>(null);

  if (!canvas) return;

  // Create handler if active and not exists
  if (isActive && !handlerRef.current) {
    handlerRef.current = new OvalToolHandler(canvas, onSaveHistory);
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
