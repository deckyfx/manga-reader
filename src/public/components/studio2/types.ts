/**
 * Studio Types - Shared types for Fabric.js Studio implementation
 */

/**
 * Available drawing tools in Studio mode
 */
export type StudioTool = "none" | "brush" | "rectangle" | "oval" | "polygon";

/**
 * Studio tool constants (prevents typos, enables refactoring)
 */
export const StudioToolType = {
  NONE: "none" as const,
  BRUSH: "brush" as const,
  RECTANGLE: "rectangle" as const,
  OVAL: "oval" as const,
  POLYGON: "polygon" as const,
};

/**
 * Zoom levels
 */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 5.0;
export const ZOOM_STEP = 0.1;
export const ZOOM_DEFAULT = 1.0;
