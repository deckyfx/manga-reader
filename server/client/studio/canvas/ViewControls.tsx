/**
 * Controls every Studio page view shares: what the mouse wheel does, and the zoom. Split out of CanvasToolbar.tsx so the
 * stage comparison offers the same ones; the wheel mode is one setting for both views.
 */
import { useRef, useState } from "react";
import { Maximize, MoveHorizontal, MoveVertical, ZoomIn, ZoomOut } from "lucide-react";
import { useCanvasStore } from "../../stores/canvas";
import { ZOOM_STEP } from "./config";

/** The wheel's action without modifiers: zoom, scroll up/down, or scroll sideways. */
export function WheelModeButtons() {
  const wheelMode = useCanvasStore((state) => state.wheelMode);
  const { setWheelMode } = useCanvasStore.getState();
  return (
    <div className="flex items-center gap-1 text-xs text-gray-400" role="group" aria-label="Mouse wheel action">
      <span className="hidden md:inline">Wheel</span>
      <div className="flex items-center rounded-md border border-gray-700 overflow-hidden">
        {([
          { mode: "zoom", icon: <ZoomIn size={14} />, label: "Wheel zooms (Shift+wheel scrolls up/down)" },
          { mode: "vertical", icon: <MoveVertical size={14} />, label: "Wheel scrolls up/down (Shift+wheel scrolls sideways)" },
          { mode: "horizontal", icon: <MoveHorizontal size={14} />, label: "Wheel scrolls sideways (Shift+wheel scrolls up/down)" },
        ] as const).map(({ mode, icon, label }) => (
          <button
            key={mode}
            onClick={() => setWheelMode(mode)}
            title={`${label}. Ctrl+wheel always zooms.`}
            aria-label={label}
            aria-pressed={wheelMode === mode}
            className={`px-1.5 py-1 ${wheelMode === mode ? "bg-gray-700 text-gray-50" : "text-gray-400 hover:bg-gray-800"}`}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Zoom out, the zoom as an editable percentage, zoom in, and fit. */
export function ZoomControls({ zoom, onZoomBy, onZoomTo, onFit, fitTitle = "Fit page" }: {
  zoom: number;
  onZoomBy: (factor: number) => void;
  onZoomTo: (value: number) => void;
  onFit: () => void;
  fitTitle?: string;
}) {
  return (
    <div className="flex items-center gap-0.5 text-xs text-gray-400">
      <button onClick={() => onZoomBy(1 / ZOOM_STEP)} title="Zoom out (-)" className="p-1.5 rounded-md hover:bg-gray-800">
        <ZoomOut size={15} />
      </button>
      <ZoomField zoom={zoom} onZoom={onZoomTo} />
      <button onClick={() => onZoomBy(ZOOM_STEP)} title="Zoom in (+)" className="p-1.5 rounded-md hover:bg-gray-800">
        <ZoomIn size={15} />
      </button>
      <button onClick={onFit} title={fitTitle} className="p-1.5 rounded-md hover:bg-gray-800">
        <Maximize size={15} />
      </button>
    </div>
  );
}

function ZoomField({ zoom, onZoom }: { zoom: number; onZoom: (value: number) => void }) {
  const shown = String(Math.round(zoom * 100));
  const [draft, setDraft] = useState<string | null>(null);
  // Escape blurs the field, and the blur must not apply what Escape just threw away
  const cancelled = useRef(false);
  const apply = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(null);
      return;
    }
    if (draft === null) return;
    const percent = Number.parseFloat(draft.replace("%", ""));
    setDraft(null);
    if (Number.isFinite(percent) && percent > 0) onZoom(percent / 100);
  };
  return (
    <label className="flex items-center rounded-md px-1 hover:bg-gray-800 focus-within:bg-gray-800" title="Zoom: type a percentage, 100 for actual size">
      <input
        value={draft ?? shown}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // Blurring applies it, once: applying here as well ran it twice, before the draft was cleared
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        inputMode="decimal"
        aria-label="Zoom percentage"
        className="w-9 bg-transparent text-right tabular-nums focus:outline-none"
      />
      <span>%</span>
    </label>
  );
}
