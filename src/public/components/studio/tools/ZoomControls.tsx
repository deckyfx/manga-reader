import { useStudioStore } from "../../../stores/studioFabricStore";

/**
 * ZoomControls - Self-contained zoom controls component
 *
 * Manages its own state via Zustand store (zoom level)
 * Provides Zoom In, Zoom Out, and Reset Zoom buttons
 */
export function ZoomControls() {
  const zoom = useStudioStore((state) => state.zoom);
  const zoomIn = useStudioStore((state) => state.zoomIn);
  const zoomOut = useStudioStore((state) => state.zoomOut);
  const resetZoom = useStudioStore((state) => state.resetZoom);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          onClick={zoomOut}
          className="flex-1 bg-gray-700 hover:bg-gray-600 text-white p-2 rounded font-medium transition-colors"
          title="Zoom Out"
        >
          <i className="fas fa-minus"></i>
        </button>
        <button
          onClick={resetZoom}
          className="flex-1 bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded text-sm font-medium transition-colors"
          title="Reset Zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={zoomIn}
          className="flex-1 bg-gray-700 hover:bg-gray-600 text-white p-2 rounded font-medium transition-colors"
          title="Zoom In"
        >
          <i className="fas fa-plus"></i>
        </button>
      </div>
    </div>
  );
}
