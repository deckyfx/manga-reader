/**
 * The editor's toolset, remembered per workspace (or per chapter, for a page walked through in one): moving to the
 * next page keeps the zoom, tool, brush and stage image the last one was left with, instead of starting over.
 *
 * Kept in localStorage, which can be missing or full; every read falls back to nothing saved, every write is best
 * effort.
 */

const KEY_PREFIX = "studio-toolset:";

export const TOOLS = ["select", "rect", "ellipse", "polygon", "brush"] as const;
export const EDIT_MODES = ["regions", "lettering"] as const;
export const REGION_KINDS = ["text", "sfx"] as const;
export const MASK_LAYERS = ["add", "erase"] as const;
export const VIEWS = ["canvas", "compare"] as const;

export interface Toolset {
  tool?: (typeof TOOLS)[number];
  mode?: (typeof EDIT_MODES)[number];
  kind?: (typeof REGION_KINDS)[number];
  brushLayer?: (typeof MASK_LAYERS)[number];
  brushSize?: number;
  showMask?: boolean;
  showText?: boolean;
  /** Canvas zoom; null means fit the page into view. */
  zoom?: number | null;
  view?: (typeof VIEWS)[number];
  /** The stage image the canvas shows (checked against the page's images before it is used). */
  canvasImage?: string;
}

/** Which pages share a toolset: those of one workspace, else those of one chapter; a lone page has none. */
export function toolsetScope(workspaceId: number | null, chapterId: number | null): string | null {
  if (workspaceId !== null) return `w${workspaceId}`;
  if (chapterId !== null) return `c${chapterId}`;
  return null;
}

const oneOf = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  values.find((candidate) => candidate === value);

/** The saved toolset for a scope, keeping only values that still make sense (a stored value may be from an older build). */
export function readToolset(scope: string | null): Toolset {
  if (scope === null) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(KEY_PREFIX + scope) ?? "{}");
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null) return {};
  const saved = raw as Record<string, unknown>;
  const toolset: Toolset = {};
  const tool = oneOf(TOOLS, saved.tool);
  if (tool) toolset.tool = tool;
  const mode = oneOf(EDIT_MODES, saved.mode);
  if (mode) toolset.mode = mode;
  const kind = oneOf(REGION_KINDS, saved.kind);
  if (kind) toolset.kind = kind;
  const brushLayer = oneOf(MASK_LAYERS, saved.brushLayer);
  if (brushLayer) toolset.brushLayer = brushLayer;
  const view = oneOf(VIEWS, saved.view);
  if (view) toolset.view = view;
  if (typeof saved.brushSize === "number" && Number.isFinite(saved.brushSize) && saved.brushSize > 0) toolset.brushSize = saved.brushSize;
  if (typeof saved.showMask === "boolean") toolset.showMask = saved.showMask;
  if (typeof saved.showText === "boolean") toolset.showText = saved.showText;
  if (saved.zoom === null || (typeof saved.zoom === "number" && Number.isFinite(saved.zoom) && saved.zoom > 0)) toolset.zoom = saved.zoom;
  if (typeof saved.canvasImage === "string") toolset.canvasImage = saved.canvasImage;
  return toolset;
}

/** Merges a change into the scope's saved toolset. */
export function saveToolset(scope: string | null, patch: Toolset): void {
  if (scope === null) return;
  try {
    localStorage.setItem(KEY_PREFIX + scope, JSON.stringify({ ...readToolset(scope), ...patch }));
  } catch {
    // Not remembered; the editor still works, it just starts fresh on the next page
  }
}
