/**
 * Studio Tools - Exports all tool buttons and handlers
 */

// Base classes
export { MaskingToolHandlerBase as ToolHandler } from "./MaskingToolHandlerBase";

// Masking tools (with canvas interaction)
export { BrushToolButton, BrushToolHandler, useBrushTool } from "./BrushTool";
export {
  RectangleToolButton,
  RectangleToolHandler,
  useRectangleTool,
} from "./RectangleTool";
export { OvalToolButton, OvalToolHandler, useOvalTool } from "./OvalTool";
export {
  PolygonToolButton,
  PolygonToolHandler,
  usePolygonTool,
  PolygonFinishButton,
} from "./PolygonTool";

// UI-only tools (no canvas interaction)
export { ZoomControls } from "./ZoomControls";
export { HistoryControls } from "./HistoryControls";
export { DeleteMaskButton } from "./DeleteMaskButton";
export { InpaintButton } from "./InpaintButton";
export { AutoDetectButton } from "./AutoDetectButton";
export { MergeAndSaveButton } from "./MergeAndSaveButton";
