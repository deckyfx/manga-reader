import { useState, useCallback } from "react";

interface UseCanvasZoomResult {
  /** Current zoom level (1.0 = 100%) */
  zoom: number;
  /** Set zoom to a specific value */
  setZoom: (z: number) => void;
  /** Zoom in by one step */
  zoomIn: () => void;
  /** Zoom out by one step */
  zoomOut: () => void;
  /** Calculate zoom to fit image within container */
  fitToContainer: (
    containerW: number,
    containerH: number,
    imageW: number,
    imageH: number,
  ) => void;
}

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5.0;
const ZOOM_STEP = 0.1;

/** Clamp zoom between min and max */
function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/**
 * Hook for managing canvas zoom state.
 *
 * Default zoom is 1.0 (1 image pixel = 1 screen pixel).
 * Range: 0.1 — 5.0. Step: 0.1 per increment.
 * Zoom is controlled only via UI buttons (no scroll-to-zoom).
 */
export function useCanvasZoom(initialZoom = 1.0): UseCanvasZoomResult {
  const [zoom, setZoomRaw] = useState(clampZoom(initialZoom));

  const setZoom = useCallback((z: number) => {
    setZoomRaw(clampZoom(z));
  }, []);

  const zoomIn = useCallback(() => {
    setZoomRaw((prev) => clampZoom(prev + ZOOM_STEP));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomRaw((prev) => clampZoom(prev - ZOOM_STEP));
  }, []);

  const fitToContainer = useCallback(
    (containerW: number, containerH: number, imageW: number, imageH: number) => {
      if (imageW === 0 || imageH === 0) return;
      const fitZoom = Math.min(containerW / imageW, containerH / imageH);
      setZoomRaw(clampZoom(fitZoom));
    },
    [],
  );

  return { zoom, setZoom, zoomIn, zoomOut, fitToContainer };
}
