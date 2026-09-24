import { create } from "zustand";
import type { MaskLayerName } from "../api";
import {
  DEFAULT_BRUSH,
  MAX_BRUSH,
  MIN_BRUSH,
  readWheelMode,
  WHEEL_MODE_KEY,
  type EditMode,
  type Tool,
  type WheelMode,
} from "../studio/canvas/config";
import type { RegionKind } from "../studio/canvas/geometry";
import type { Area } from "../studio/canvas/mask-layers";
import type { Toolset } from "../studio/toolset";

interface CanvasState {
  /** What a drag does in Regions mode. */
  tool: Tool;
  /** Regions or Lettering. */
  mode: EditMode;
  /** The kind a newly drawn region gets. */
  kind: RegionKind;
  brushLayer: MaskLayerName;
  brushSize: number;
  showMask: boolean;
  showText: boolean;
  wheelMode: WheelMode;
  zoom: number;
  /** Spots painted into the add layer that haven't been re-cleaned yet, in page pixels. */
  paintedAreas: Area[];
  recleaning: boolean;
  /** Changes in flight; while any is, undo and redo wait. */
  busyCount: number;
  error: string | null;
  /** Counts page openings. A request that outlives the page it was started on is recognised by this. */
  session: number;

  setTool: (tool: Tool) => void;
  setMode: (mode: EditMode | ((current: EditMode) => EditMode)) => void;
  setKind: (kind: RegionKind) => void;
  setBrushLayer: (layer: MaskLayerName | ((current: MaskLayerName) => MaskLayerName)) => void;
  setBrushSize: (size: number | ((current: number) => number)) => void;
  setShowMask: (shown: boolean | ((current: boolean) => boolean)) => void;
  setShowText: (shown: boolean | ((current: boolean) => boolean)) => void;
  /** Also remembered per browser: it is a habit, not a page's property. */
  setWheelMode: (mode: WheelMode) => void;
  setZoom: (zoom: number) => void;
  setPaintedAreas: (areas: Area[] | ((current: Area[]) => Area[])) => void;
  setRecleaning: (running: boolean) => void;
  addBusy: (delta: number) => void;
  setError: (error: string | null) => void;
  /** Opens a page: the toolset it was left with, and nothing painted or failing yet. */
  open: (toolset: Toolset) => void;
}

/**
 * The session a request should report against, read when it starts. Pass it to `ifCurrent`, which drops the report
 * if another page has been opened meanwhile — a page's own busy count, error and re-clean state are its own.
 */
export const canvasSession = (): number => useCanvasStore.getState().session;

/** Runs `report` only if the page that started the request is still the one open. */
export const ifCurrent = (session: number, report: () => void): void => {
  if (useCanvasStore.getState().session === session) report();
};

const apply = <T>(next: T | ((current: T) => T), current: T): T => (typeof next === "function" ? (next as (c: T) => T)(current) : next);

/**
 * What the page canvas is set to: the tools, what is shown, the zoom, and how a change in flight is going.
 *
 * A store rather than component state because the canvas's Fabric handlers are registered once and need the latest
 * values (`getState()`), while the toolbar and the canvas itself re-render from them — the two used to be kept in step
 * by hand through a ref and a long list of props.
 */
export const useCanvasStore = create<CanvasState>((set, get) => ({
  tool: "select",
  mode: "regions",
  kind: "text",
  brushLayer: "add",
  brushSize: DEFAULT_BRUSH,
  showMask: false,
  showText: true,
  wheelMode: readWheelMode(),
  zoom: 1,
  paintedAreas: [],
  recleaning: false,
  busyCount: 0,
  error: null,
  session: 0,

  setTool: (tool) => set({ tool }),
  setMode: (mode) => set({ mode: apply(mode, get().mode) }),
  setKind: (kind) => set({ kind }),
  setBrushLayer: (layer) => set({ brushLayer: apply(layer, get().brushLayer) }),
  setBrushSize: (size) => set({ brushSize: Math.min(MAX_BRUSH, Math.max(MIN_BRUSH, Math.round(apply(size, get().brushSize)))) }),
  setShowMask: (shown) => set({ showMask: apply(shown, get().showMask) }),
  setShowText: (shown) => set({ showText: apply(shown, get().showText) }),
  setWheelMode: (wheelMode) => {
    try {
      localStorage.setItem(WHEEL_MODE_KEY, wheelMode);
    } catch {
      // Not persisted; the choice still applies for this visit
    }
    set({ wheelMode });
  },
  setZoom: (zoom) => set({ zoom }),
  setPaintedAreas: (areas) => set({ paintedAreas: apply(areas, get().paintedAreas) }),
  setRecleaning: (recleaning) => set({ recleaning }),
  addBusy: (delta) => set({ busyCount: Math.max(0, get().busyCount + delta) }),
  setError: (error) => set({ error }),
  open: (toolset) => set({
    tool: toolset.tool ?? "select",
    mode: toolset.mode ?? "regions",
    kind: toolset.kind ?? "text",
    brushLayer: toolset.brushLayer ?? "add",
    brushSize: toolset.brushSize ?? DEFAULT_BRUSH,
    showMask: toolset.showMask ?? false,
    showText: toolset.showText ?? true,
    paintedAreas: [],
    recleaning: false,
    busyCount: 0,
    error: null,
    session: get().session + 1,
  }),
}));

/** Whether the lettering layer shows: always in Lettering mode, otherwise only over a cleaned page when asked for. */
export const showsTextLayer = (state: CanvasState, textPreviewAvailable: boolean): boolean =>
  state.mode === "lettering" || (state.showText && textPreviewAvailable);
