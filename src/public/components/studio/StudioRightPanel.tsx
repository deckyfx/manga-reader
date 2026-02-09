import React from "react";
import { RegionListPanel } from "./RegionListPanel";

/**
 * StudioRightPanel - Host component for right sidebar
 *
 * Layout:
 * - Full height: RegionListPanel (region list with OCR/ReTranslate/Clean controls)
 *
 * Note: TextObject controls moved to floating popover (TextObjectPopover)
 */
export function StudioRightPanel() {
  return (
    <div className="w-70 bg-gray-800 border-l border-gray-700 flex flex-col overflow-hidden">
      <RegionListPanel />
    </div>
  );
}
