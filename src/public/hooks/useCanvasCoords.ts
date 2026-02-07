import { useCallback, type RefObject } from "react";

interface Point {
  x: number;
  y: number;
}

interface UseCanvasCoordsResult {
  /** Convert a mouse event on the canvas to image-pixel coordinates */
  toImageCoords: (e: React.MouseEvent<HTMLCanvasElement>) => Point;
  /** Convert image-pixel coords to CSS display position (relative to canvas container) */
  toDisplayCoords: (imageX: number, imageY: number) => { left: number; top: number };
  /** Convert image-pixel dimensions to CSS display dimensions */
  toDisplaySize: (w: number, h: number) => { width: number; height: number };
}

/**
 * The ONE coordinate conversion hook for the V2 canvas-based editor.
 *
 * Canvas internal resolution is set to image natural resolution.
 * CSS sizes the canvas responsively. The ratio `canvas.width / canvas.getBoundingClientRect().width`
 * bridges the two spaces. This is the ONLY conversion in the entire V2 system.
 *
 * @param canvasRef - Ref to the canvas element
 */
export function useCanvasCoords(
  canvasRef: RefObject<HTMLCanvasElement | null>,
): UseCanvasCoordsResult {
  /**
   * Get the current ratio between canvas internal pixels and CSS display pixels.
   * Returns { rx, ry } where imagePixels = displayPixels * rx
   */
  const getRatio = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return { rx: 1, ry: 1 };

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { rx: 1, ry: 1 };

    return {
      rx: canvas.width / rect.width,
      ry: canvas.height / rect.height,
    };
  }, [canvasRef]);

  const toImageCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const { rx, ry } = getRatio();

      const displayX = e.clientX - rect.left;
      const displayY = e.clientY - rect.top;

      return {
        x: displayX * rx,
        y: displayY * ry,
      };
    },
    [canvasRef, getRatio],
  );

  const toDisplayCoords = useCallback(
    (imageX: number, imageY: number): { left: number; top: number } => {
      const { rx, ry } = getRatio();
      return {
        left: imageX / rx,
        top: imageY / ry,
      };
    },
    [getRatio],
  );

  const toDisplaySize = useCallback(
    (w: number, h: number): { width: number; height: number } => {
      const { rx, ry } = getRatio();
      return {
        width: w / rx,
        height: h / ry,
      };
    },
    [getRatio],
  );

  return { toImageCoords, toDisplayCoords, toDisplaySize };
}
