import { useStudioStore } from "../../../stores/studioFabricStore";

/**
 * InpaintButton - Trigger mask-based inpainting
 * Exports brush mask and sends to AnimeLaMa backend
 */
export function InpaintButton() {
  const inpaintPage = useStudioStore((state) => state.inpaintPage);
  const isInpainting = useStudioStore((state) => state.isInpainting);
  const hasMask = useStudioStore((state) => {
    const canvas = state.fabricCanvas;
    if (!canvas) return false;
    const objects = canvas.getObjects();
    return objects.some((obj) => obj.type === "path");
  });

  const handleClick = () => {
    if (!hasMask) {
      alert("Please draw a mask first using the brush tool");
      return;
    }
    inpaintPage();
  };

  return (
    <button
      onClick={handleClick}
      disabled={isInpainting || !hasMask}
      className={`
        aspect-square px-3 py-2 rounded
        flex items-center justify-center
        transition-colors
        ${
          isInpainting || !hasMask
            ? "bg-gray-600 text-gray-400 cursor-not-allowed"
            : "bg-blue-600 text-white hover:bg-blue-700"
        }
      `}
      title={!hasMask ? "Draw a mask first" : "Inpaint masked areas"}
    >
      {isInpainting ? (
        <i className="fa-solid fa-spinner fa-spin"></i>
      ) : (
        <i className="fa-solid fa-wand-magic-sparkles"></i>
      )}
    </button>
  );
}
