/**
 * The page canvas's toolbar: edit mode, region tools and the brush, the mask and lettering overlays, re-clean, undo /
 * redo / delete, the wheel mode and zoom, and the status line. Split out of PageCanvas.tsx; the canvas owns the state
 * and hands it down under the same names.
 */
import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import { useRef, useState } from "react";
import {
  ALargeSmall,
  Brush,
  Circle as EllipseIcon,
  Eye,
  EyeOff,
  Maximize,
  MousePointer2,
  MoveHorizontal,
  MoveVertical,
  Pentagon,
  Redo2,
  Shapes,
  Square,
  Trash2,
  Type,
  Undo2,
  WandSparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { MaskLayerName } from "../../api";
import { KIND_HINTS, LETTERING_HINT, MAX_BRUSH, MIN_BRUSH, TOOL_HINTS, WHEEL_HINTS, type CanvasActions, type EditMode, type Tool, type WheelMode } from "./config";
import { REGION_COLORS, type RegionKind } from "./geometry";
import type { CommandHistory } from "./history";
import type { Area } from "./mask-layers";

interface CanvasToolbarProps {
  /** Extra controls at the start (the background image picker). */
  toolbarStart?: ReactNode;
  mode: EditMode;
  setMode: Dispatch<SetStateAction<EditMode>>;
  tool: Tool;
  setTool: Dispatch<SetStateAction<Tool>>;
  disabled: boolean;
  brushLayer: MaskLayerName;
  setBrushLayer: Dispatch<SetStateAction<MaskLayerName>>;
  brushSize: number;
  setBrushSize: Dispatch<SetStateAction<number>>;
  kind: RegionKind;
  setKind: Dispatch<SetStateAction<RegionKind>>;
  showMask: boolean;
  setShowMask: Dispatch<SetStateAction<boolean>>;
  setShowText: Dispatch<SetStateAction<boolean>>;
  textPreviewAvailable: boolean;
  /** Whether the lettering layer is showing right now. */
  showTextLayer: boolean;
  reclean: () => void;
  recleaning: boolean;
  recleanTargets: Area[];
  recleanTitle: string;
  paintedAreas: Area[];
  /** Runs a change after the ones already queued (undo and redo go through it). */
  enqueue: (task: () => Promise<void>) => void;
  history: CommandHistory;
  busyCount: number;
  actionsRef: RefObject<CanvasActions | null>;
  selectedId: number | null;
  wheelMode: WheelMode;
  setWheelMode: (mode: WheelMode) => void;
  zoom: number;
  error: string | null;
}

export function CanvasToolbar({
  toolbarStart, mode, setMode, tool, setTool, disabled, brushLayer, setBrushLayer, brushSize, setBrushSize, kind, setKind,
  showMask, setShowMask, setShowText, textPreviewAvailable, showTextLayer, reclean, recleaning, recleanTargets, recleanTitle,
  paintedAreas, enqueue, history, busyCount, actionsRef, selectedId, wheelMode, setWheelMode, zoom, error,
}: CanvasToolbarProps) {
const toolButton = (value: Tool, icon: ReactNode, label: string, shortcut: string) => (
  <button
    key={value}
    onClick={() => setTool(value)}
    disabled={disabled}
    title={`${label} (${shortcut})`}
    aria-pressed={tool === value}
    className={`p-1.5 rounded-md disabled:opacity-40 ${tool === value ? "bg-indigo-600 text-white" : "text-gray-300 hover:bg-gray-800"}`}
  >
    {icon}
  </button>
);

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-gray-800">
      {toolbarStart}
      <div className="flex items-center rounded-md border border-gray-700 overflow-hidden text-xs" role="group" aria-label="Edit mode">
        {([
          { value: "regions", icon: <Shapes size={14} />, label: "Regions", hint: "Regions (L toggles): draw and edit detection areas, paint the mask" },
          { value: "lettering", icon: <Type size={14} />, label: "Lettering", hint: "Lettering (L toggles): move, resize, rotate and edit the translated text on the page" },
        ] as const).map(({ value, icon, label, hint }) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            aria-pressed={mode === value}
            title={hint}
            className={`flex items-center gap-1.5 px-2.5 py-1 ${mode === value ? "bg-violet-600 text-white" : "text-gray-400 hover:bg-gray-800"}`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>
      {mode === "regions" && (
      <>
      <div className="flex items-center gap-0.5" role="toolbar" aria-label="Region tools">
        {toolButton("select", <MousePointer2 size={15} />, "Select", "V")}
        {toolButton("rect", <Square size={15} />, "Rectangle", "R")}
        {toolButton("ellipse", <EllipseIcon size={15} />, "Ellipse", "E")}
        {toolButton("polygon", <Pentagon size={15} />, "Polygon", "P")}
        {toolButton("brush", <Brush size={15} />, "Mask brush", "B")}
      </div>
      {tool === "brush" ? (
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center rounded-md border border-gray-700 overflow-hidden" role="group" aria-label="Brush paints">
            {([
              { value: "add", label: "Add", color: "#22c55e", hint: "Paint text the detector missed" },
              { value: "erase", label: "Erase", color: "#ef4444", hint: "Paint art the detector wrongly took for text" },
            ] as const).map(({ value, label, color, hint }) => (
              <button
                key={value}
                onClick={() => setBrushLayer(value)}
                aria-pressed={brushLayer === value}
                title={`${hint} (X swaps)`}
                className={`px-2 py-1 ${brushLayer === value ? "bg-gray-700 text-gray-50" : "text-gray-400 hover:bg-gray-800"}`}
                style={brushLayer === value ? { boxShadow: `inset 0 -2px 0 ${color}` } : undefined}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-gray-400" title="Brush size in page pixels ([ and ])">
            <input
              type="range"
              aria-label="Brush size"
              min={MIN_BRUSH}
              max={MAX_BRUSH}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              // Hand the keyboard back to the canvas so the shortcuts keep working
              onPointerUp={(e) => e.currentTarget.blur()}
              className="w-20"
            />
            <span className="w-10 tabular-nums">{brushSize}px</span>
          </label>
        </div>
      ) : (
        <div className="flex items-center rounded-md border border-gray-700 overflow-hidden text-xs" role="group" aria-label="New region kind">
          {(["text", "sfx"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setKind(value)}
              aria-pressed={kind === value}
              title={KIND_HINTS[value]}
              className={`px-2 py-1 ${kind === value ? "bg-gray-700 text-gray-50" : "text-gray-400 hover:bg-gray-800"}`}
              style={kind === value ? { boxShadow: `inset 0 -2px 0 ${REGION_COLORS[value].stroke}` } : undefined}
            >
              {value === "text" ? "Text" : "SFX"}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setShowMask((shown) => !shown)}
          disabled={tool === "brush"}
          aria-pressed={showMask || tool === "brush"}
          title="Show the text mask (M): blue detected, green painted in, red erased"
          aria-label="Show the text mask"
          className="p-1.5 rounded-md text-gray-300 hover:bg-gray-800 disabled:opacity-60"
        >
          {showMask || tool === "brush" ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
        <button
          onClick={() => setShowText((shown) => !shown)}
          disabled={!textPreviewAvailable}
          aria-pressed={showTextLayer}
          aria-label="Show the lettering preview"
          title={textPreviewAvailable
            ? "Show the lettering as the burn would draw it"
            : "The lettering preview shows over a cleaned page: pick Cleaned text or Cleaned SFX as the background"}
          className={`p-1.5 rounded-md hover:bg-gray-800 disabled:opacity-40 ${showTextLayer ? "text-violet-300" : "text-gray-400"}`}
        >
          <ALargeSmall size={15} />
        </button>
        <button
          onClick={reclean}
          disabled={disabled || recleaning || recleanTargets.length === 0}
          title={recleanTitle}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-200 bg-gray-800 hover:bg-gray-700 disabled:opacity-40"
        >
          <WandSparkles size={14} />
          Re-clean{paintedAreas.length > 0 ? ` (${paintedAreas.length})` : ""}
        </button>
      </div>
      </>
      )}
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => enqueue(() => history.undo())}
          disabled={!history.canUndo || busyCount > 0}
          title={history.undoLabel ? `Undo: ${history.undoLabel} (Ctrl+Z)` : "Undo (Ctrl+Z)"}
          className="p-1.5 rounded-md text-gray-300 hover:bg-gray-800 disabled:opacity-40"
        >
          <Undo2 size={15} />
        </button>
        <button
          onClick={() => enqueue(() => history.redo())}
          disabled={!history.canRedo || busyCount > 0}
          title={history.redoLabel ? `Redo: ${history.redoLabel} (Ctrl+Shift+Z)` : "Redo (Ctrl+Shift+Z)"}
          className="p-1.5 rounded-md text-gray-300 hover:bg-gray-800 disabled:opacity-40"
        >
          <Redo2 size={15} />
        </button>
        <button
          onClick={() => actionsRef.current?.deleteSelected()}
          disabled={disabled || selectedId === null}
          title="Delete selected region (Delete)"
          aria-label="Delete selected region"
          className="p-1.5 rounded-md text-gray-300 hover:bg-red-900/60 hover:text-red-200 disabled:opacity-40"
        >
          <Trash2 size={15} />
        </button>
      </div>
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
      <div className="flex items-center gap-0.5 text-xs text-gray-400">
        <button onClick={() => actionsRef.current?.zoomBy(1 / 1.2)} title="Zoom out (-)" className="p-1.5 rounded-md hover:bg-gray-800">
          <ZoomOut size={15} />
        </button>
        <ZoomField zoom={zoom} onZoom={(value) => actionsRef.current?.zoomTo(value)} />
        <button onClick={() => actionsRef.current?.zoomBy(1.2)} title="Zoom in (+)" className="p-1.5 rounded-md hover:bg-gray-800">
          <ZoomIn size={15} />
        </button>
        <button onClick={() => actionsRef.current?.fit()} title="Fit page (F)" className="p-1.5 rounded-md hover:bg-gray-800">
          <Maximize size={15} />
        </button>
      </div>
      <span className="ml-auto text-xs truncate max-w-full">
        {error ? <span className="text-red-400">{error}</span> : busyCount > 0 ? <span className="text-gray-400">{recleaning ? "Re-cleaning…" : "Saving…"}</span> : <span className="text-gray-500">{mode === "lettering" ? LETTERING_HINT : TOOL_HINTS[tool]} · {WHEEL_HINTS[wheelMode]}, Ctrl+wheel zooms, Space-drag pans</span>}
      </span>
    </div>
  );
}

/**
 * The zoom percentage, typed into: Enter or leaving the field applies it (100 for actual size), Escape puts back the
 * current zoom. Anything that isn't a positive number is ignored.
 */
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
            apply();
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
