/**
 * The floating frame the lettering panel sits in: placed next to the selected lettering, or wherever it was dragged
 * by its grab bar (then "Moved", with Follow to put it back). Split out of PageCanvas.tsx, which decides where it goes.
 */
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { GripHorizontal, LocateFixed } from "lucide-react";
import { PANEL_OUTER_HEIGHT, PANEL_WIDTH } from "./config";

interface LetteringPanelFrameProps {
  /** Where the frame sits in the canvas area, in pixels. */
  spot: { left: number; top: number };
  /** Dragged out of the way, rather than following the selection. */
  pinned: boolean;
  /** Pins the frame at a spot, or (null) lets it follow the selection again. */
  onPin: (spot: { left: number; top: number } | null) => void;
  /** The canvas area the frame is kept inside. */
  hostRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

export function LetteringPanelFrame({ spot, pinned, onPin, hostRef, children }: LetteringPanelFrameProps) {
  const panelDragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  /** Dragging the lettering panel by its grab bar, kept inside the canvas area. */
  const startPanelDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panelDragRef.current = { x: e.clientX, y: e.clientY, left: spot.left, top: spot.top };
  };
  const movePanel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panelDragRef.current;
    const host = hostRef.current;
    if (!drag || !host) return;
    // Kept fully inside the canvas area (it clips), so the panel's bottom controls stay reachable
    const left = Math.min(Math.max(0, drag.left + e.clientX - drag.x), Math.max(0, host.clientWidth - PANEL_WIDTH));
    const top = Math.min(Math.max(0, drag.top + e.clientY - drag.y), Math.max(0, host.clientHeight - PANEL_OUTER_HEIGHT));
    onPin({ left: Math.round(left), top: Math.round(top) });
  };
  const endPanelDrag = () => {
    panelDragRef.current = null;
  };

  return (
    <div
      className="absolute z-20 rounded-lg border border-violet-500/40 bg-gray-900/95 shadow-2xl backdrop-blur flex flex-col"
      // The same width the drag clamp keeps inside the canvas area
      style={{ left: spot.left, top: spot.top, width: PANEL_WIDTH }}
    >
      <div
        onPointerDown={startPanelDrag}
        onPointerMove={movePanel}
        onPointerUp={endPanelDrag}
        onPointerCancel={endPanelDrag}
        title="Drag to move this panel out of the way"
        className="flex items-center gap-1.5 px-2 py-1 border-b border-gray-800 text-[11px] text-gray-500 cursor-grab active:cursor-grabbing select-none touch-none"
      >
        <GripHorizontal size={14} />
        {pinned ? "Moved" : "Drag to move"}
        {pinned && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onPin(null)}
            title="Put the panel back next to the selected lettering"
            className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-violet-300 hover:bg-gray-800"
          >
            <LocateFixed size={12} />
            Follow
          </button>
        )}
      </div>
      <div className="max-h-[340px] overflow-y-auto">{children}</div>
    </div>
  );
}
