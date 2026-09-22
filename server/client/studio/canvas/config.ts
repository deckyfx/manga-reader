/**
 * The page canvas's settings and vocabulary: tools and modes, zoom and brush limits, the hints each tool shows, and the
 * actions the toolbar and keyboard ask of the canvas. Split out of PageCanvas.tsx so the component holds behaviour.
 */
import type { RegionKind } from "./geometry";

export type Tool = "select" | "rect" | "ellipse" | "polygon" | "brush";

/** Regions: detection areas and the mask. Lettering: the translated text floating on the page. */
export type EditMode = "regions" | "lettering";

/** What the mouse wheel does without modifiers; Ctrl/Cmd + wheel always zooms, Shift switches direction. */
export type WheelMode = "zoom" | "vertical" | "horizontal";

export const WHEEL_MODE_KEY = "studio-canvas-wheel-mode";

/** Saved wheel mode; storage can be unavailable (private mode), so fall back to scrolling up/down. */
export function readWheelMode(): WheelMode {
  try {
    const saved = localStorage.getItem(WHEEL_MODE_KEY);
    return saved === "zoom" || saved === "horizontal" ? saved : "vertical";
  } catch {
    return "vertical";
  }
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
/** Zoom speed per wheel pixel: one ordinary wheel notch (~100px) zooms exactly 10%, about 7 notches to double. */
export const WHEEL_ZOOM_RATE = Math.log(1.1) / 100;
/** Largest wheel delta (pixels) honoured per event, so fast flicks and hi-res wheels don't jump several levels. */
export const WHEEL_MAX_DELTA = 300;
/** Drawn regions smaller than this (page pixels) are treated as accidental clicks. */
export const MIN_REGION = 5;
/** Mask brush diameter range and default, in page pixels. */
export const MIN_BRUSH = 2;
export const MAX_BRUSH = 200;
export const DEFAULT_BRUSH = 24;

export const TOOL_HINTS: Record<Tool, string> = {
  select: "Click a region to select, drag to move, handles to resize, Delete to remove; drag empty space to pan",
  rect: "Drag on empty space to draw a rectangle",
  ellipse: "Drag on empty space to draw an ellipse",
  polygon: "Click to add points; Enter, double-click or the first point to finish; Esc to cancel",
  brush: "Add paints text the detector missed, Erase paints art it caught; X swaps, [ ] resize; then Re-clean",
};

export const LETTERING_HINT = "Drag lettering to move it, handles to resize, the top knob to rotate; double-click to edit the text";

/** Lettering panel size: 300 wide; its content scrolls past 340, plus the grab bar and borders. */
export const PANEL_WIDTH = 300;
export const PANEL_OUTER_HEIGHT = 372;

/** Lettering selection colour (violet, distinct from text/sfx regions). */
export const LETTERING_COLOR = "#a78bfa";

/** What each region colour means, shown on the kind buttons. */
export const KIND_HINTS: Record<RegionKind, string> = {
  text: "Text (blue): speech bubbles and captions. Read with OCR, translated, removed by Clean text, lettered with the translation",
  sfx: "Sound effect (orange): drawn sound effects. Not read or translated; removed by Clean SFX when ticked; lettered only if you type new lettering",
};

export const WHEEL_HINTS: Record<WheelMode, string> = {
  zoom: "Wheel zooms, Shift+wheel scrolls",
  vertical: "Wheel scrolls up/down, Shift sideways",
  horizontal: "Wheel scrolls sideways, Shift up/down",
};

/** Actions the keyboard handler and toolbar call into the canvas closure. */
export interface CanvasActions {
  finishPolygon: () => void;
  cancelDrawing: () => void;
  deleteSelected: () => void;
  fit: () => void;
  /** First view of the page at a remembered zoom. */
  openAt: (scale: number) => void;
  zoomBy: (factor: number) => void;
  /** Sets an exact zoom (1 = 100%), keeping the middle of the view where it is. */
  zoomTo: (value: number) => void;
}

export const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
