import { FabricObject } from "fabric";
import type { LetteringPaths } from "../../api";

/** Lettering objects → block ids, kept outside Fabric so objects stay plain instances. */
const letteringIds = new WeakMap<FabricObject, number>();

export const letteringIdOf = (obj: FabricObject | null | undefined): number | undefined => (obj ? letteringIds.get(obj) : undefined);

type FabricObjectOptions = ConstructorParameters<typeof FabricObject>[0];

/**
 * A block's lettering floating on the page, WordArt-style: grab it anywhere to move it, drag the handles to resize its
 * text box, or the top knob to rotate it. The glyphs are drawn as vector paths from the shared typesetter, so they stay
 * sharp at any zoom and match the burn. While a resize is in progress the object is scaled; the text is drawn
 * unscaled inside the enlarged box (the canvas re-wraps it live).
 */
export class LetteringObject extends FabricObject {
  static type = "Lettering";

  paths: LetteringPaths | null = null;
  /** Draws the text box outline (Lettering mode). */
  showFrame = false;
  /** The text didn't fit its box: the outline turns amber. */
  overflow = false;
  private path2d: Path2D | null = null;

  constructor(blockId: number, options?: FabricObjectOptions) {
    super(options);
    letteringIds.set(this, blockId);
  }

  setPaths(paths: LetteringPaths | null): void {
    if (paths?.d !== this.paths?.d) this.path2d = paths ? new Path2D(paths.d) : null;
    this.paths = paths;
    this.dirty = true;
  }

  _render(ctx: CanvasRenderingContext2D): void {
    const scaleX = this.scaleX || 1, scaleY = this.scaleY || 1;
    const w = this.width * scaleX, h = this.height * scaleY;
    ctx.save();
    // Undo the object's scale so glyphs keep their size in a box being resized, then work in page pixels
    ctx.scale(1 / scaleX, 1 / scaleY);
    ctx.translate(-w / 2, -h / 2);
    if (this.showFrame) {
      const zoom = this.canvas?.getZoom() ?? 1;
      ctx.save();
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.lineWidth = 1 / zoom;
      ctx.strokeStyle = this.overflow ? "rgba(245, 158, 11, 0.95)" : "rgba(167, 139, 250, 0.8)";
      ctx.strokeRect(0, 0, w, h);
      ctx.restore();
    }
    if (this.paths && this.path2d) {
      if (this.paths.strokeWidth > 0) {
        ctx.lineJoin = "round";
        ctx.lineWidth = this.paths.strokeWidth;
        ctx.strokeStyle = this.paths.stroke;
        ctx.stroke(this.path2d);
      }
      ctx.fillStyle = this.paths.fill;
      ctx.fill(this.path2d);
    }
    ctx.restore();
  }
}
