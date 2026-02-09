import { useStudioStore } from "../../stores/studioFabricStore";
import type {
  ExtendedRect,
  ExtendedEllipse,
  ExtendedPolygon,
} from "../../types/fabric-extensions";

/**
 * AddAllTextsButton - Creates text objects for all regions with translated text
 *
 * Button displayed at the top of region list that processes all regions at once
 */
export function AddAllTextsButton() {
  const fabricCanvas = useStudioStore((s) => s.fabricCanvas);
  const createTextObjectFromRegion = useStudioStore(
    (s) => s.createTextObjectFromRegion,
  );

  const handleAddAllTexts = () => {
    if (!fabricCanvas) return;

    const objects = fabricCanvas.getObjects();

    // Find all mask regions with translated text
    const regions = objects.filter((obj) => {
      if (
        obj.type !== "rect" &&
        obj.type !== "ellipse" &&
        obj.type !== "polygon"
      ) {
        return false;
      }

      const mask = obj as ExtendedRect | ExtendedEllipse | ExtendedPolygon;
      return mask.data?.type === "mask" && mask.data?.translatedText;
    });

    if (regions.length === 0) {
      return;
    }

    // Create text objects for all regions
    // Note: We iterate backwards because createTextObjectFromRegion removes items
    for (let i = regions.length - 1; i >= 0; i--) {
      const region = regions[i];
      if (region) {
        createTextObjectFromRegion(region);
      }
    }
  };

  return (
    <button
      onClick={handleAddAllTexts}
      className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded"
    >
      <i className="fa-solid fa-wand-magic-sparkles mr-2"></i>
      Add All Texts
    </button>
  );
}
