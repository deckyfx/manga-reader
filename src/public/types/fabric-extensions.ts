/**
 * Fabric.js type extensions for custom properties
 *
 * This file extends Fabric.js types to include custom properties we add at runtime
 * without using `any` casts. This provides type safety while allowing custom data.
 */

import type { Textbox, Rect, Ellipse, Polygon } from "fabric";

/**
 * Font style type matching Fabric.js internal type
 */
export type FontStyle = "normal" | "italic" | "oblique" | "";

/**
 * Font weight type matching Fabric.js internal type
 */
export type FontWeight =
  | "normal"
  | "bold"
  | "100"
  | "200"
  | "300"
  | "400"
  | "500"
  | "600"
  | "700"
  | "800"
  | "900"
  | "";

/**
 * Custom data attached to mask objects (rectangle, oval, polygon)
 */
export interface MaskData {
  type: "mask";
  originalText?: string;    // OCR extracted text
  translatedText?: string;  // Translated text
  captionSlug?: string;     // Associated caption in database
  customFontSize?: number;  // Custom font size for text overlay
  clean?: boolean;          // Enable cleaning when running OCR
  cleaned?: boolean;        // Flag: region has been cleaned (prevents re-OCR)
}

/**
 * Custom data attached to text patch objects
 */
export interface TextPatchData {
  type: "text-patch";
  captionSlug?: string;
  maskId?: string; // ID of the parent mask region
  originalText?: string; // Original OCR text (retained even after region removed)
  leftRatio: number;
  topRatio: number;
  widthRatio: number;
  fontSizeRatio: number;
}

/**
 * Extended Textbox type with custom properties
 */
export interface ExtendedTextbox extends Textbox {
  id?: string;
  data?: TextPatchData;
  _isDrawing?: boolean;
}

/**
 * Extended Rect type with custom properties
 */
export interface ExtendedRect extends Rect {
  id?: string;
  data?: MaskData;
  _isDrawing?: boolean;
}

/**
 * Extended Ellipse type with custom properties
 */
export interface ExtendedEllipse extends Ellipse {
  id?: string;
  data?: MaskData;
  _isDrawing?: boolean;
}

/**
 * Extended Polygon type with custom properties
 */
export interface ExtendedPolygon extends Polygon {
  id?: string;
  data?: MaskData;
  _isDrawing?: boolean;
}

/**
 * Type guard to check if object is ExtendedTextbox
 */
export function isExtendedTextbox(
  obj: unknown
): obj is ExtendedTextbox {
  return (
    obj !== null &&
    typeof obj === "object" &&
    "type" in obj &&
    obj.type === "textbox"
  );
}

/**
 * Type guard to check if object is ExtendedRect
 */
export function isExtendedRect(obj: unknown): obj is ExtendedRect {
  return (
    obj !== null &&
    typeof obj === "object" &&
    "type" in obj &&
    obj.type === "rect"
  );
}

/**
 * Type guard to check if object is ExtendedEllipse
 */
export function isExtendedEllipse(
  obj: unknown
): obj is ExtendedEllipse {
  return (
    obj !== null &&
    typeof obj === "object" &&
    "type" in obj &&
    obj.type === "ellipse"
  );
}

/**
 * Type guard to check if object is ExtendedPolygon
 */
export function isExtendedPolygon(
  obj: unknown
): obj is ExtendedPolygon {
  return (
    obj !== null &&
    typeof obj === "object" &&
    "type" in obj &&
    obj.type === "polygon"
  );
}
