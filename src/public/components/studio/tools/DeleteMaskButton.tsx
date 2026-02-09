import { useState } from "react";
import { useStudioStore } from "../../../stores/studioFabricStore";
import { api } from "../../../lib/api";
import { catchError } from "../../../../lib/error-handler";

/**
 * DeleteMaskButton - Delete mask data from database and clear canvas
 *
 * Features:
 * - Icon-only button with "Delete" text
 * - Manages own state (idle, deleting)
 * - Shows spinner while deleting
 * - After delete: clears mask objects from canvas and updates store
 */
export function DeleteMaskButton() {
  const [isDeleting, setIsDeleting] = useState(false);

  const fabricCanvas = useStudioStore((state) => state.fabricCanvas);
  const pageDataId = useStudioStore((state) => state.pageDataId);
  const hasMaskData = useStudioStore((state) => state.hasMaskData());
  const clearHistory = useStudioStore((state) => state.clearHistory);

  const handleDelete = async () => {
    if (!fabricCanvas || !pageDataId) return;

    setIsDeleting(true);

    const [error] = await catchError((async () => {
      // Delete from database
      const response = await api.api.studio.data.delete({
        id: pageDataId,
      });

      if (response.data?.success) {
        // Clear mask objects from canvas (preserve background image)
        const objects = fabricCanvas.getObjects();
        const maskObjects = objects.filter((obj) => !obj.excludeFromExport);
        maskObjects.forEach((obj) => fabricCanvas.remove(obj));

        // Clear history
        clearHistory();

        // Update store to clear pageDataId
        useStudioStore.setState({
          pageDataId: undefined,
          currentPageData: null,
        });

        fabricCanvas.renderAll();
      } else {
        console.error("Failed to delete mask data:", response.data?.error);
      }
    })());

    if (error) {
      console.error("Error deleting mask data:", error);
    }

    setIsDeleting(false);
  };

  // Disabled if no canvas or no mask data
  const isDisabled = !fabricCanvas || !hasMaskData;

  return (
    <button
      onClick={handleDelete}
      disabled={isDisabled || isDeleting}
      className={`px-3 py-2 rounded flex items-center justify-center transition-colors ${
        isDisabled || isDeleting
          ? "bg-gray-900 text-gray-600 cursor-not-allowed"
          : "bg-red-600 text-white hover:bg-red-700"
      }`}
      title="Delete mask data"
    >
      {isDeleting ? (
        <i className="fa-solid fa-spinner fa-spin"></i>
      ) : (
        <i className="fa-solid fa-trash"></i>
      )}
    </button>
  );
}
