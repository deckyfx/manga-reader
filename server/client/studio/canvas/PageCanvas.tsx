import { useCallback, useEffect, useImperativeHandle, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from "react";
import { Canvas, Circle, Ellipse, FabricImage, Line, Point, Polyline, Rect, util, type FabricObject } from "fabric";
import {
  ALargeSmall,
  Brush,
  Circle as EllipseIcon,
  Eye,
  EyeOff,
  GripHorizontal,
  LocateFixed,
  Maximize,
  Shapes,
  MousePointer2,
  MoveHorizontal,
  MoveVertical,
  Pentagon,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  WandSparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  createBlock,
  deleteBlock,
  recleanAreas,
  saveMaskLayer,
  updateBlock,
  updateBlockGeometry,
  type BlockGeometry,
  type LetteringPaths,
  type MaskLayerName,
  type TextStyle,
  type StudioBlock,
  type StudioPageDetail,
} from "../../api";
import {
  blockGeometry,
  blockIdOf,
  blockKind,
  draftOptions,
  geometryKey,
  geometryOf,
  pagePoint,
  polygonGeometry,
  regionKey,
  regionObject,
  REGION_COLORS,
  type PageSize,
  type RegionKind,
} from "./geometry";
import { CommandHistory, type Command } from "./history";
import { MaskLayers, mergeAreas, type Area, type StrokeRecord } from "./mask-layers";
import type { LetteringItem } from "../text/typesetter";
import { LetteringObject, letteringIdOf } from "./lettering-object";
import type { Toolset } from "../toolset";

export type Tool = "select" | "rect" | "ellipse" | "polygon" | "brush";

/** Regions: detection areas and the mask. Lettering: the translated text floating on the page. */
export type EditMode = "regions" | "lettering";

/** What the mouse wheel does without modifiers; Ctrl/Cmd + wheel always zooms, Shift switches direction. */
type WheelMode = "zoom" | "vertical" | "horizontal";

const WHEEL_MODE_KEY = "studio-canvas-wheel-mode";

/** Saved wheel mode; storage can be unavailable (private mode), so fall back to scrolling up/down. */
function readWheelMode(): WheelMode {
  try {
    const saved = localStorage.getItem(WHEEL_MODE_KEY);
    return saved === "zoom" || saved === "horizontal" ? saved : "vertical";
  } catch {
    return "vertical";
  }
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
/** Zoom speed per wheel pixel: one ordinary wheel notch (~100px) zooms exactly 10%, about 7 notches to double. */
const WHEEL_ZOOM_RATE = Math.log(1.1) / 100;
/** Largest wheel delta (pixels) honoured per event, so fast flicks and hi-res wheels don't jump several levels. */
const WHEEL_MAX_DELTA = 300;
/** Drawn regions smaller than this (page pixels) are treated as accidental clicks. */
const MIN_REGION = 5;
/** Mask brush diameter range and default, in page pixels. */
const MIN_BRUSH = 2;
const MAX_BRUSH = 200;
const DEFAULT_BRUSH = 24;

const TOOL_HINTS: Record<Tool, string> = {
  select: "Click a region to select, drag to move, handles to resize, Delete to remove; drag empty space to pan",
  rect: "Drag on empty space to draw a rectangle",
  ellipse: "Drag on empty space to draw an ellipse",
  polygon: "Click to add points; Enter, double-click or the first point to finish; Esc to cancel",
  brush: "Add paints text the detector missed, Erase paints art it caught; X swaps, [ ] resize; then Re-clean",
};

const LETTERING_HINT = "Drag lettering to move it, handles to resize, the top knob to rotate; double-click to edit the text";

/** Lettering panel size: 300 wide; its content scrolls past 340, plus the grab bar and borders. */
const PANEL_WIDTH = 300;
const PANEL_OUTER_HEIGHT = 372;

/** Lettering selection colour (violet, distinct from text/sfx regions). */
const LETTERING_COLOR = "#a78bfa";

/** What each region colour means, shown on the kind buttons. */
const KIND_HINTS: Record<RegionKind, string> = {
  text: "Text (blue): speech bubbles and captions. Read with OCR, translated, removed by Clean text, lettered with the translation",
  sfx: "Sound effect (orange): drawn sound effects. Not read or translated; removed by Clean SFX when ticked; lettered only if you type new lettering",
};

const WHEEL_HINTS: Record<WheelMode, string> = {
  zoom: "Wheel zooms, Shift+wheel scrolls",
  vertical: "Wheel scrolls up/down, Shift sideways",
  horizontal: "Wheel scrolls sideways, Shift up/down",
};

/** What the page editor can ask the canvas to do. */
export interface PageCanvasHandle {
  /** Deletes a region through the canvas history, so it can be undone. */
  deleteBlock: (id: number) => void;
}

interface PageCanvasProps {
  ref?: Ref<PageCanvasHandle>;
  pageId: string;
  /** Background image (a stage image of the page). */
  imageUrl: string;
  page: PageSize;
  blocks: StudioBlock[];
  disabled: boolean;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** Called with the page detail returned by each successful change. */
  onDetail: (detail: StudioPageDetail) => void;
  /** Re-fetch the page after a failed change, so the canvas matches the server again. */
  onReload: () => void;
  /** Extra controls at the start of the toolbar (e.g. the background image picker). */
  toolbarStart?: ReactNode;
  /** A cleaned page image was rewritten (e.g. re-cleaning an area): reload the stage images. */
  onImagesChanged: () => void;
  /** Lettering laid out by the shared typesetter, as the burn would place it. */
  lettering: LetteringItem[];
  /** In Regions mode the lettering shows only over a cleaned page (not over the original or the burned result). */
  textPreviewAvailable: boolean;
  /** Shows a style change right away, before the server has saved it. */
  onStylePreview: (id: number, style: TextStyle | null) => void;
  /** Lays one block out again in a new box, for live re-wrapping while it's resized. */
  relayout: (id: number, box: { x: number; y: number; w: number; h: number }) => LetteringPaths | null;
  onModeChange?: (mode: EditMode) => void;
  /** Floating editor shown next to the selected block in Lettering mode. */
  renderLetteringPanel?: (id: number) => ReactNode;
  /** The toolset the previous page was left with; read once, when the canvas opens. */
  initialToolset?: Toolset;
  /** Told whenever the toolset changes, so the next page can start from it. */
  onToolsetChange?: (patch: Toolset) => void;
}

interface Entry {
  obj: FabricObject;
  key: string;
  geometry: BlockGeometry;
}

interface PolygonDraft {
  points: { x: number; y: number }[];
  markers: Circle[];
  outline: Polyline | null;
  rubber: Line;
}

/** Actions the keyboard handler and toolbar call into the canvas closure. */
interface CanvasActions {
  finishPolygon: () => void;
  cancelDrawing: () => void;
  deleteSelected: () => void;
  fit: () => void;
  /** First view of the page at a remembered zoom. */
  openAt: (scale: number) => void;
  zoomBy: (factor: number) => void;
  /** Sets an exact zoom (1 = 100%), keeping the middle of the view where it is. */
  zoomTo: (value: number) => void;
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Fabric canvas for editing a page's regions: draw rectangles, ellipses and polygons, move / resize / delete them,
 * zoom and pan, undo and redo. The server is the source of truth: every change is sent right away and the canvas
 * redraws from the returned blocks.
 */
export function PageCanvas({
  pageId, imageUrl, page, blocks, disabled, selectedId, onSelect, onDetail, onReload, toolbarStart, onImagesChanged,
  lettering, textPreviewAvailable, onStylePreview, relayout, onModeChange, renderLetteringPanel, initialToolset, onToolsetChange, ref,
}: PageCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const entriesRef = useRef(new Map<number, Entry>());
  const actionsRef = useRef<CanvasActions | null>(null);
  const fittedRef = useRef(false);
  const spaceRef = useRef(false);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  // The toolset starts where the previous page of the workspace left it; read once, since the canvas owns it after
  const [startingToolset] = useState<Toolset>(() => initialToolset ?? {});
  const [tool, setTool] = useState<Tool>(startingToolset.tool ?? "select");
  const [kind, setKind] = useState<RegionKind>(startingToolset.kind ?? "text");
  const [brushLayer, setBrushLayer] = useState<MaskLayerName>(startingToolset.brushLayer ?? "add");
  const [brushSize, setBrushSize] = useState(startingToolset.brushSize ?? DEFAULT_BRUSH);
  const [showMask, setShowMask] = useState(startingToolset.showMask ?? false);
  /** Spots painted into the add layer that haven't been re-cleaned yet, in page pixels. */
  const [paintedAreas, setPaintedAreas] = useState<Area[]>([]);
  const [recleaning, setRecleaning] = useState(false);
  /** Bumped to load the mask layers from the server again (after a failed save). */
  const [layersNonce, setLayersNonce] = useState(0);
  const maskRef = useRef<MaskLayers | null>(null);
  const brushCursorRef = useRef<Circle | null>(null);
  const [mode, setMode] = useState<EditMode>(startingToolset.mode ?? "regions");
  const [showText, setShowText] = useState(startingToolset.showText ?? true);
  /** Floating lettering objects by block id. */
  const letteringRef = useRef(new Map<number, LetteringObject>());
  const panelHostRef = useRef<HTMLDivElement>(null);
  const [panelPosition, setPanelPosition] = useState<{ left: number; top: number } | null>(null);
  /** Where the user dragged the lettering panel; it stays there for every selection until it's set to follow again. */
  const [panelPin, setPanelPin] = useState<{ left: number; top: number } | null>(null);
  const panelDragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [wheelMode, setWheelModeState] = useState<WheelMode>(readWheelMode);
  const setWheelMode = (mode: WheelMode) => {
    setWheelModeState(mode);
    try {
      localStorage.setItem(WHEEL_MODE_KEY, mode);
    } catch {
      // Not persisted; the choice still applies for this visit
    }
  };
  const [zoom, setZoom] = useState(1);
  const [busyCount, setBusyCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const historyRef = useRef<CommandHistory | null>(null);
  historyRef.current ??= new CommandHistory(rerender);
  const history = historyRef.current;

  // Latest props for handlers registered once on the canvas
  const showTextLayer = mode === "lettering" || (showText && textPreviewAvailable);
  const live = useRef({
    pageId, page, blocks, disabled, tool, kind, wheelMode, brushLayer, brushSize, showMask, showTextLayer, mode, selectedId, lettering,
    onSelect, onDetail, onReload, onImagesChanged, onStylePreview, relayout, onModeChange, onToolsetChange,
  });
  live.current = {
    pageId, page, blocks, disabled, tool, kind, wheelMode, brushLayer, brushSize, showMask, showTextLayer, mode, selectedId, lettering,
    onSelect, onDetail, onReload, onImagesChanged, onStylePreview, relayout, onModeChange, onToolsetChange,
  };

  // Every toolset change is handed on, so the workspace's next page opens with it
  useEffect(() => {
    live.current.onToolsetChange?.({ tool, kind, brushLayer, brushSize, showMask, mode, showText });
  }, [tool, kind, brushLayer, brushSize, showMask, mode, showText]);

  /** Runs server changes one after another; a failure shows the error, drops the history and reloads the page. */
  const enqueue = useCallback((task: () => Promise<void>) => {
    setBusyCount((n) => n + 1);
    queueRef.current = queueRef.current
      .then(async () => {
        await task();
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        history.clear();
        for (const entry of entriesRef.current.values()) entry.key = "";
        // The reload brings back the server's styles: pending canvas baselines no longer apply
        styleBaselineRef.current.clear();
        live.current.onReload();
        // A failed layer save leaves the overlay ahead of the server: show what the server has
        setLayersNonce((n) => n + 1);
      })
      .finally(() => setBusyCount((n) => n - 1));
  }, [history]);

  /** Applies a change now and records it for undo. */
  const perform = useCallback((command: Command) => {
    enqueue(async () => {
      await command.redo();
      history.push(command);
    });
  }, [enqueue, history]);

  /** Puts the keyboard in the floating panel's lettering text field. */
  const focusLetteringText = () => {
    requestAnimationFrame(() => panelHostRef.current?.querySelector<HTMLTextAreaElement>("[data-lettering-text]")?.focus());
  };

  /** Highest block id in a detail: a newly created block always gets the next index. */
  const newestId = (detail: StudioPageDetail): number => Math.max(...detail.blocks.map((b) => b.id));

  const createRegion = useCallback((regionKind: RegionKind, geometry: BlockGeometry) => {
    let current: number | null = null;
    perform({
      label: "Add region",
      redo: async () => {
        const detail = await createBlock(live.current.pageId, regionKind, geometry);
        const id = newestId(detail);
        if (current !== null) history.alias(current, id);
        current = id;
        live.current.onDetail(detail);
        live.current.onSelect(id);
      },
      undo: async () => {
        if (current === null) return;
        live.current.onDetail(await deleteBlock(live.current.pageId, history.resolve(current)));
        live.current.onSelect(null);
      },
    });
  }, [history, perform]);

  const reshapeRegion = useCallback((id: number, before: BlockGeometry, after: BlockGeometry) => {
    const apply = (geometry: BlockGeometry) => async () => {
      live.current.onDetail(await updateBlockGeometry(live.current.pageId, history.resolve(id), geometry));
    };
    perform({ label: "Move or resize region", redo: apply(after), undo: apply(before) });
  }, [history, perform]);

  const deleteRegion = useCallback((id: number) => {
    const block = live.current.blocks.find((b) => b.id === id);
    if (!block) return;
    const snapshot = {
      kind: blockKind(block),
      // The canvas geometry is ahead of `blocks` while an edit is still being saved: undo must restore that shape
      geometry: entriesRef.current.get(id)?.geometry ?? blockGeometry(block),
      content: {
        include: block.include,
        source_text: block.source_text,
        translated_text: block.translated_text,
        // Its lettering style (font, colours, rotation, offset, text box) comes back too, including a canvas change
        // that hasn't reached `blocks` yet
        style: currentStyle(id),
      },
    };
    // The deletion belongs to this page: queued work must not delete or recreate a block on a page opened meanwhile
    const pageId = live.current.pageId;
    let current = id;
    perform({
      label: "Delete region",
      redo: async () => {
        const detail = await deleteBlock(pageId, history.resolve(current));
        if (live.current.pageId !== pageId) return;
        live.current.onDetail(detail);
        live.current.onSelect(null);
      },
      undo: async () => {
        // One request brings back geometry, include flag, text and style together, so a failure can't leave a blank region
        const detail = await createBlock(pageId, snapshot.kind, snapshot.geometry, snapshot.content);
        const restored = newestId(detail);
        history.alias(history.resolve(current), restored);
        current = restored;
        if (live.current.pageId !== pageId) return;
        live.current.onDetail(detail);
        live.current.onSelect(restored);
      },
    });
  }, [history, perform]);

  useImperativeHandle(ref, () => ({
    deleteBlock: (id: number) => {
      if (live.current.disabled) return;
      deleteRegion(id);
    },
  }), [deleteRegion]);

  /**
   * Saves the painted layers a stroke changed, to the page and layers it was painted on (the user may have moved to
   * another page while an earlier save was in flight); the server marks the clean stages stale.
   */
  const saveLayers = useCallback(async (pageId: string, mask: MaskLayers, touched: Record<MaskLayerName, boolean>) => {
    for (const name of ["add", "erase"] as const) {
      if (!touched[name]) continue;
      const detail = await saveMaskLayer(pageId, name, mask.exportLayer(name));
      // A late answer for a page the editor has left must not replace the current page's detail
      if (live.current.pageId === pageId) live.current.onDetail(detail);
    }
  }, []);

  const paintStroke = useCallback((record: StrokeRecord) => {
    const pageId = live.current.pageId;
    const mask = maskRef.current;
    if (!mask) return;
    // The stroke is already on the layer when it's recorded: only a later redo paints it again
    let firstRun = true;
    const show = (state: "before" | "after") => {
      mask.apply(record, state);
      if (maskRef.current === mask) canvasRef.current?.requestRenderAll();
    };
    /** Queues the stroke's area for Re-clean: only when the change can add pixels to the effective mask. */
    const markForReclean = () => {
      if (live.current.pageId === pageId) setPaintedAreas((areas) => [...areas, record.area]);
    };
    perform({
      label: record.layer === "add" ? "Paint mask" : "Erase mask",
      redo: async () => {
        const replay = !firstRun;
        if (replay) show("after");
        firstRun = false;
        await saveLayers(pageId, mask, record.touched);
        // The first run is queued below, right away; a redone add paints the text back in
        if (replay && record.layer === "add") markForReclean();
      },
      undo: async () => {
        show("before");
        await saveLayers(pageId, mask, record.touched);
        // Undoing an erase brings detected pixels back into the mask
        if (record.layer === "erase") markForReclean();
      },
    });
    if (record.layer === "add") markForReclean();
  }, [perform, saveLayers]);

  /** Moves, resizes or rotates a block's text box: previewed at once, saved as an undoable style change. */
  /**
   * The latest style each block was given on the canvas, kept until that change's own save lands: a second quick move
   * must record the first move's result as its "before", even if a page refresh brings back the older style meanwhile
   * (the editor is remounted per page, so entries never outlive their page).
   */
  const styleBaselineRef = useRef(new Map<number, TextStyle | null>());

  /** The block's current lettering style, including canvas changes not rendered into `blocks` yet. */
  const currentStyle = useCallback((id: number): TextStyle | null => {
    const baseline = styleBaselineRef.current;
    if (baseline.has(id)) return baseline.get(id) ?? null;
    return (live.current.blocks.find((b) => b.id === id)?.style ?? null) as TextStyle | null;
  }, []);

  /** Moves, resizes or rotates a block's text box: previewed at once, saved as an undoable style change. */
  const restyle = useCallback((id: number, before: TextStyle | null, after: TextStyle | null) => {
    // The change belongs to this page: a queued save must not write to, or update, a page opened meanwhile
    const pageId = live.current.pageId;
    styleBaselineRef.current.set(id, after);
    live.current.onStylePreview(id, after);
    const apply = (style: TextStyle | null) => async () => {
      const target = history.resolve(id);
      if (live.current.pageId === pageId) live.current.onStylePreview(target, style);
      const detail = await updateBlock(pageId, target, { style });
      // Saved: the server now has this style, so the block's own value is current again
      if (styleBaselineRef.current.get(id) === style) styleBaselineRef.current.delete(id);
      if (live.current.pageId === pageId) live.current.onDetail(detail);
    };
    perform({ label: "Move, resize or rotate text", redo: apply(after), undo: apply(before) });
  }, [history, perform]);

  // Canvas lifecycle: created by hand inside the host so React never reconciles Fabric's DOM; StrictMode-safe
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const element = document.createElement("canvas");
    host.appendChild(element);
    const canvas = new Canvas(element, {
      width: host.clientWidth,
      height: host.clientHeight,
      selection: false,
      preserveObjectStacking: true,
      uniformScaling: false,
      fireMiddleClick: true,
      stopContextMenu: true,
      backgroundColor: "#030712",
    });
    canvasRef.current = canvas;

    const resize = new ResizeObserver(() => {
      canvas.setDimensions({ width: host.clientWidth, height: host.clientHeight });
      canvas.requestRenderAll();
    });
    resize.observe(host);

    const setZoomTo = (value: number, at: Point) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
      canvas.zoomToPoint(at, next);
      setZoom(next);
      live.current.onToolsetChange?.({ zoom: next });
      canvas.requestRenderAll();
    };

    const fit = () => {
      const { width, height } = live.current.page;
      if (!width || !height) return;
      const cw = canvas.getWidth();
      const ch = canvas.getHeight();
      const scale = Math.min(cw / width, ch / height) * 0.96;
      canvas.setViewportTransform([scale, 0, 0, scale, (cw - width * scale) / 2, (ch - height * scale) / 2]);
      setZoom(scale);
      live.current.onToolsetChange?.({ zoom: null });
      canvas.requestRenderAll();
    };

    /**
     * Opens a page at a remembered zoom rather than fitted: centred across, and from the top when it's taller than
     * the view, which is where a tall page is read from.
     */
    const openAt = (scale: number) => {
      const { width, height } = live.current.page;
      if (!width || !height) return fit();
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
      const cw = canvas.getWidth();
      const ch = canvas.getHeight();
      const top = height * next > ch ? 16 : (ch - height * next) / 2;
      canvas.setViewportTransform([next, 0, 0, next, (cw - width * next) / 2, top]);
      setZoom(next);
      canvas.requestRenderAll();
    };

    // ── Drawing state ─────────────────────────────────────────────────────────
    let draft: { obj: Rect | Ellipse; start: { x: number; y: number } } | null = null;
    let polygon: PolygonDraft | null = null;
    let panning: { x: number; y: number } | null = null;
    let painting = false;

    // Outline of the mask brush under the pointer, sized in page pixels
    const brushCursor = new Circle({
      originX: "center",
      originY: "center",
      radius: 1,
      fill: "transparent",
      stroke: "#f9fafb",
      strokeWidth: 1,
      strokeUniform: true,
      selectable: false,
      evented: false,
      visible: false,
      objectCaching: false,
    });
    canvas.add(brushCursor);
    brushCursorRef.current = brushCursor;

    const finishStroke = () => {
      if (!painting) return;
      painting = false;
      const record = maskRef.current?.endStroke();
      if (record) paintStroke(record);
    };

    const cancelDrawing = () => {
      finishStroke();
      if (draft) canvas.remove(draft.obj);
      draft = null;
      if (polygon) {
        canvas.remove(...polygon.markers, polygon.rubber);
        if (polygon.outline) canvas.remove(polygon.outline);
      }
      polygon = null;
      canvas.requestRenderAll();
    };

    const finishPolygon = () => {
      if (!polygon) return;
      const points = polygon.points;
      cancelDrawing();
      if (points.length < 3) return;
      const geometry = polygonGeometry(points, live.current.page);
      if (geometry.w >= MIN_REGION && geometry.h >= MIN_REGION) createRegion(live.current.kind, geometry);
    };

    const addPolygonPoint = (scene: { x: number; y: number }) => {
      const p = pagePoint(scene, live.current.page);
      const scale = canvas.getZoom();
      const style = draftOptions(live.current.kind);
      if (!polygon) {
        polygon = { points: [], markers: [], outline: null, rubber: new Line([p.x, p.y, p.x, p.y], { ...style, fill: undefined }) };
        canvas.add(polygon.rubber);
      }
      const first = polygon.points[0];
      // Clicking the first point closes the shape (10 screen pixels of tolerance at any zoom)
      if (first && polygon.points.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) <= 10 / scale) {
        finishPolygon();
        return;
      }
      const last = polygon.points.at(-1);
      // A double-click sends two presses at the same spot: don't add the point twice
      if (last && Math.hypot(p.x - last.x, p.y - last.y) <= 2 / scale) return;
      polygon.points.push(p);
      const marker = new Circle({
        left: p.x,
        top: p.y,
        radius: 4 / scale,
        originX: "center",
        originY: "center",
        fill: REGION_COLORS[live.current.kind].stroke,
        selectable: false,
        evented: false,
      });
      polygon.markers.push(marker);
      if (polygon.outline) canvas.remove(polygon.outline);
      polygon.outline = new Polyline(polygon.points.map((q) => ({ x: q.x, y: q.y })), { ...style, fill: "transparent" });
      canvas.add(polygon.outline, marker);
      polygon.rubber.set({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      canvas.requestRenderAll();
    };

    const deleteSelected = () => {
      const active = canvas.getActiveObject();
      // Lettering stands for its region: deleting it removes the region (undoable)
      const id = blockIdOf(active) ?? letteringIdOf(active) ?? (live.current.mode === "lettering" ? live.current.selectedId ?? undefined : undefined);
      if (id !== undefined && !live.current.disabled) deleteRegion(id);
    };

    actionsRef.current = {
      finishPolygon,
      cancelDrawing,
      deleteSelected,
      fit,
      openAt,
      zoomBy: (factor) => setZoomTo(canvas.getZoom() * factor, new Point(canvas.getWidth() / 2, canvas.getHeight() / 2)),
      zoomTo: (value) => setZoomTo(value, new Point(canvas.getWidth() / 2, canvas.getHeight() / 2)),
    };

    // ── Pointer handling ──────────────────────────────────────────────────────
    canvas.on("mouse:wheel", (opt) => {
      const e = opt.e;
      e.preventDefault();
      e.stopPropagation();
      const mode = live.current.wheelMode;
      // Wheels report pixels, lines (Firefox) or pages: normalise to pixels, and cap one event so a flick can't jump levels
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.getHeight() : 1;
      const deltaX = Math.max(-WHEEL_MAX_DELTA, Math.min(WHEEL_MAX_DELTA, e.deltaX * unit));
      const deltaY = Math.max(-WHEEL_MAX_DELTA, Math.min(WHEEL_MAX_DELTA, e.deltaY * unit));
      // Exponential steps: a 100px wheel notch zooms 10%, trackpad pinches (small deltas) stay fine-grained
      const zoom = () => setZoomTo(canvas.getZoom() * Math.exp(-deltaY * WHEEL_ZOOM_RATE), new Point(e.offsetX, e.offsetY));
      const pan = (dx: number, dy: number) => {
        canvas.relativePan(new Point(-dx, -dy));
        canvas.requestRenderAll();
      };
      // Ctrl/Cmd + wheel always zooms (a trackpad pinch arrives as ctrl + wheel too)
      if (e.ctrlKey || e.metaKey) {
        zoom();
        return;
      }
      // Some browsers turn Shift + wheel into horizontal deltas, so take whichever axis moved
      const amount = deltaY !== 0 ? deltaY : deltaX;
      if (mode === "zoom") {
        if (e.shiftKey) pan(0, amount);
        else zoom();
        return;
      }
      // Trackpads send both axes at once: a two-finger swipe moves freely in either scroll mode
      if (!e.shiftKey && deltaX !== 0 && deltaY !== 0) {
        pan(deltaX, deltaY);
        return;
      }
      // Shift switches direction: vertical mode scrolls sideways, horizontal mode scrolls up/down
      const sideways = (mode === "horizontal") !== e.shiftKey;
      if (sideways) pan(amount, 0);
      else pan(0, amount);
    });

    canvas.on("mouse:down", (opt) => {
      const e = opt.e as MouseEvent;
      // A focused form control (e.g. the stage picker) would swallow Delete / Backspace and the tool keys
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && isTyping(focused)) focused.blur();
      // Lettering mode: pressing a region that has no lettering yet selects it (so its lettering can be typed)
      if (live.current.mode === "lettering" && !opt.target && !spaceRef.current && e.button !== 1) {
        const p = opt.scenePoint;
        const hit = live.current.blocks
          .filter((b) => (b.kind === "text" || b.kind === "sfx") && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)
          .sort((a, b) => a.w * a.h - b.w * b.h)[0];
        live.current.onSelect(hit ? hit.id : null);
      }
      // Pan: space-drag or middle-drag with any tool, or dragging empty space with the select tool or in Lettering mode
      const panTool = live.current.mode === "lettering" || live.current.tool === "select";
      if (spaceRef.current || e.button === 1 || (panTool && !opt.target)) {
        panning = { x: e.clientX, y: e.clientY };
        canvas.setCursor("grabbing");
        return;
      }
      if (live.current.mode === "lettering") return;
      if (live.current.tool === "brush") {
        const mask = maskRef.current;
        if (live.current.disabled || !mask || e.button === 2) return;
        painting = true;
        mask.setVisible(true);
        mask.beginStroke(live.current.brushLayer, pagePoint(opt.scenePoint, live.current.page), live.current.brushSize);
        canvas.requestRenderAll();
        return;
      }
      const current = live.current;
      if (current.disabled || current.tool === "select") return;
      if (current.tool === "polygon") {
        // Pressing an existing region doesn't start a polygon; once one is being drawn, points may land on
        // top of other regions (outlining a bubble that already has a detected box inside it)
        if (opt.target && !polygon) return;
        addPolygonPoint(opt.scenePoint);
        return;
      }
      // Pressing on an existing region selects or moves it instead of drawing on top
      if (opt.target) return;
      const start = pagePoint(opt.scenePoint, current.page);
      const style = draftOptions(current.kind);
      const obj = current.tool === "rect"
        ? new Rect({ ...style, left: start.x, top: start.y, width: 1, height: 1 })
        : new Ellipse({ ...style, left: start.x, top: start.y, rx: 0.5, ry: 0.5 });
      canvas.add(obj);
      draft = { obj, start };
    });

    canvas.on("mouse:move", (opt) => {
      const e = opt.e as MouseEvent;
      if (panning) {
        canvas.relativePan(new Point(e.clientX - panning.x, e.clientY - panning.y));
        panning = { x: e.clientX, y: e.clientY };
        canvas.requestRenderAll();
        return;
      }
      const p = pagePoint(opt.scenePoint, live.current.page);
      if (live.current.mode === "regions" && live.current.tool === "brush") {
        brushCursor.set({ left: p.x, top: p.y, radius: live.current.brushSize / 2, visible: true });
        canvas.bringObjectToFront(brushCursor);
        if (painting) maskRef.current?.strokeTo(p);
        canvas.requestRenderAll();
        return;
      }
      if (draft) {
        const x = Math.min(p.x, draft.start.x);
        const y = Math.min(p.y, draft.start.y);
        const w = Math.max(1, Math.abs(p.x - draft.start.x));
        const h = Math.max(1, Math.abs(p.y - draft.start.y));
        if (draft.obj instanceof Rect) draft.obj.set({ left: x, top: y, width: w, height: h });
        else draft.obj.set({ left: x, top: y, rx: w / 2, ry: h / 2 });
        canvas.requestRenderAll();
      } else if (polygon) {
        polygon.rubber.set({ x2: p.x, y2: p.y });
        canvas.requestRenderAll();
      }
    });

    canvas.on("mouse:up", () => {
      if (panning) {
        panning = null;
        canvas.setCursor(spaceRef.current ? "grab" : "default");
        return;
      }
      if (painting) {
        finishStroke();
        return;
      }
      if (!draft) return;
      const { obj } = draft;
      draft = null;
      const geometry = geometryOf(obj, live.current.page);
      canvas.remove(obj);
      canvas.requestRenderAll();
      if (geometry.w >= MIN_REGION && geometry.h >= MIN_REGION) createRegion(live.current.kind, geometry);
    });

    canvas.on("mouse:dblclick", () => {
      if (live.current.mode === "lettering") {
        focusLetteringText();
        return;
      }
      if (live.current.tool === "polygon") finishPolygon();
    });

    // Live re-wrap while a lettering box is resized (once per frame)
    let relayoutFrame = 0;
    canvas.on("object:scaling", (e) => {
      const target = e.target;
      const id = letteringIdOf(target);
      if (id === undefined || !(target instanceof LetteringObject)) return;
      cancelAnimationFrame(relayoutFrame);
      relayoutFrame = requestAnimationFrame(() => {
        const w = Math.max(4, Math.round(target.width * target.scaleX));
        const h = Math.max(4, Math.round(target.height * target.scaleY));
        const center = target.getCenterPoint();
        target.setPaths(live.current.relayout(id, { x: Math.round(center.x - w / 2), y: Math.round(center.y - h / 2), w, h }));
        canvas.requestRenderAll();
      });
    });

    // The floating panel follows its lettering through pans, zooms and moves
    canvas.on("after:render", () => updatePanelRef.current());

    canvas.on("mouse:out", () => {
      brushCursor.set({ visible: false });
      canvas.requestRenderAll();
    });

    // ── Selection and edits ───────────────────────────────────────────────────
    const selectFrom = (selected: FabricObject[] | undefined) => {
      const id = blockIdOf(selected?.[0]) ?? letteringIdOf(selected?.[0]);
      if (id !== undefined) live.current.onSelect(id);
    };
    canvas.on("selection:created", (e) => selectFrom(e.selected));
    canvas.on("selection:updated", (e) => selectFrom(e.selected));
    canvas.on("selection:cleared", (e) => {
      // Only a user deselect clears the panel's selection (programmatic discards pass no event)
      if (e.e) live.current.onSelect(null);
    });

    canvas.on("object:modified", (e) => {
      const letteringId = letteringIdOf(e.target);
      if (letteringId !== undefined && e.target instanceof LetteringObject) {
        const obj = e.target;
        const item = live.current.lettering.find((i) => i.id === letteringId);
        const block = live.current.blocks.find((b) => b.id === letteringId);
        if (!item || !block) return;
        const { width: pw, height: ph } = live.current.page;
        const w = Math.max(4, Math.min(pw, Math.round(obj.width * obj.scaleX)));
        const h = Math.max(4, Math.min(ph, Math.round(obj.height * obj.scaleY)));
        const center = obj.getCenterPoint();
        // The stored box is the unrotated rectangle around the rotation centre, kept inside the page
        const x = Math.min(Math.max(0, Math.round(center.x - w / 2)), pw - w);
        const y = Math.min(Math.max(0, Math.round(center.y - h / 2)), ph - h);
        const rotation = Math.round((((((obj.angle ?? 0) + 180) % 360) + 360) % 360 - 180) * 10) / 10;
        const before = currentStyle(letteringId);
        const after: TextStyle = { ...(before ?? {}) };
        const resized = w !== item.box.w || h !== item.box.h;
        if (resized || item.hasExplicitBox) {
          // A resized (or already free) box: the text wraps in this rectangle
          after.box = { x, y, w, h };
          delete after.offset;
        } else {
          // A plain move keeps the bubble-shaped wrapping: stored as an offset from the found area
          const dx = x - item.baseBox.x, dy = y - item.baseBox.y;
          if (dx || dy) after.offset = { x: dx, y: dy };
          else delete after.offset;
        }
        if (rotation) after.rotation = rotation;
        else delete after.rotation;
        obj.set({ width: w, height: h, scaleX: 1, scaleY: 1 });
        obj.setPositionByOrigin(new Point(x + w / 2, y + h / 2), "center", "center");
        obj.setCoords();
        restyle(letteringId, before, Object.keys(after).length > 0 ? after : null);
        return;
      }
      const id = blockIdOf(e.target);
      if (id === undefined) return;
      const entry = entriesRef.current.get(id);
      const after = geometryOf(e.target, live.current.page);
      if (!entry) return;
      const block = live.current.blocks.find((b) => b.id === id);
      const kindOfBlock = block ? blockKind(block) : "text";
      const before = entry.geometry;
      if (geometryKey(before, kindOfBlock) === geometryKey(after, kindOfBlock)) return;
      // Advance the baseline now: a second edit before the server answers must record this edit as its "before",
      // and the matching key keeps the response from redrawing the object (a failure resets keys and reloads)
      entry.geometry = after;
      entry.key = regionKey(after, kindOfBlock, block?.include ?? true);
      reshapeRegion(id, before, after);
    });

    return () => {
      resize.disconnect();
      // A live re-wrap queued during a resize must not run against the disposed canvas
      cancelAnimationFrame(relayoutFrame);
      actionsRef.current = null;
      canvasRef.current = null;
      brushCursorRef.current = null;
      letteringRef.current.clear();
      entriesRef.current.clear();
      fittedRef.current = false;
      void canvas.dispose();
      host.replaceChildren();
    };
  }, [createRegion, deleteRegion, reshapeRegion, paintStroke, restyle]);

  // Background image: the chosen stage image at page scale; fit the page into view once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    FabricImage.fromURL(imageUrl)
      .then((img) => {
        if (cancelled || canvasRef.current !== canvas) return;
        img.set({ originX: "left", originY: "top", left: 0, top: 0, selectable: false, evented: false });
        canvas.backgroundImage = img;
        if (!fittedRef.current) {
          const saved = startingToolset.zoom;
          if (typeof saved === "number") actionsRef.current?.openAt(saved);
          else actionsRef.current?.fit();
          fittedRef.current = true;
        }
        canvas.requestRenderAll();
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the page image");
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrl, createRegion, deleteRegion, reshapeRegion, paintStroke]);

  // Mask overlay: the detector's mask and the painted layers, loaded per page and again after a failed save
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !page.width || !page.height) return;
    const controller = new AbortController();
    const mask = new MaskLayers(pageId, { width: page.width, height: page.height });
    mask.load(controller.signal)
      .then(() => {
        if (controller.signal.aborted || canvasRef.current !== canvas) return;
        mask.attach(canvas);
        mask.setVisible(live.current.mode === "regions" && (live.current.showMask || live.current.tool === "brush"));
        maskRef.current = mask;
        canvas.requestRenderAll();
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(`Could not load the text mask: ${err instanceof Error ? err.message : String(err)}`);
      });
    return () => {
      controller.abort();
      if (maskRef.current === mask) {
        mask.detach(canvas);
        maskRef.current = null;
      }
    };
  }, [pageId, page.width, page.height, layersNonce, createRegion, deleteRegion, reshapeRegion, paintStroke]);

  // Lettering layer: one floating object per lettered block, interactive in Lettering mode
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const objects = letteringRef.current;
    const interactive = mode === "lettering" && !disabled;
    const seen = new Set<number>();
    for (const item of lettering) {
      seen.add(item.id);
      let obj = objects.get(item.id);
      if (!obj) {
        obj = new LetteringObject(item.id, {
          originX: "center",
          originY: "center",
          objectCaching: false,
          lockScalingFlip: true,
          transparentCorners: false,
          cornerColor: LETTERING_COLOR,
          cornerSize: 9,
          borderColor: LETTERING_COLOR,
          borderDashArray: [6, 4],
        });
        objects.set(item.id, obj);
        canvas.add(obj);
      }
      obj.set({
        left: item.box.x + item.box.w / 2,
        top: item.box.y + item.box.h / 2,
        width: item.box.w,
        height: item.box.h,
        scaleX: 1,
        scaleY: 1,
        angle: item.rotation,
        selectable: interactive,
        evented: interactive,
        hoverCursor: interactive ? "move" : "default",
        visible: showTextLayer,
        // Not placed yet: previewed in the region box until the server finds the bubble area
        opacity: item.placed ? 1 : 0.6,
      });
      obj.showFrame = mode === "lettering";
      obj.overflow = !item.fits;
      obj.setPaths(item.paths);
      obj.setCoords();
      // Lettering sits above the regions while it's being edited, below them otherwise
      if (mode === "lettering") canvas.bringObjectToFront(obj);
      else canvas.sendObjectToBack(obj);
    }
    for (const [id, obj] of objects) {
      if (seen.has(id)) continue;
      if (canvas.getActiveObject() === obj) canvas.discardActiveObject();
      canvas.remove(obj);
      objects.delete(id);
    }

    const active = canvas.getActiveObject();
    if (mode === "lettering") {
      const target = selectedId !== null ? objects.get(selectedId) : undefined;
      if (target && active !== target && !disabled) canvas.setActiveObject(target);
      else if (!target && active) canvas.discardActiveObject();
    } else if (letteringIdOf(active) !== undefined) {
      canvas.discardActiveObject();
    }
    canvas.requestRenderAll();
    updatePanelRef.current();
  }, [lettering, mode, showTextLayer, disabled, selectedId, createRegion, deleteRegion, reshapeRegion, paintStroke, restyle]);

  // The overlay shows while painting, or when asked for, and only in Regions mode
  useEffect(() => {
    maskRef.current?.setVisible(mode === "regions" && (showMask || tool === "brush"));
    canvasRef.current?.requestRenderAll();
  }, [showMask, tool, mode]);

  // Regions: redraw only blocks whose geometry changed; keep the selection in sync with the panel
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const entries = entriesRef.current;
    const seen = new Set<number>();
    for (const block of blocks) {
      seen.add(block.id);
      const geometry = blockGeometry(block);
      const key = regionKey(geometry, blockKind(block), block.include);
      const existing = entries.get(block.id);
      if (existing && existing.key === key) continue;
      if (existing) canvas.remove(existing.obj);
      const obj = regionObject(block);
      canvas.add(obj);
      entries.set(block.id, { obj, key, geometry });
    }
    for (const [id, entry] of entries) {
      if (seen.has(id)) continue;
      canvas.remove(entry.obj);
      entries.delete(id);
    }
    const regionsInteractive = !disabled && mode === "regions";
    for (const { obj } of entries.values()) {
      obj.set({ selectable: regionsInteractive, evented: regionsInteractive, opacity: mode === "lettering" ? 0.35 : 1 });
    }

    if (mode === "regions") {
      const target = selectedId !== null ? entries.get(selectedId)?.obj : undefined;
      const active = canvas.getActiveObject();
      if (target && active !== target) canvas.setActiveObject(target);
      else if (!target && active) canvas.discardActiveObject();
    }
    // A region added or redrawn above the lettering must not cover it while the lettering is being edited
    if (mode === "lettering") for (const obj of letteringRef.current.values()) canvas.bringObjectToFront(obj);
    canvas.requestRenderAll();
  }, [blocks, disabled, selectedId, mode, createRegion, deleteRegion, reshapeRegion, paintStroke, restyle]);

  // Switching tools abandons a half-drawn region; the brush paints over regions instead of picking them
  useEffect(() => {
    actionsRef.current?.cancelDrawing();
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Drawing tools only draw in Regions mode; Lettering mode points and drags
    canvas.defaultCursor = mode === "regions" && tool !== "select" ? "crosshair" : "default";
    canvas.skipTargetFind = mode === "regions" && tool === "brush";
    if (tool !== "brush" || mode !== "regions") {
      brushCursorRef.current?.set({ visible: false });
      canvas.requestRenderAll();
    }
  }, [tool, mode]);

  // Switching modes tells the editor (Lettering switches the background to the cleaned page)
  useEffect(() => {
    live.current.onModeChange?.(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // A different page starts a fresh history and has nothing painted yet
  useEffect(() => {
    history.clear();
    setPaintedAreas([]);
  }, [pageId, history]);

  // Keyboard: tools, undo / redo, delete, polygon finish / cancel, fit, space to pan
  useEffect(() => {
    const undo = () => enqueue(() => history.undo());
    const redo = () => enqueue(() => history.redo());
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const canvas = canvasRef.current;
      if (e.code === "Space") {
        e.preventDefault();
        if (!spaceRef.current && canvas) {
          spaceRef.current = true;
          canvas.skipTargetFind = true;
          canvas.setCursor("grab");
        }
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod || e.altKey) return;
      // Region tool keys switch back to Regions mode
      const pickTool = (next: Tool) => {
        setMode("regions");
        setTool(next);
      };
      if (key === "v") pickTool("select");
      else if (key === "r") pickTool("rect");
      else if (key === "e") pickTool("ellipse");
      else if (key === "p") pickTool("polygon");
      else if (key === "b") pickTool("brush");
      else if (key === "l") setMode((current) => (current === "lettering" ? "regions" : "lettering"));
      else if (key === "enter" && live.current.mode === "lettering" && live.current.selectedId !== null) {
        e.preventDefault();
        focusLetteringText();
      }
      else if (key === "x") setBrushLayer((layer) => (layer === "add" ? "erase" : "add"));
      else if (key === "[") setBrushSize((size) => Math.max(MIN_BRUSH, Math.round(size / 1.25)));
      else if (key === "]") setBrushSize((size) => Math.min(MAX_BRUSH, Math.round(size * 1.25)));
      else if (key === "m") setShowMask((shown) => !shown);
      else if (key === "enter") actionsRef.current?.finishPolygon();
      else if (key === "escape") {
        actionsRef.current?.cancelDrawing();
        live.current.onSelect(null);
      } else if (key === "delete" || key === "backspace") {
        e.preventDefault();
        actionsRef.current?.deleteSelected();
      } else if (key === "f" || key === "0") actionsRef.current?.fit();
      else if (key === "+" || key === "=") actionsRef.current?.zoomBy(1.2);
      else if (key === "-") actionsRef.current?.zoomBy(1 / 1.2);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !spaceRef.current) return;
      spaceRef.current = false;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.skipTargetFind = live.current.mode === "regions" && live.current.tool === "brush";
        canvas.setCursor(live.current.mode === "regions" && live.current.tool !== "select" ? "crosshair" : "default");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [enqueue, history]);

  /** Keeps the floating lettering panel next to the selected block, above or below it depending on the room. */
  const updatePanelRef = useRef<() => void>(() => {});
  updatePanelRef.current = () => {
    const canvas = canvasRef.current;
    const host = panelHostRef.current;
    // A pinned panel is re-clamped when the canvas area shrinks (window or side panel resize), so it stays reachable
    if (host) {
      setPanelPin((pin) => {
        if (!pin) return pin;
        const left = Math.min(pin.left, Math.max(0, host.clientWidth - PANEL_WIDTH));
        const top = Math.min(pin.top, Math.max(0, host.clientHeight - PANEL_OUTER_HEIGHT));
        return left === pin.left && top === pin.top ? pin : { left, top };
      });
    }
    const block = selectedId !== null ? blocks.find((b) => b.id === selectedId) : undefined;
    if (!canvas || !host || mode !== "lettering" || !block || !renderLetteringPanel || (block.kind !== "text" && block.kind !== "sfx")) {
      setPanelPosition((current) => (current === null ? current : null));
      return;
    }
    const obj = letteringRef.current.get(block.id);
    const corners = obj
      ? obj.getCoords()
      : [new Point(block.x, block.y), new Point(block.x + block.w, block.y + block.h)];
    const screen = corners.map((p) => util.transformPoint(p, canvas.viewportTransform));
    const xs = screen.map((p) => p.x), ys = screen.map((p) => p.y);
    const panelWidth = PANEL_WIDTH, panelHeight = PANEL_OUTER_HEIGHT, gap = 12;
    const left = Math.min(Math.max(8, (Math.min(...xs) + Math.max(...xs)) / 2 - panelWidth / 2), Math.max(8, host.clientWidth - panelWidth - 8));
    const below = Math.max(...ys) + gap;
    const top = below + panelHeight <= host.clientHeight ? below : Math.max(8, Math.min(...ys) - gap - panelHeight);
    setPanelPosition((current) =>
      current && Math.abs(current.left - left) < 1 && Math.abs(current.top - top) < 1 ? current : { left: Math.round(left), top: Math.round(top) });
  };

  /** Dragging the lettering panel by its grab bar, kept inside the canvas area. */
  const panelSpot = panelPin ?? panelPosition;
  const startPanelDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!panelSpot || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panelDragRef.current = { x: e.clientX, y: e.clientY, left: panelSpot.left, top: panelSpot.top };
  };
  const movePanel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panelDragRef.current;
    const host = panelHostRef.current;
    if (!drag || !host) return;
    // Kept fully inside the canvas area (it clips), so the panel's bottom controls stay reachable
    const left = Math.min(Math.max(0, drag.left + e.clientX - drag.x), Math.max(0, host.clientWidth - PANEL_WIDTH));
    const top = Math.min(Math.max(0, drag.top + e.clientY - drag.y), Math.max(0, host.clientHeight - PANEL_OUTER_HEIGHT));
    setPanelPin({ left: Math.round(left), top: Math.round(top) });
  };
  const endPanelDrag = () => {
    panelDragRef.current = null;
  };

  // Re-clean targets: the painted spots when there are any, otherwise the selected region's box
  const selectedBlock = selectedId !== null ? blocks.find((b) => b.id === selectedId) : undefined;
  const recleanTargets: Area[] = paintedAreas.length > 0
    ? mergeAreas(paintedAreas)
    : selectedBlock ? [{ x: selectedBlock.x, y: selectedBlock.y, w: selectedBlock.w, h: selectedBlock.h }] : [];
  const recleanTitle = paintedAreas.length > 0
    ? "Clean the painted spots again on the cleaned page"
    : selectedBlock ? "Clean the selected region again on the cleaned page"
    : "Paint missed text with the brush, or select a region, to clean just that area again";

  /** Runs after pending saves (so the painted layers are on the server); a failure only shows the error. */
  const reclean = () => {
    const used = paintedAreas;
    const areas = recleanTargets;
    // The areas belong to this page: the queued run must not re-clean, or update, a page opened meanwhile
    const targetPageId = pageId;
    if (areas.length === 0) return;
    setBusyCount((n) => n + 1);
    setRecleaning(true);
    queueRef.current = queueRef.current
      .then(async () => {
        try {
          const detail = await recleanAreas(targetPageId, areas);
          if (live.current.pageId !== targetPageId) return;
          live.current.onDetail(detail);
          live.current.onImagesChanged();
          setPaintedAreas((current) => current.filter((area) => !used.includes(area)));
          setError(null);
        } catch (err) {
          if (live.current.pageId === targetPageId) setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        setRecleaning(false);
        setBusyCount((n) => n - 1);
      });
  };

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
    <section className="flex-1 min-w-0 min-h-0 flex flex-col">
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
      <div ref={panelHostRef} className="relative flex-1 min-h-0 overflow-hidden">
        <div ref={hostRef} className="absolute inset-0" />
        {mode === "lettering" && panelPosition && panelSpot && selectedId !== null && renderLetteringPanel && (
          <div
            className="absolute z-20 w-[300px] rounded-lg border border-violet-500/40 bg-gray-900/95 shadow-2xl backdrop-blur flex flex-col"
            style={{ left: panelSpot.left, top: panelSpot.top }}
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
              {panelPin ? "Moved" : "Drag to move"}
              {panelPin && (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setPanelPin(null)}
                  title="Put the panel back next to the selected lettering"
                  className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-violet-300 hover:bg-gray-800"
                >
                  <LocateFixed size={12} />
                  Follow
                </button>
              )}
            </div>
            <div className="max-h-[340px] overflow-y-auto">{renderLetteringPanel(selectedId)}</div>
          </div>
        )}
      </div>
    </section>
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
