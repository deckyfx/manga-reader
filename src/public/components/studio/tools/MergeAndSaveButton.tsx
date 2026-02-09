import { useState } from "react";
import { useStudioStore } from "../../../stores/studioFabricStore";
import { useSnackbar } from "../../../hooks/useSnackbar";
import { useMergeConfirmation } from "../MergeConfirmation";
import { catchError } from "../../../../lib/error-handler";

/**
 * MergeAndSaveButton - Merge all textboxes onto image and save
 *
 * Workflow:
 * 1. Export canvas with all textboxes merged onto background
 * 2. Upload merged image to replace page's originalImage
 * 3. Remove all textboxes from canvas
 * 4. Reload page with merged image
 */
export function MergeAndSaveButton() {
  const mergeAndSave = useStudioStore((s) => s.mergeAndSave);
  const fabricCanvas = useStudioStore((s) => s.fabricCanvas);
  const { showSnackbar, SnackbarComponent } = useSnackbar();
  const { show: showMergeConfirm, MergeConfirmationComponent } =
    useMergeConfirmation();
  const [isMerging, setIsMerging] = useState(false);

  const handleMerge = async () => {
    if (!fabricCanvas) return;

    // Check if there are any textboxes
    const objects = fabricCanvas.getObjects();
    const hasTextboxes = objects.some((o) => o.type === "textbox");

    if (!hasTextboxes) {
      showSnackbar("No text objects to merge", "warning");
      return;
    }

    // Show custom confirmation dialog
    showMergeConfirm(async () => {
      setIsMerging(true);

      const [error] = await catchError((async () => {
        await mergeAndSave();
        showSnackbar("Successfully merged and saved!", "success");
      })());

      if (error) {
        console.error("Merge error:", error);
        showSnackbar(
          `Failed to merge: ${error.message}`,
          "error"
        );
      }

      setIsMerging(false);
    });
  };

  return (
    <>
      {SnackbarComponent}
      {MergeConfirmationComponent}
      <button
        onClick={handleMerge}
        disabled={isMerging}
        className={`w-full px-4 py-2 rounded font-medium text-white ${
          isMerging
            ? "bg-gray-600 cursor-not-allowed"
            : "bg-orange-600 hover:bg-orange-700"
        }`}
      >
        {isMerging ? "Merging..." : "🎨 Merge & Save"}
      </button>
    </>
  );
}
