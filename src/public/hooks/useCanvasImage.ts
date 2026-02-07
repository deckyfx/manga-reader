import { useState, useEffect, useCallback, type RefObject } from "react";

interface UseCanvasImageResult {
  /** Whether the image has loaded and been drawn to the canvas */
  loaded: boolean;
  /** The loaded HTMLImageElement (null before load) */
  imageElement: HTMLImageElement | null;
  /** Natural width of the loaded image */
  naturalWidth: number;
  /** Natural height of the loaded image */
  naturalHeight: number;
  /** Force a redraw of the base image onto the canvas */
  redrawBase: () => void;
}

/**
 * Hook to load an image and initialize a canvas with it.
 *
 * Sets `canvas.width = img.naturalWidth` and `canvas.height = img.naturalHeight`,
 * then draws the image onto the canvas. Re-runs when `src` changes.
 *
 * @param canvasRef - Ref to the canvas element
 * @param src - Image URL to load
 */
export function useCanvasImage(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  src: string,
): UseCanvasImageResult {
  const [loaded, setLoaded] = useState(false);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [naturalHeight, setNaturalHeight] = useState(0);

  const drawToCanvas = useCallback(
    (img: HTMLImageElement) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
    },
    [canvasRef],
  );

  useEffect(() => {
    setLoaded(false);

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      setImageElement(img);
      setNaturalWidth(img.naturalWidth);
      setNaturalHeight(img.naturalHeight);
      drawToCanvas(img);
      setLoaded(true);
    };

    img.onerror = () => {
      console.error("[useCanvasImage] Failed to load image:", src);
      setLoaded(false);
    };

    img.src = src;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src, drawToCanvas]);

  const redrawBase = useCallback(() => {
    if (imageElement) {
      drawToCanvas(imageElement);
    }
  }, [imageElement, drawToCanvas]);

  return { loaded, imageElement, naturalWidth, naturalHeight, redrawBase };
}
