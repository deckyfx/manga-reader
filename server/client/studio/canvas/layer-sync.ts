/**
 * Keeping the page canvas's Fabric objects in step with the page: one region object per block, one floating lettering
 * object per lettered block, and which of them is active. Plain functions over the canvas, called from PageCanvas's
 * effects; split out of PageCanvas.tsx.
 */
import type { Canvas, FabricObject } from "fabric";
import type { BlockGeometry, StudioBlock } from "../../api";
import type { LetteringItem } from "../text/typesetter";
import { LETTERING_COLOR, type EditMode } from "./config";
import { blockGeometry, blockKind, regionKey, regionObject } from "./geometry";
import { LetteringObject, letteringIdOf } from "./lettering-object";
import { mergeAreas, type Area } from "./mask-layers";

/** A block's region on the canvas, and the geometry key it was drawn from (to redraw only what changed). */
export interface Entry {
  obj: FabricObject;
  key: string;
  geometry: BlockGeometry;
}

interface ViewState {
  mode: EditMode;
  disabled: boolean;
  selectedId: number | null;
}

/** Lettering layer: one floating object per lettered block, interactive in Lettering mode. */
export function syncLettering(
  canvas: Canvas,
  objects: Map<number, LetteringObject>,
  lettering: LetteringItem[],
  { mode, disabled, showTextLayer, selectedId }: ViewState & { showTextLayer: boolean },
): void {
  const interactive = mode === "lettering" && !disabled;
  const seen = new Set<number>();
  for (const item of lettering) {
    seen.add(item.id);
    let obj = objects.get(item.id);
    if (!obj) {
      obj = new LetteringObject(item.id, {
        originX: "center",
        originY: "center",
        objectCaching: false,
        lockScalingFlip: true,
        transparentCorners: false,
        cornerColor: LETTERING_COLOR,
        cornerSize: 9,
        borderColor: LETTERING_COLOR,
        borderDashArray: [6, 4],
      });
      objects.set(item.id, obj);
      canvas.add(obj);
    }
    obj.set({
      left: item.box.x + item.box.w / 2,
      top: item.box.y + item.box.h / 2,
      width: item.box.w,
      height: item.box.h,
      scaleX: 1,
      scaleY: 1,
      angle: item.rotation,
      selectable: interactive,
      evented: interactive,
      hoverCursor: interactive ? "move" : "default",
      visible: showTextLayer,
      // Not placed yet: previewed in the region box until the server finds the bubble area
      opacity: item.placed ? 1 : 0.6,
    });
    obj.showFrame = mode === "lettering";
    obj.overflow = !item.fits;
    obj.setPaths(item.paths);
    obj.setCoords();
    // Lettering sits above the regions while it's being edited, below them otherwise
    if (mode === "lettering") canvas.bringObjectToFront(obj);
    else canvas.sendObjectToBack(obj);
  }
  for (const [id, obj] of objects) {
    if (seen.has(id)) continue;
    if (canvas.getActiveObject() === obj) canvas.discardActiveObject();
    canvas.remove(obj);
    objects.delete(id);
  }

  const active = canvas.getActiveObject();
  if (mode === "lettering") {
    const target = selectedId !== null ? objects.get(selectedId) : undefined;
    if (target && active !== target && !disabled) canvas.setActiveObject(target);
    else if (!target && active) canvas.discardActiveObject();
  } else if (letteringIdOf(active) !== undefined) {
    canvas.discardActiveObject();
  }
  canvas.requestRenderAll();
}

/** Regions: redraw only blocks whose geometry changed; keep the selection in sync with the panel. */
export function syncRegions(
  canvas: Canvas,
  entries: Map<number, Entry>,
  blocks: StudioBlock[],
  { mode, disabled, selectedId }: ViewState,
  letteringObjects: Map<number, LetteringObject>,
): void {
  const seen = new Set<number>();
  for (const block of blocks) {
    seen.add(block.id);
    const geometry = blockGeometry(block);
    const key = regionKey(geometry, blockKind(block), block.include);
    const existing = entries.get(block.id);
    if (existing && existing.key === key) continue;
    if (existing) canvas.remove(existing.obj);
    const obj = regionObject(block);
    canvas.add(obj);
    entries.set(block.id, { obj, key, geometry });
  }
  for (const [id, entry] of entries) {
    if (seen.has(id)) continue;
    canvas.remove(entry.obj);
    entries.delete(id);
  }
  const regionsInteractive = !disabled && mode === "regions";
  for (const { obj } of entries.values()) {
    obj.set({ selectable: regionsInteractive, evented: regionsInteractive, opacity: mode === "lettering" ? 0.35 : 1 });
  }

  if (mode === "regions") {
    const target = selectedId !== null ? entries.get(selectedId)?.obj : undefined;
    const active = canvas.getActiveObject();
    if (target && active !== target) canvas.setActiveObject(target);
    else if (!target && active) canvas.discardActiveObject();
  }
  // A region added or redrawn above the lettering must not cover it while the lettering is being edited
  if (mode === "lettering") for (const obj of letteringObjects.values()) canvas.bringObjectToFront(obj);
  canvas.requestRenderAll();
}

/** What Re-clean would clean: the painted spots when there are any, otherwise the selected region's box. */
export function recleanPlan(paintedAreas: Area[], blocks: StudioBlock[], selectedId: number | null): { targets: Area[]; title: string } {
  const selectedBlock = selectedId !== null ? blocks.find((b) => b.id === selectedId) : undefined;
  const targets: Area[] = paintedAreas.length > 0
    ? mergeAreas(paintedAreas)
    : selectedBlock ? [{ x: selectedBlock.x, y: selectedBlock.y, w: selectedBlock.w, h: selectedBlock.h }] : [];
  const title = paintedAreas.length > 0
    ? "Clean the painted spots again on the cleaned page"
    : selectedBlock ? "Clean the selected region again on the cleaned page"
    : "Paint missed text with the brush, or select a region, to clean just that area again";
  return { targets, title };
}
