import { useStudioStore } from "../../stores/studioFabricStore";
import {
  BrushToolButton,
  RectangleToolButton,
  OvalToolButton,
  PolygonToolButton,
  HistoryControls,
  ZoomControls,
  DeleteMaskButton,
  SaveMaskButton,
  InpaintButton,
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
    <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col overflow-hidden">
      {/* Tools section - takes minimum space */}
      <div className="p-4 flex-shrink-0">
        <h3 className="text-white text-sm font-semibold mb-2">Masking Tools</h3>

        <div className="grid grid-cols-4 gap-2">
          <BrushToolButton tool={tool} onToggle={setTool} />
          <RectangleToolButton tool={tool} onToggle={setTool} />
          <OvalToolButton tool={tool} onToggle={setTool} />
          <PolygonToolButton tool={tool} onToggle={setTool} />
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <InpaintButton />
          <OCRButton />
        </div>

        <div className="mt-4">
          <HistoryControls />
        </div>

        <div className="mt-4">
          <ZoomControls />
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <DeleteMaskButton />
          <SaveMaskButton />
        </div>
      </div>

      {/* Page Navigation - fills remaining space */}
      <PageNavigation />
    </div>
  );
}
