import { useState } from "react";
import { useStudioStore } from "../../../stores/studioFabricStore";
import { api } from "../../../lib/api";

/**
 * SaveMaskButton - Save mask data to database
 *
 * Features:
 * - Icon-only button with "Save" text
 * - Manages own state (idle, saving, success)
 * - Shows spinner while saving
 * - After save: reloads page data and clears history
 */
export function SaveMaskButton() {
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const fabricCanvas = useStudioStore((state) => state.fabricCanvas);
  const pages = useStudioStore((state) => state.pages);
  const currentPageIndex = useStudioStore((state) => state.currentPageIndex);
  const chapterData = useStudioStore((state) => state.chapterData);
  const pageDataId = useStudioStore((state) => state.pageDataId);
  const hasUnsavedChanges = useStudioStore((state) => state.hasUnsavedChanges());
  const clearHistory = useStudioStore((state) => state.clearHistory);
  const loadPageData = useStudioStore((state) => state.loadPageData);

  const currentPage = pages[currentPageIndex];

  const handleSave = async () => {
    if (!fabricCanvas || !currentPage || !chapterData) return;

    setIsSaving(true);
    setShowSuccess(false);

    try {
      // Serialize canvas to JSON
      const canvasJSON = fabricCanvas.toJSON();
      const maskData = JSON.stringify(canvasJSON);

      // Save to database
      const response = await api.api.studio.data.post({
        id: pageDataId,
        pageId: currentPage.id,
        maskData,
      });

      if (response.data?.success) {
        // Reload page data
        if (currentPage.slug && chapterData.slug) {
          await loadPageData(chapterData.slug, currentPage.slug);
        }

        // Clear history
        clearHistory();

        // Show success indicator
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 2000);
      } else {
        console.error("Failed to save mask data:", response.data?.error);
      }
    } catch (error) {
      console.error("Error saving mask data:", error);
    } finally {
      setIsSaving(false);
    }
  };

  // Disabled if no canvas, no current page, or nothing to save
  const isDisabled = !fabricCanvas || !currentPage || !hasUnsavedChanges;

  return (
    <button
      onClick={handleSave}
      disabled={isDisabled || isSaving}
      className={`px-3 py-2 rounded flex items-center justify-center gap-2 transition-colors ${
        isDisabled || isSaving
          ? "bg-gray-900 text-gray-600 cursor-not-allowed"
          : showSuccess
            ? "bg-green-600 text-white"
            : "bg-blue-600 text-white hover:bg-blue-700"
      }`}
      title="Save mask data (Ctrl+S)"
    >
      {isSaving ? (
        <>
          <i className="fa-solid fa-spinner fa-spin"></i>
          <span className="text-sm">Saving...</span>
        </>
      ) : showSuccess ? (
        <>
          <i className="fa-solid fa-check"></i>
          <span className="text-sm">Saved!</span>
        </>
      ) : (
        <>
          <i className="fa-solid fa-floppy-disk"></i>
          <span className="text-sm">Save</span>
        </>
      )}
    </button>
  );
}
