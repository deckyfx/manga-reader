import { useRef, useEffect, useState, useCallback } from "react";
import { Canvas, PencilBrush, Path, type FabricObject } from "fabric";

interface Point {
  x: number;
  y: number;
}

interface UseFabricBrushOptions {
  width: number;
  height: number;
  brushSize?: number;
  brushColor?: string;
  enabled: boolean;
}

interface UseFabricBrushResult {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  clear: () => void;
  undo: () => void;
  setBrushSize: (size: number) => void;
  exportMask: () => Promise<Blob | null>;
  hasStrokes: boolean;
}

/**
 * useFabricBrush — Manage Fabric.js canvas for free-form brush masking
 *
 * Provides a pink semi-transparent brush for drawing masks over text areas.
 * Exports black-white mask (black background, white strokes) for inpainting.
 *
 * @param options - Canvas dimensions and brush settings
 * @returns Canvas ref, controls, and export function
 *
 * @example
 * ```tsx
 * const brush = useFabricBrush({
 *   width: 1200,
 *   height: 1800,
 *   brushSize: 20,
 *   enabled: tool === 'brush'
 * });
 *
 * return (
 *   <canvas ref={brush.canvasRef} />
 *   <button onClick={brush.clear}>Clear</button>
 *   <button onClick={brush.undo}>Undo</button>
 * );
 * ```
 */
export function useFabricBrush({
  width,
  height,
  brushSize = 20,
  brushColor = "rgba(236, 72, 153, 0.5)", // Pink semi-transparent
  enabled,
}: UseFabricBrushOptions): UseFabricBrushResult {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<Canvas | null>(null);
  const pathHistoryRef = useRef<FabricObject[]>([]);
  const [hasStrokes, setHasStrokes] = useState(false);

  // Initialize Fabric.js canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const fabricCanvas = new Canvas(canvasRef.current, {
      width,
      height,
      isDrawingMode: enabled,
      selection: false, // Disable object selection
      renderOnAddRemove: true,
    });

    // Configure brush
    const brush = new PencilBrush(fabricCanvas);
    brush.color = brushColor;
    brush.width = brushSize;
    fabricCanvas.freeDrawingBrush = brush;

    // Track path history for undo
    fabricCanvas.on("path:created", (e) => {
      pathHistoryRef.current.push(e.path);
      setHasStrokes(true);
    });

    fabricCanvasRef.current = fabricCanvas;

    return () => {
      fabricCanvas.dispose();
      fabricCanvasRef.current = null;
    };
  }, [width, height]);

  // Update drawing mode when enabled changes
  useEffect(() => {
    if (!fabricCanvasRef.current) return;
    fabricCanvasRef.current.isDrawingMode = enabled;
  }, [enabled]);

  // Update brush size when it changes
  useEffect(() => {
    if (!fabricCanvasRef.current?.freeDrawingBrush) return;
    fabricCanvasRef.current.freeDrawingBrush.width = brushSize;
  }, [brushSize]);

  /**
   * Clear all strokes
   */
  const clear = useCallback(() => {
    if (!fabricCanvasRef.current) return;
    fabricCanvasRef.current.clear();
    pathHistoryRef.current = [];
    setHasStrokes(false);
  }, []);

  /**
   * Undo last stroke
   */
  const undo = useCallback(() => {
    if (!fabricCanvasRef.current || pathHistoryRef.current.length === 0) return;

    const lastPath = pathHistoryRef.current.pop();
    if (!lastPath) return;

    fabricCanvasRef.current.remove(lastPath);
    fabricCanvasRef.current.renderAll();

    setHasStrokes(pathHistoryRef.current.length > 0);
  }, []);

  /**
   * Set brush size
   */
  const setBrushSize = useCallback((size: number) => {
    if (!fabricCanvasRef.current?.freeDrawingBrush) return;
    fabricCanvasRef.current.freeDrawingBrush.width = size;
  }, []);

  /**
   * Export mask as black canvas with white strokes (standard inpainting format)
   *
   * @returns Blob of PNG image (black background, white strokes)
   */
  const exportMask = useCallback(async (): Promise<Blob | null> => {
    if (!fabricCanvasRef.current) return null;

    // Create export canvas at same dimensions
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = width;
    exportCanvas.height = height;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return null;

    // Fill with black background
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);

    // Set stroke color to white
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Draw all paths in white
    const objects = fabricCanvasRef.current.getObjects();
    for (const obj of objects) {
      if (!(obj instanceof Path)) {
        continue;
      }

      const path = obj.path;
      if (!path) continue;

      ctx.beginPath();
      ctx.lineWidth = obj.strokeWidth || brushSize;

      // Draw path
      for (let i = 0; i < path.length; i++) {
        const segment = path[i];
        if (!segment) continue;

        const cmd = segment[0];

        if (cmd === "M") {
          // Move to
          ctx.moveTo(segment[1]!, segment[2]!);
        } else if (cmd === "L") {
          // Line to
          ctx.lineTo(segment[1]!, segment[2]!);
        } else if (cmd === "Q") {
          // Quadratic curve
          ctx.quadraticCurveTo(segment[1]!, segment[2]!, segment[3]!, segment[4]!);
        } else if (cmd === "C") {
          // Cubic bezier
          ctx.bezierCurveTo(
            segment[1]!,
            segment[2]!,
            segment[3]!,
            segment[4]!,
            segment[5]!,
            segment[6]!,
          );
        }
      }

      ctx.stroke();
    }

    // Convert to blob
    return new Promise<Blob | null>((resolve) => {
      exportCanvas.toBlob((blob) => resolve(blob), "image/png");
    }); // Cast to match sync return type
  }, [width, height, brushSize]);

  return {
    canvasRef,
    clear,
    undo,
    setBrushSize,
    exportMask,
    hasStrokes,
  };
}
