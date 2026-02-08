import { useNavigate } from "react-router-dom";
import { useStudioStore } from "../../stores/studioFabricStore";
import {
  UnsavedChangesConfirmation,
  useUnsavedChangesConfirmation,
} from "./UnsavedChangesConfirmation";

/**
 * StudioHeader - Top navigation bar for Studio mode
 *
 * Displays chapter title, current page info, and exit button
 */
export function StudioHeader() {
  const navigate = useNavigate();

  // Get state from Zustand store
  const seriesData = useStudioStore((state) => state.seriesData);
  const chapterData = useStudioStore((state) => state.chapterData);
  const pages = useStudioStore((state) => state.pages);
  const currentPageIndex = useStudioStore((state) => state.currentPageIndex);
  const hasUnsavedChanges = useStudioStore((state) => state.hasUnsavedChanges());

  // Unsaved changes confirmation
  const confirmation = useUnsavedChangesConfirmation();

  const currentPage = pages[currentPageIndex];
  const chapterTitle = chapterData?.title || "Loading...";
  const pageNumber = currentPage?.orderNum || 0;
  const totalPages = pages.length;

  /**
   * Exit handler - navigate to reader page
   * Format: /r/series_slug/chapter_slug/page_num
   *
   * Uses data from Zustand store:
   * - seriesData.slug → seriesSlug
   * - chapterData.slug → chapterSlug
   * - currentPage.orderNum → pageNum
   */
  const handleExit = () => {
    if (!seriesData || !chapterData || !currentPage) {
      // Fallback: navigate back
      navigate(-1);
      return;
    }

    // Use actual series slug from database
    const seriesSlug = seriesData.slug;
    const chapterSlug = chapterData.slug;
    const pageNum = currentPage.orderNum;

    // Check for unsaved changes
    if (hasUnsavedChanges) {
      confirmation.show((confirmed) => {
        if (confirmed) {
          // Navigate to reader page
          navigate(`/r/${seriesSlug}/${chapterSlug}/${pageNum}`);
        }
      });
    } else {
      // No unsaved changes - navigate directly
      navigate(`/r/${seriesSlug}/${chapterSlug}/${pageNum}`);
    }
  };

  return (
    <>
      <div className="h-12 bg-gray-900 text-white flex items-center px-4 gap-4 flex-shrink-0">
        <span className="font-bold text-lg">Studio</span>
        <span className="text-gray-400">—</span>
        <span className="text-gray-300 truncate flex-1">{chapterTitle}</span>
        <span className="text-gray-400 text-sm">
          Page {pageNumber} / {totalPages}
        </span>
        <button
          onClick={handleExit}
          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold rounded transition-colors"
        >
          Exit
        </button>
      </div>

      {/* Unsaved changes confirmation for Exit button */}
      <UnsavedChangesConfirmation {...confirmation.props} />
    </>
  );
}
