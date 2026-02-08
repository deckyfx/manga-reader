import type { Canvas, FabricObject, TPointerEvent, TPointerEventInfo } from "fabric";

/**
 * Abstract base class for all tool handlers
 *
 * Provides consistent interface and lifecycle management for tools.
 * All tool handlers should extend this class and implement the abstract handlers.
 */
export abstract class MaskingToolHandlerBase<
  TObject extends FabricObject = FabricObject,
> {
  protected canvas: Canvas;
  protected onSaveHistory: (obj: TObject) => void;
  private isAttached: boolean = false;

  constructor(canvas: Canvas, onSaveHistory: (obj: TObject) => void) {
    this.canvas = canvas;
    this.onSaveHistory = onSaveHistory;
  }

  /**
   * Mouse down handler - must be implemented as arrow function property
   * Example: handleMouseDown = (event: TPointerEventInfo<TPointerEvent>): void => { ... }
   */
  abstract handleMouseDown: (event: TPointerEventInfo<TPointerEvent>) => void;

  /**
   * Mouse move handler - must be implemented as arrow function property
   * Example: handleMouseMove = (event: TPointerEventInfo<TPointerEvent>): void => { ... }
   */
  abstract handleMouseMove: (event: TPointerEventInfo<TPointerEvent>) => void;

  /**
   * Mouse up handler - must be implemented as arrow function property
   * Example: handleMouseUp = (): void => { ... }
   */
  abstract handleMouseUp: () => void;

  /**
   * Activate the tool (called when tool is selected)
   */
  protected abstract onActivate(): void;

  /**
   * Deactivate the tool (called when tool is deselected)
   */
  protected abstract onDeactivate(): void;

  /**
   * Attach event handlers to canvas
   * Subclasses should override this to add their event listeners
   */
  protected abstract attachEventHandlers(): void;

  /**
   * Detach event handlers from canvas
   * Subclasses should override this to remove their event listeners
   */
  protected abstract detachEventHandlers(): void;

  /**
   * Public method to activate and attach the tool
   */
  attach(): void {
    if (this.isAttached) return;

    this.onActivate();
    this.attachEventHandlers();
    this.isAttached = true;
  }

  /**
   * Public method to deactivate and detach the tool
   */
  detach(): void {
    if (!this.isAttached) return;

    this.onDeactivate();
    this.detachEventHandlers();
    this.isAttached = false;
  }

  /**
   * Cleanup resources and detach
   */
  dispose(): void {
    this.detach();
  }

  /**
   * Check if tool is currently attached
   */
  isActive(): boolean {
    return this.isAttached;
  }
}
