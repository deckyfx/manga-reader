import { useStudioStore } from "../../stores/studioFabricStore";
import {
  BrushToolButton,
  RectangleToolButton,
  OvalToolButton,
  PolygonToolButton,
  HistoryControls,
  ZoomControls,
  DeleteMaskButton,
  InpaintButton,
  AutoDetectButton,
  MergeAndSaveButton,
} from "./tools";
import { PageNavigation } from "./tools/PageNavigation";
import { OCRButton } from "./tools/OCRButton";

/**
 * StudioLeftPanel - Left sidebar with masking tool controls
 * Uses modular tool button components
 */
export function StudioLeftPanel() {
  const tool = useStudioStore((state) => state.tool);
  const setTool = useStudioStore((state) => state.setTool);

  return (
    <div className="w-70 bg-gray-800 border-r border-gray-700 flex flex-col overflow-hidden">
      {/* Tools section - takes minimum space */}
      <div className="p-4 flex-shrink-0">
        {/* Auto Detect Regions */}
        <div className="mb-4">
          <AutoDetectButton />
        </div>

        {/* Zoom Tools */}
        <div className="mb-4">
          <h3 className="text-white text-xs font-semibold mb-2">Zoom Tool</h3>
          <ZoomControls />
        </div>

        {/* Selection Tools */}
        <div className="mb-4">
          <h3 className="text-white text-xs font-semibold mb-2">Selection Tool</h3>
          <div className="grid grid-cols-3 gap-2">
            <RectangleToolButton tool={tool} onToggle={setTool} />
            <OvalToolButton tool={tool} onToggle={setTool} />
            <PolygonToolButton tool={tool} onToggle={setTool} />
          </div>
        </div>

        {/* Brush Tool */}
        <div className="mb-4">
          <h3 className="text-white text-xs font-semibold mb-2">Brush Tool</h3>
          <div className="flex gap-2">
            <BrushToolButton tool={tool} onToggle={setTool} />
            <HistoryControls />
            <DeleteMaskButton />
            <InpaintButton />
          </div>
        </div>

        {/* OCR */}
        <div className="mb-4">
          <h3 className="text-white text-xs font-semibold mb-2">OCR</h3>
          <OCRButton />
        </div>

        {/* Merge & Save Button */}
        <div>
          <MergeAndSaveButton />
        </div>
      </div>

      {/* Page Navigation - fills remaining space */}
      <PageNavigation />
    </div>
  );
}
