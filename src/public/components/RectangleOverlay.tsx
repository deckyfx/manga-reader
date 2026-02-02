interface RectangleOverlayProps {
  x: number;
  y: number;
  width: number;
  height: number;
  editMode: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/**
 * RectangleOverlay Component
 *
 * Visual rectangle border overlay for caption regions
 * - Green border in edit mode (clickable for editing)
 * - Blue border in view mode (hoverable for preview)
 * - Reusable across different caption workflows
 */
export function RectangleOverlay({
  x,
  y,
  width,
  height,
  editMode,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: RectangleOverlayProps) {
  return (
    <div
      className={`absolute border-2 transition-all ${
        editMode
          ? "border-green-500 bg-green-300 bg-opacity-20 cursor-pointer hover:bg-opacity-40"
          : "border-blue-500 bg-blue-300 bg-opacity-10 cursor-pointer hover:bg-opacity-30"
      }`}
      style={{
        left: x,
        top: y,
        width,
        height,
      }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  );
}
