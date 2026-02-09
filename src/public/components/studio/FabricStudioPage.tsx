import { useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useStudioStore } from "../../stores/studioFabricStore";
import { StudioHeader } from "./StudioHeader";
import { StudioLeftPanel } from "./StudioLeftPanel";
import { StudioCanvas } from "./StudioCanvas";
import { StudioRightPanel } from "./StudioRightPanel";
import { TextObjectPopover } from "./TextObjectPopover";
import {
  UnsavedChangesConfirmation,
  useUnsavedChangesConfirmation,
} from "./UnsavedChangesConfirmation";

/**
 * FabricStudioPage - Minimal masking brush implementation with Zustand
 *
 * Orchestrates:
 * - Chapter data loading
 * - Page navigation
 * - Unsaved changes warning
 * - Child components (header + tool panel + canvas)
 */
export function FabricStudioPage() {
  const { chapterSlug } = useParams();
  const pageSlug = window.location.hash.slice(1);
  const navigate = useNavigate();

  // Zustand store
  const loadChapterData = useStudioStore((state) => state.loadChapterData);
  const hasUnsavedChanges = useStudioStore((state) =>
    state.hasUnsavedChanges(),
  );
  const reset = useStudioStore((state) => state.reset);

  // Track previous page to detect changes (initialized to empty for first load)
  const prevPageSlugRef = useRef<string>("");

  // Unsaved changes confirmation dialog
  const confirmation = useUnsavedChangesConfirmation();

  // Reset store on unmount
  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  // Load chapter data on mount with initial page
  useEffect(() => {
    if (!chapterSlug) return;

    const isInitialLoad = prevPageSlugRef.current === "";
    const pageChanged = prevPageSlugRef.current !== pageSlug;

    // If same page and not initial load, skip
    if (!pageChanged && !isInitialLoad) {
      return;
    }

    // Check for unsaved changes (but not on initial load)
    if (!isInitialLoad && pageChanged && hasUnsavedChanges) {
      console.log("Showing unsaved changes confirmation");
      // Show confirmation dialog
      confirmation.show((confirmed) => {
        if (confirmed) {
          // User confirmed - proceed with page change
          prevPageSlugRef.current = pageSlug;
          loadChapterData(chapterSlug, pageSlug || undefined);
        } else {
          // User cancelled - revert URL back to previous page
          const prevSlug = prevPageSlugRef.current;
          if (prevSlug) {
            window.history.replaceState(null, "", `#${prevSlug}`);
          }
        }
      });
      return;
    }

    // Initial load or page changed without unsaved changes - proceed directly
    prevPageSlugRef.current = pageSlug;
    loadChapterData(chapterSlug, pageSlug || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterSlug, pageSlug]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-900">
      {/* Header */}
      <StudioHeader />

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        <StudioLeftPanel />
        <StudioCanvas />
        <StudioRightPanel />
      </div>

      {/* Unsaved changes confirmation dialog */}
      <UnsavedChangesConfirmation {...confirmation.props} />

      {/* Text object popover (renders as portal) */}
      <TextObjectPopover />
    </div>
  );
}
