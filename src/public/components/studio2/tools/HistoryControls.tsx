import { useStudioStore } from "../../../stores/studioFabricStore";

/**
 * HistoryControls - Self-contained undo/redo controls component
 *
 * Manages its own state via Zustand store (history stacks)
 * Provides Undo and Redo buttons with keyboard shortcuts
 */
export function HistoryControls() {
  const undo = useStudioStore((state) => state.undo);
  const redo = useStudioStore((state) => state.redo);

  // Compute canUndo/canRedo from state (so they update reactively)
  const historyLength = useStudioStore((state) => state.canvasHistory.length);
  const redoLength = useStudioStore((state) => state.redoStack.length);
  const canUndo = historyLength > 0;
  const canRedo = redoLength > 0;

  return (
    <div>
      <h3 className="text-white text-sm font-semibold mb-2">History</h3>
      <div className="flex gap-2">
        <button
          onClick={undo}
          disabled={!canUndo}
          className={`flex-1 px-3 py-2 rounded flex items-center justify-center gap-2 transition-colors ${
            canUndo
              ? "bg-gray-700 text-white hover:bg-gray-600"
              : "bg-gray-900 text-gray-600 cursor-not-allowed"
          }`}
          title="Undo (Ctrl+Z)"
        >
          <i className="fa-solid fa-rotate-left"></i>
          <span className="text-sm">Undo</span>
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className={`flex-1 px-3 py-2 rounded flex items-center justify-center gap-2 transition-colors ${
            canRedo
              ? "bg-gray-700 text-white hover:bg-gray-600"
              : "bg-gray-900 text-gray-600 cursor-not-allowed"
          }`}
          title="Redo (Ctrl+Y)"
        >
          <i className="fa-solid fa-rotate-right"></i>
          <span className="text-sm">Redo</span>
        </button>
      </div>
    </div>
  );
}
