interface Point {
  x: number;
  y: number;
}

interface PolygonOverlayProps {
  points: Point[];
  editMode: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/**
 * PolygonOverlay Component
 *
 * Visual polygon border overlay for caption regions
 * - Green border in edit mode (clickable for editing)
 * - Blue border in view mode (hoverable for preview)
 * - Reusable across different caption workflows
 */
export function PolygonOverlay({
  points,
  editMode,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: PolygonOverlayProps) {
  // Convert points array to SVG polygon points string
  const pointsString = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg className="absolute inset-0 pointer-events-none" style={{ width: "100%", height: "100%" }}>
      <polygon
        points={pointsString}
        className={`transition-all cursor-pointer pointer-events-auto ${
          editMode
            ? "fill-green-500/10 stroke-green-500 hover:fill-green-500/20"
            : "fill-blue-500/10 stroke-blue-500 hover:fill-blue-500/20"
        }`}
        strokeWidth="2"
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
    </svg>
  );
}
