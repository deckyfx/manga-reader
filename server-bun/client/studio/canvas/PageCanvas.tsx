import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { Canvas, Circle, Ellipse, FabricImage, Line, Point, Polyline, Rect, type FabricObject } from "fabric";
import {
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
  Square,
  Trash2,
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
  updateBlockGeometry,
  type BlockGeometry,
  type MaskLayerName,
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

type Tool = "select" | "rect" | "ellipse" | "polygon" | "brush";

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

const WHEEL_HINTS: Record<WheelMode, string> = {
  zoom: "Wheel zooms, Shift+wheel scrolls",
  vertical: "Wheel scrolls up/down, Shift sideways",
  horizontal: "Wheel scrolls sideways, Shift up/down",
};

interface PageCanvasProps {
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
  zoomBy: (factor: number) => void;
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Fabric canvas for editing a page's regions: draw rectangles, ellipses and polygons, move / resize / delete them,
 * zoom and pan, undo and redo. The server is the source of truth: every change is sent right away and the canvas
 * redraws from the returned blocks.
 */
export function PageCanvas({ pageId, imageUrl, page, blocks, disabled, selectedId, onSelect, onDetail, onReload, toolbarStart, onImagesChanged }: PageCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const entriesRef = useRef(new Map<number, Entry>());
  const actionsRef = useRef<CanvasActions | null>(null);
  const fittedRef = useRef(false);
  const spaceRef = useRef(false);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const [tool, setTool] = useState<Tool>("select");
  const [kind, setKind] = useState<RegionKind>("text");
  const [brushLayer, setBrushLayer] = useState<MaskLayerName>("add");
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH);
  const [showMask, setShowMask] = useState(false);
  /** Spots painted into the add layer that haven't been re-cleaned yet, in page pixels. */
  const [paintedAreas, setPaintedAreas] = useState<Area[]>([]);
  const [recleaning, setRecleaning] = useState(false);
  /** Bumped to load the mask layers from the server again (after a failed save). */
  const [layersNonce, setLayersNonce] = useState(0);
  const maskRef = useRef<MaskLayers | null>(null);
  const brushCursorRef = useRef<Circle | null>(null);
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
  const live = useRef({ pageId, page, blocks, disabled, tool, kind, wheelMode, brushLayer, brushSize, showMask, onSelect, onDetail, onReload, onImagesChanged });
  live.current = { pageId, page, blocks, disabled, tool, kind, wheelMode, brushLayer, brushSize, showMask, onSelect, onDetail, onReload, onImagesChanged };

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
      content: { include: block.include, source_text: block.source_text, translated_text: block.translated_text },
    };
    let current = id;
    perform({
      label: "Delete region",
      redo: async () => {
        live.current.onDetail(await deleteBlock(live.current.pageId, history.resolve(current)));
        live.current.onSelect(null);
      },
      undo: async () => {
        // One request brings back geometry, include flag and text together, so a failure can't leave a blank region
        const detail = await createBlock(live.current.pageId, snapshot.kind, snapshot.geometry, snapshot.content);
        const restored = newestId(detail);
        history.alias(history.resolve(current), restored);
        current = restored;
        live.current.onDetail(detail);
        live.current.onSelect(restored);
      },
    });
  }, [history, perform]);

  /** Saves the painted layers a stroke changed; the server marks the clean stages stale. */
  const saveLayers = useCallback(async (touched: Record<MaskLayerName, boolean>) => {
    const mask = maskRef.current;
    if (!mask) return;
    for (const name of ["add", "erase"] as const) {
      if (touched[name]) live.current.onDetail(await saveMaskLayer(live.current.pageId, name, mask.exportLayer(name)));
    }
  }, []);

  const paintStroke = useCallback((record: StrokeRecord) => {
    // The stroke is already on the layer when it's recorded: only a later redo paints it again
    let firstRun = true;
    const show = (state: "before" | "after") => {
      maskRef.current?.apply(record, state);
      canvasRef.current?.requestRenderAll();
    };
    perform({
      label: record.layer === "add" ? "Paint mask" : "Erase mask",
      redo: async () => {
        if (!firstRun) show("after");
        firstRun = false;
        await saveLayers(record.touched);
      },
      undo: async () => {
        show("before");
        await saveLayers(record.touched);
      },
    });
    if (record.layer === "add") setPaintedAreas((areas) => [...areas, record.area]);
  }, [perform, saveLayers]);

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
      const id = blockIdOf(canvas.getActiveObject());
      if (id !== undefined && !live.current.disabled) deleteRegion(id);
    };

    actionsRef.current = {
      finishPolygon,
      cancelDrawing,
      deleteSelected,
      fit,
      zoomBy: (factor) => setZoomTo(canvas.getZoom() * factor, new Point(canvas.getWidth() / 2, canvas.getHeight() / 2)),
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
      // Pan: space-drag or middle-drag with any tool, or dragging empty space with the select tool
      if (spaceRef.current || e.button === 1 || (live.current.tool === "select" && !opt.target)) {
        panning = { x: e.clientX, y: e.clientY };
        canvas.setCursor("grabbing");
        return;
      }
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
      if (live.current.tool === "brush") {
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
      if (live.current.tool === "polygon") finishPolygon();
    });

    canvas.on("mouse:out", () => {
      brushCursor.set({ visible: false });
      canvas.requestRenderAll();
    });

    // ── Selection and edits ───────────────────────────────────────────────────
    const selectFrom = (selected: FabricObject[] | undefined) => {
      const id = blockIdOf(selected?.[0]);
      if (id !== undefined) live.current.onSelect(id);
    };
    canvas.on("selection:created", (e) => selectFrom(e.selected));
    canvas.on("selection:updated", (e) => selectFrom(e.selected));
    canvas.on("selection:cleared", (e) => {
      // Only a user deselect clears the panel's selection (programmatic discards pass no event)
      if (e.e) live.current.onSelect(null);
    });

    canvas.on("object:modified", (e) => {
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
      actionsRef.current = null;
      canvasRef.current = null;
      brushCursorRef.current = null;
      entriesRef.current.clear();
      fittedRef.current = false;
      void canvas.dispose();
      host.replaceChildren();
    };
  }, [createRegion, deleteRegion, reshapeRegion, paintStroke]);

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
          actionsRef.current?.fit();
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
        mask.setVisible(live.current.showMask || live.current.tool === "brush");
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

  // The overlay shows while painting, or when asked for
  useEffect(() => {
    maskRef.current?.setVisible(showMask || tool === "brush");
    canvasRef.current?.requestRenderAll();
  }, [showMask, tool]);

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
    for (const { obj } of entries.values()) obj.set({ selectable: !disabled, evented: !disabled });

    const target = selectedId !== null ? entries.get(selectedId)?.obj : undefined;
    const active = canvas.getActiveObject();
    if (target && active !== target) canvas.setActiveObject(target);
    else if (!target && active) canvas.discardActiveObject();
    canvas.requestRenderAll();
  }, [blocks, disabled, selectedId, createRegion, deleteRegion, reshapeRegion, paintStroke]);

  // Switching tools abandons a half-drawn region; the brush paints over regions instead of picking them
  useEffect(() => {
    actionsRef.current?.cancelDrawing();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.defaultCursor = tool === "select" ? "default" : "crosshair";
    canvas.skipTargetFind = tool === "brush";
    if (tool !== "brush") {
      brushCursorRef.current?.set({ visible: false });
      canvas.requestRenderAll();
    }
  }, [tool]);

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
      if (key === "v") setTool("select");
      else if (key === "r") setTool("rect");
      else if (key === "e") setTool("ellipse");
      else if (key === "p") setTool("polygon");
      else if (key === "b") setTool("brush");
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
        canvas.skipTargetFind = live.current.tool === "brush";
        canvas.setCursor(live.current.tool === "select" ? "default" : "crosshair");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [enqueue, history]);

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
    if (areas.length === 0) return;
    setBusyCount((n) => n + 1);
    setRecleaning(true);
    queueRef.current = queueRef.current
      .then(async () => {
        try {
          live.current.onDetail(await recleanAreas(live.current.pageId, areas));
          live.current.onImagesChanged();
          setPaintedAreas((current) => current.filter((area) => !used.includes(area)));
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
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
                  className={`px-2 py-1 ${brushLayer === value ? "bg-gray-700 text-white" : "text-gray-400 hover:bg-gray-800"}`}
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
                className={`px-2 py-1 ${kind === value ? "bg-gray-700 text-white" : "text-gray-400 hover:bg-gray-800"}`}
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
            onClick={reclean}
            disabled={disabled || recleaning || recleanTargets.length === 0}
            title={recleanTitle}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-200 bg-gray-800 hover:bg-gray-700 disabled:opacity-40"
          >
            <WandSparkles size={14} />
            Re-clean{paintedAreas.length > 0 ? ` (${paintedAreas.length})` : ""}
          </button>
        </div>
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
                className={`px-1.5 py-1 ${wheelMode === mode ? "bg-gray-700 text-white" : "text-gray-400 hover:bg-gray-800"}`}
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
          <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button onClick={() => actionsRef.current?.zoomBy(1.2)} title="Zoom in (+)" className="p-1.5 rounded-md hover:bg-gray-800">
            <ZoomIn size={15} />
          </button>
          <button onClick={() => actionsRef.current?.fit()} title="Fit page (F)" className="p-1.5 rounded-md hover:bg-gray-800">
            <Maximize size={15} />
          </button>
        </div>
        <span className="ml-auto text-xs truncate max-w-full">
          {error ? <span className="text-red-400">{error}</span> : busyCount > 0 ? <span className="text-gray-400">{recleaning ? "Re-cleaning…" : "Saving…"}</span> : <span className="text-gray-500">{TOOL_HINTS[tool]} · {WHEEL_HINTS[wheelMode]}, Ctrl+wheel zooms, Space-drag pans</span>}
        </span>
      </div>
      <div ref={hostRef} className="relative flex-1 min-h-0 overflow-hidden" />
    </section>
  );
}
