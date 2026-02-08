import { useCallback } from "react";
import { Textbox, type Canvas } from "fabric";
import type { BoundingBox } from "../../lib/region-types";
import type {
  FontStyle,
  FontWeight,
  ExtendedTextbox,
  TextPatchData,
} from "../types/fabric-extensions";

/**
 * Text patch configuration (ratio-based positioning for responsive scaling)
 */
export interface TextPatchConfig {
  text: string;
  bounds: BoundingBox;
  captionSlug?: string;
  fontFamily?: string;
  fontWeight?: FontWeight;
  fontStyle?: FontStyle;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

/**
 * Client patch data structure (stored in database)
 *
 * Note: fontWeight and fontStyle are stored as strings in the database,
 * but are typed as FontWeight/FontStyle when creating Textboxes
 */
export interface ClientPatchData {
  text: string;
  leftRatio: number;
  topRatio: number;
  widthRatio: number;
  fontSizeRatio: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
}

/**
 * Hook for creating and managing Fabric.js Textbox patches
 *
 * Features:
 * - Ratio-based positioning for responsive scaling (PanelPachi approach)
 * - Export Textbox as PNG patch image
 * - Extract patch data for database storage
 */
export function useFabricTextPatch(canvas: Canvas | null) {
  /**
   * Create Fabric.js Textbox from OCR result with ratio-based positioning
   *
   * @param config - Text patch configuration
   * @returns Fabric.js Textbox object
   */
  const createTextPatch = useCallback(
    (config: TextPatchConfig): ExtendedTextbox | null => {
      if (!canvas) return null;

      const {
        text,
        bounds,
        captionSlug,
        fontFamily = "Arial",
        fontWeight = "normal",
        fontStyle = "normal",
        fill = "#000000",
        stroke,
        strokeWidth = 0,
      } = config;

      // Get canvas dimensions (current display size)
      const canvasWidth = canvas.getWidth();
      const canvasHeight = canvas.getHeight();

      // Calculate font size based on bounds height and canvas width
      // Use canvas width for ratio to maintain consistency across resizes
      const fontSize = (bounds.height * 0.8); // 80% of bounds height
      const fontSizeRatio = fontSize / canvasWidth;

      // Create Textbox
      const textbox = new Textbox(text, {
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        fontSize,
        fontFamily,
        fontWeight,
        fontStyle,
        fill,
        stroke,
        strokeWidth,
        textAlign: "center",
        // Enable selection and editing
        selectable: true,
        evented: true,
      }) as ExtendedTextbox;

      // Store ratio-based positioning data and caption slug
      const patchData: TextPatchData = {
        type: "text-patch",
        captionSlug,
        leftRatio: bounds.x / canvasWidth,
        topRatio: bounds.y / canvasHeight,
        widthRatio: bounds.width / canvasWidth,
        fontSizeRatio,
      };

      textbox.data = patchData;

      // Add to canvas
      canvas.add(textbox);
      canvas.setActiveObject(textbox);
      canvas.renderAll();

      return textbox;
    },
    [canvas]
  );

  /**
   * Update Textbox positioning when canvas resizes (responsive scaling)
   *
   * Call this when canvas dimensions change to recalculate absolute positions
   * from stored ratios.
   */
  const updateTextboxPositions = useCallback(() => {
    if (!canvas) return;

    const canvasWidth = canvas.getWidth();
    const canvasHeight = canvas.getHeight();

    const objects = canvas.getObjects();
    for (const obj of objects) {
      if (obj.type === "textbox") {
        const textbox = obj as ExtendedTextbox;
        const data = textbox.data;

        if (data?.type === "text-patch") {
          // Recalculate absolute positions from ratios
          textbox.set({
            left: data.leftRatio * canvasWidth,
            top: data.topRatio * canvasHeight,
            width: data.widthRatio * canvasWidth,
            fontSize: data.fontSizeRatio * canvasWidth,
          });

          textbox.setCoords();
        }
      }
    }

    canvas.renderAll();
  }, [canvas]);

  /**
   * Export Textbox as PNG patch image
   *
   * @param textbox - Fabric.js Textbox to export
   * @returns Base64 PNG string
   */
  const exportPatch = useCallback(
    (textbox: Textbox): string | null => {
      if (!canvas) return null;

      // Get textbox bounds
      const bounds = textbox.getBoundingRect();

      // Create off-screen canvas at textbox size
      const offCanvas = document.createElement("canvas");
      offCanvas.width = bounds.width;
      offCanvas.height = bounds.height;
      const ctx = offCanvas.getContext("2d");
      if (!ctx) return null;

      // Fill with white background
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, offCanvas.width, offCanvas.height);

      // Save current canvas state
      const originalLeft = textbox.left || 0;
      const originalTop = textbox.top || 0;

      // Temporarily move textbox to origin for export
      textbox.set({
        left: 0,
        top: 0,
      });

      // Render textbox to off-screen canvas
      textbox.render(ctx);

      // Restore original position
      textbox.set({
        left: originalLeft,
        top: originalTop,
      });

      // Return base64 PNG
      return offCanvas.toDataURL("image/png");
    },
    [canvas]
  );

  /**
   * Extract patch data from Textbox for database storage
   *
   * @param textbox - Fabric.js Textbox
   * @returns Client patch data object
   */
  const extractPatchData = useCallback(
    (textbox: ExtendedTextbox): ClientPatchData | null => {
      if (!canvas) return null;

      const canvasWidth = canvas.getWidth();
      const canvasHeight = canvas.getHeight();

      const data = textbox.data;

      return {
        text: textbox.text || "",
        leftRatio: data?.leftRatio ?? (textbox.left || 0) / canvasWidth,
        topRatio: data?.topRatio ?? (textbox.top || 0) / canvasHeight,
        widthRatio: data?.widthRatio ?? (textbox.width || 100) / canvasWidth,
        fontSizeRatio: data?.fontSizeRatio ?? (textbox.fontSize || 16) / canvasWidth,
        fontFamily: String(textbox.fontFamily || "Arial"),
        fontWeight: String(textbox.fontWeight || "normal"),
        fontStyle: String(textbox.fontStyle || "normal"),
        fill: String(textbox.fill || "#000000"),
        stroke: textbox.stroke ? String(textbox.stroke) : undefined,
        strokeWidth: textbox.strokeWidth,
      };
    },
    [canvas]
  );

  return {
    createTextPatch,
    updateTextboxPositions,
    exportPatch,
    extractPatchData,
  };
}
