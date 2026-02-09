import { useRef } from "react";
import type { Canvas, FabricObject, CanvasEvents } from "fabric";
import { PencilBrush } from "fabric";
import { StudioToolType } from "../types";
import type { StudioTool } from "../types";
import { MaskingToolHandlerBase } from "./MaskingToolHandlerBase";

/**
 * Brush tool button component
 */
interface BrushToolButtonProps {
  tool: StudioTool;
  onToggle: (tool: StudioTool) => void;
}

export function BrushToolButton({ tool, onToggle }: BrushToolButtonProps) {
  const isActive = tool === StudioToolType.BRUSH;

  return (
    <button
      onClick={() =>
        onToggle(isActive ? StudioToolType.NONE : StudioToolType.BRUSH)
      }
      className={`px-3 py-2 rounded flex items-center justify-center transition-colors ${
        isActive
          ? "bg-pink-500 text-white"
          : "bg-gray-700 text-gray-300 hover:bg-gray-600"
      }`}
      title="Brush Tool"
    >
      <i className="fa-solid fa-paintbrush text-xl"></i>
    </button>
  );
}

/**
 * Brush tool handler class
 */
export class BrushToolHandler extends MaskingToolHandlerBase<FabricObject> {
  private brush: PencilBrush;

  constructor(canvas: Canvas, onSaveHistory: (obj: FabricObject) => void) {
    super(canvas, onSaveHistory);

    // Configure brush
    this.brush = new PencilBrush(canvas);
    this.brush.color = "rgba(236, 72, 153, 0.5)"; // Pink semi-transparent
    this.brush.width = 20;
    this.canvas.freeDrawingBrush = this.brush;
  }

  /**
   * Activate drawing mode
   */
  protected onActivate(): void {
    this.canvas.isDrawingMode = true;
  }

  /**
   * Deactivate drawing mode
   */
  protected onDeactivate(): void {
    this.canvas.isDrawingMode = false;
  }

  /**
   * Handle mouse down - not used for brush tool
   */
  handleMouseDown = (): void => {
    // No-op: Brush tool uses isDrawingMode
  };

  /**
   * Handle mouse move - not used for brush tool
   */
  handleMouseMove = (): void => {
    // No-op: Brush tool uses isDrawingMode
  };

  /**
   * Handle mouse up - not used for brush tool
   */
  handleMouseUp = (): void => {
    // No-op: Brush tool uses isDrawingMode
  };

  /**
   * Handle path created - save brush stroke to history
   */
  private handlePathCreated = (e: CanvasEvents["path:created"]): void => {
    const path = e.path;

    // Make path non-selectable and non-interactive
    path.set({
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
    });

    // Save to history
    this.onSaveHistory(path);
  }

  /**
   * Set brush size
   */
  setBrushSize(size: number): void {
    this.brush.width = size;
  }

  /**
   * Set brush color
   */
  setBrushColor(color: string): void {
    this.brush.color = color;
  }

  /**
   * Attach event handlers to canvas
   */
  protected attachEventHandlers(): void {
    this.canvas.on("path:created", this.handlePathCreated);
  }

  /**
   * Detach event handlers from canvas
   */
  protected detachEventHandlers(): void {
    this.canvas.off("path:created", this.handlePathCreated);
  }
}

/**
 * Hook to use Brush tool
 */
export function useBrushTool(
  canvas: Canvas | null,
  isActive: boolean,
  onSaveHistory: (obj: FabricObject) => void,
) {
  const handlerRef = useRef<BrushToolHandler | null>(null);

  if (!canvas) return;

  // Create handler if active and not exists
  if (isActive && !handlerRef.current) {
    handlerRef.current = new BrushToolHandler(canvas, onSaveHistory);
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
