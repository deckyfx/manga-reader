/**
 * What one mouse-wheel event asks of a page view: zoom by a factor, or move by an offset. Shared by the editing canvas
 * and the stage comparison, so the wheel does the same thing in both — and kept free of either, so it can be tested.
 */
import { WHEEL_MAX_DELTA, WHEEL_ZOOM_RATE, type WheelMode } from "./config";

/** The parts of a WheelEvent that decide what it does. */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines (Firefox), 2 pages. */
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** Zoom by `factor` around the pointer, or move the view by (dx, dy) screen pixels (positive: towards the end of the page). */
export type WheelIntent = { zoom: number } | { pan: { dx: number; dy: number } };

/**
 * Reads one wheel event under `mode`. Ctrl/Cmd + wheel always zooms (a trackpad pinch arrives as ctrl + wheel too);
 * otherwise the mode decides, and Shift switches direction. `viewHeight` is what a deltaMode 2 "page" is worth.
 */
export function wheelIntent(e: WheelInput, mode: WheelMode, viewHeight: number): WheelIntent {
  // Wheels report pixels, lines (Firefox) or pages: normalise to pixels, and cap one event so a flick can't jump levels
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewHeight : 1;
  const deltaX = Math.max(-WHEEL_MAX_DELTA, Math.min(WHEEL_MAX_DELTA, e.deltaX * unit));
  const deltaY = Math.max(-WHEEL_MAX_DELTA, Math.min(WHEEL_MAX_DELTA, e.deltaY * unit));
  // Exponential steps: a 100px wheel notch zooms 10%, trackpad pinches (small deltas) stay fine-grained
  const zoom = { zoom: Math.exp(-deltaY * WHEEL_ZOOM_RATE) };
  if (e.ctrlKey || e.metaKey) return zoom;
  // Some browsers turn Shift + wheel into horizontal deltas, so take whichever axis moved
  const amount = deltaY !== 0 ? deltaY : deltaX;
  if (mode === "zoom") return e.shiftKey ? { pan: { dx: 0, dy: amount } } : zoom;
  // Trackpads send both axes at once: a two-finger swipe moves freely in either scroll mode
  if (!e.shiftKey && deltaX !== 0 && deltaY !== 0) return { pan: { dx: deltaX, dy: deltaY } };
  // Shift switches direction: vertical mode scrolls sideways, horizontal mode scrolls up/down
  const sideways = (mode === "horizontal") !== e.shiftKey;
  return { pan: sideways ? { dx: amount, dy: 0 } : { dx: 0, dy: amount } };
}
