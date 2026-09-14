import { Ellipse, Point, Polygon, Rect, util, type FabricObject } from "fabric";
import type { BlockGeometry, BlockShape, StudioBlock } from "../../api";

export type RegionKind = "text" | "sfx";

export interface PageSize {
  width: number;
  height: number;
}

/** Colours per block kind: sky for text, orange for sound effects. */
export const REGION_COLORS: Record<RegionKind, { stroke: string; fill: string }> = {
  text: { stroke: "#38bdf8", fill: "rgba(56, 189, 248, 0.12)" },
  sfx: { stroke: "#fb923c", fill: "rgba(251, 146, 60, 0.12)" },
};

/** Canvas objects → block ids, kept outside Fabric so objects stay plain Fabric instances. */
const blockIds = new WeakMap<FabricObject, number>();

export const blockIdOf = (obj: FabricObject | null | undefined): number | undefined => (obj ? blockIds.get(obj) : undefined);

/** Positions from the top-left corner (Fabric 7 defaults to the centre); stroke stays 2px at any zoom. */
function baseOptions(kind: RegionKind) {
  const { stroke, fill } = REGION_COLORS[kind];
  return {
    originX: "left" as const,
    originY: "top" as const,
    stroke,
    fill,
    strokeWidth: 2,
    strokeUniform: true,
    lockRotation: true,
    objectCaching: false,
    transparentCorners: false,
    cornerColor: stroke,
    cornerSize: 9,
    borderColor: stroke,
  };
}

/** Dashed, non-interactive preview used while a region is being drawn. */
export function draftOptions(kind: RegionKind) {
  return { ...baseOptions(kind), strokeDashArray: [6, 4], selectable: false, evented: false };
}

export function blockKind(block: StudioBlock): RegionKind {
  return block.kind === "sfx" ? "sfx" : "text";
}

/** The block's stored geometry (rect shape omitted, as the server returns it). */
export function blockGeometry(block: StudioBlock): BlockGeometry {
  return { x: block.x, y: block.y, w: block.w, h: block.h, ...(block.shape ? { shape: block.shape as BlockShape } : {}) };
}

/** Stable comparison key: two geometries with the same key draw the same region. */
export function geometryKey(geometry: BlockGeometry, kind: RegionKind): string {
  const shape = geometry.shape?.type === "polygon" ? geometry.shape.points : geometry.shape?.type ?? "rect";
  return JSON.stringify([kind, geometry.x, geometry.y, geometry.w, geometry.h, shape]);
}

/** A selectable canvas object for a block, tagged with its id. */
export function regionObject(block: StudioBlock): FabricObject {
  const kind = blockKind(block);
  const options = baseOptions(kind);
  const shape = block.shape as BlockShape | null;
  let obj: FabricObject;
  if (shape?.type === "polygon") {
    obj = new Polygon(shape.points.map((p) => ({ x: p.x, y: p.y })), options);
  } else if (shape?.type === "ellipse") {
    obj = new Ellipse({ ...options, left: block.x, top: block.y, rx: block.w / 2, ry: block.h / 2 });
  } else {
    obj = new Rect({ ...options, left: block.x, top: block.y, width: block.w, height: block.h });
  }
  // Regions stay axis-aligned: the pipeline crops and cleans by the box
  obj.setControlsVisibility({ mtr: false });
  blockIds.set(obj, block.id);
  return obj;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Box of a point set, clamped to the page, at least 1px wide and tall. */
function boxOf(points: { x: number; y: number }[], page: PageSize): Omit<BlockGeometry, "shape"> {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = clamp(Math.min(...xs), 0, Math.max(0, page.width - 1));
  const y = clamp(Math.min(...ys), 0, Math.max(0, page.height - 1));
  return {
    x,
    y,
    w: clamp(Math.max(...xs) - x, 1, page.width - x),
    h: clamp(Math.max(...ys) - y, 1, page.height - y),
  };
}

/** A scene point rounded to whole page pixels and clamped to the page. */
export function pagePoint(point: { x: number; y: number }, page: PageSize): { x: number; y: number } {
  return { x: clamp(Math.round(point.x), 0, page.width), y: clamp(Math.round(point.y), 0, page.height) };
}

/** Polygon outline and its box from page-pixel points. */
export function polygonGeometry(points: { x: number; y: number }[], page: PageSize): BlockGeometry {
  const rounded = points.map((p) => pagePoint(p, page));
  return { ...boxOf(rounded, page), shape: { type: "polygon", points: rounded } };
}

/**
 * Page-pixel geometry of a region object after it was drawn, moved or resized. Rect and ellipse sizes come from
 * their dimensions × scale (the uniform stroke isn't part of the region); polygon points go through the object's
 * transform, so moved or scaled polygons convert exactly.
 */
export function geometryOf(obj: FabricObject, page: PageSize): BlockGeometry {
  if (obj instanceof Polygon) {
    const matrix = obj.calcTransformMatrix();
    const points = obj.points.map((p) =>
      util.transformPoint(new Point(p.x - obj.pathOffset.x, p.y - obj.pathOffset.y), matrix));
    return polygonGeometry(points, page);
  }
  const width = (obj instanceof Ellipse ? obj.rx * 2 : obj.width) * obj.scaleX;
  const height = (obj instanceof Ellipse ? obj.ry * 2 : obj.height) * obj.scaleY;
  const corners = [
    { x: Math.round(obj.left), y: Math.round(obj.top) },
    { x: Math.round(obj.left + width), y: Math.round(obj.top + height) },
  ];
  return { ...boxOf(corners, page), ...(obj instanceof Ellipse ? { shape: { type: "ellipse" } as const } : {}) };
}
