import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useReducer, useRef, useState } from "react";
import { Canvas, Circle, Ellipse, FabricImage, Line, Point, Polyline, Rect, util, type FabricObject } from "fabric";
import {
  createBlock,
  deleteBlock,
  recleanAreas,
  saveMaskLayer,
  updateBlock,
  updateBlockGeometry,
  type BlockGeometry,
  type MaskLayerName,
  type TextStyle,
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
  REGION_COLORS,
  type RegionKind,
} from "./geometry";
import { CommandHistory, type Command } from "./history";
import { MaskLayers, type Area, type StrokeRecord } from "./mask-layers";
import { LetteringObject, letteringIdOf } from "./lettering-object";
import type { Toolset } from "../toolset";
import { canvasSession, ifCurrent, showsTextLayer, useCanvasStore } from "../../stores/canvas";

/** What the canvas is set to right now, for handlers registered once (see the store). */
const canvasState = () => useCanvasStore.getState();
import {
  isTyping,
  MAX_ZOOM,
  MIN_REGION,
  MIN_ZOOM,
  PANEL_OUTER_HEIGHT,
  PANEL_WIDTH,
  WHEEL_MAX_DELTA,
  WHEEL_ZOOM_RATE,
  type CanvasActions,
  type EditMode,
  type Tool,
} from "./config";

import { CanvasToolbar } from "./CanvasToolbar";
import { LetteringPanelFrame } from "./LetteringPanelFrame";
import { recleanPlan, syncLettering, syncRegions, type Entry } from "./layer-sync";
import type { PageCanvasHandle, PageCanvasProps } from "./props";
import { useCanvasShortcuts } from "./useCanvasShortcuts";

export type { EditMode, Tool } from "./config";
export type { PageCanvasHandle } from "./props";

interface PolygonDraft {
  points: { x: number; y: number }[];
  markers: Circle[];
  outline: Polyline | null;
  rubber: Line;
}

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
  // Opened with the toolset the previous page was left with. In a layout effect, so the store is set before paint
  // without updating the outgoing canvas — which is still mounted while this one renders — mid-render. The ref
  // keeps StrictMode's second mount in development from opening the page twice.
  const opened = useRef(false);
  useLayoutEffect(() => {
    if (opened.current) return;
    opened.current = true;
    useCanvasStore.getState().open(startingToolset);
  }, [startingToolset]);
  const { tool, kind, brushLayer, brushSize, showMask, showText, mode, paintedAreas, recleaning, zoom, busyCount, error } = useCanvasStore();
  /**
   * The page these rendered values belong to. The first render of a new canvas reads the store before the layout
   * effect above opens it, so it holds the *previous* page's tools — and an effect from that render runs all the
   * same. Anything that tells the editor what it is looking at, or writes to the workspace's remembered toolset,
   * has to sit out that one render, or it would report the page the user just left.
   */
  const session = useCanvasStore((state) => state.session);
  const rendersThisPage = (): boolean => session === useCanvasStore.getState().session;
  const { setTool, setMode, setBrushLayer, setBrushSize, setShowMask, setPaintedAreas, setRecleaning, setZoom, addBusy, setError } = useCanvasStore.getState();
  /** Bumped to load the mask layers from the server again (after a failed save). */
  const [layersNonce, setLayersNonce] = useState(0);
  const maskRef = useRef<MaskLayers | null>(null);
  const brushCursorRef = useRef<Circle | null>(null);
  /** Floating lettering objects by block id. */
  const letteringRef = useRef(new Map<number, LetteringObject>());
  const panelHostRef = useRef<HTMLDivElement>(null);
  const [panelPosition, setPanelPosition] = useState<{ left: number; top: number } | null>(null);
  /** Where the user dragged the lettering panel; it stays there for every selection until it's set to follow again. */
  const [panelPin, setPanelPin] = useState<{ left: number; top: number } | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const historyRef = useRef<CommandHistory | null>(null);
  historyRef.current ??= new CommandHistory(rerender);
  const history = historyRef.current;

  // Latest props for handlers registered once on the canvas; what the canvas is *set to* lives in the store, which
  // those handlers read with getState()
  const showTextLayer = showsTextLayer(useCanvasStore.getState(), textPreviewAvailable);
  const live = useRef({
    pageId, page, blocks, disabled, selectedId, lettering, textPreviewAvailable,
    onSelect, onDetail, onReload, onImagesChanged, onStylePreview, relayout, onModeChange, onToolsetChange,
  });
  live.current = {
    pageId, page, blocks, disabled, selectedId, lettering, textPreviewAvailable,
    onSelect, onDetail, onReload, onImagesChanged, onStylePreview, relayout, onModeChange, onToolsetChange,
  };

  // Every toolset change is handed on, so the workspace's next page opens with it
  useEffect(() => {
    if (!rendersThisPage()) return;
    live.current.onToolsetChange?.({ tool, kind, brushLayer, brushSize, showMask, mode, showText });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, kind, brushLayer, brushSize, showMask, mode, showText, session]);

  /** Runs server changes one after another; a failure shows the error, drops the history and reloads the page. */
  const enqueue = useCallback((task: () => Promise<void>) => {
    // Whatever this reports belongs to the page open now; a page opened meanwhile has its own busy count and error
    const session = canvasSession();
    addBusy(1);
    queueRef.current = queueRef.current
      .then(async () => {
        await task();
        ifCurrent(session, () => setError(null));
      })
      .catch((err: unknown) => {
        ifCurrent(session, () => setError(err instanceof Error ? err.message : String(err)));
        history.clear();
        for (const entry of entriesRef.current.values()) entry.key = "";
        // The reload brings back the server's styles: pending canvas baselines no longer apply
        styleBaselineRef.current.clear();
        live.current.onReload();
        // A failed layer save leaves the overlay ahead of the server: show what the server has
        setLayersNonce((n) => n + 1);
      })
      .finally(() => ifCurrent(session, () => addBusy(-1)));
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
    // The page this stroke was painted on; its saves can land after another page has opened
    const strokeSession = canvasSession();
    /** Queues the stroke's area for Re-clean: only when the change can add pixels to the effective mask. */
    const markForReclean = () => {
      // Not `live.current.pageId === pageId` — both are this canvas's own, so that was always true. The painted
      // areas are shared, and the next page must not be offered a Re-clean of coordinates from this one.
      ifCurrent(strokeSession, () => setPaintedAreas((areas) => [...areas, record.area]));
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
      if (geometry.w >= MIN_REGION && geometry.h >= MIN_REGION) createRegion(canvasState().kind, geometry);
    };

    const addPolygonPoint = (scene: { x: number; y: number }) => {
      const p = pagePoint(scene, live.current.page);
      const scale = canvas.getZoom();
      const style = draftOptions(canvasState().kind);
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
        fill: REGION_COLORS[canvasState().kind].stroke,
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
      const id = blockIdOf(active) ?? letteringIdOf(active) ?? (canvasState().mode === "lettering" ? live.current.selectedId ?? undefined : undefined);
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
      const mode = canvasState().wheelMode;
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
      if (canvasState().mode === "lettering" && !opt.target && !spaceRef.current && e.button !== 1) {
        const p = opt.scenePoint;
        const hit = live.current.blocks
          .filter((b) => (b.kind === "text" || b.kind === "sfx") && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)
          .sort((a, b) => a.w * a.h - b.w * b.h)[0];
        live.current.onSelect(hit ? hit.id : null);
      }
      // Pan: space-drag or middle-drag with any tool, or dragging empty space with the select tool or in Lettering mode
      const panTool = canvasState().mode === "lettering" || canvasState().tool === "select";
      if (spaceRef.current || e.button === 1 || (panTool && !opt.target)) {
        panning = { x: e.clientX, y: e.clientY };
        canvas.setCursor("grabbing");
        return;
      }
      if (canvasState().mode === "lettering") return;
      if (canvasState().tool === "brush") {
        const mask = maskRef.current;
        if (live.current.disabled || !mask || e.button === 2) return;
        painting = true;
        mask.setVisible(true);
        mask.beginStroke(canvasState().brushLayer, pagePoint(opt.scenePoint, live.current.page), canvasState().brushSize);
        canvas.requestRenderAll();
        return;
      }
      const current = live.current;
      const { tool, kind } = canvasState();
      if (current.disabled || tool === "select") return;
      if (tool === "polygon") {
        // Pressing an existing region doesn't start a polygon; once one is being drawn, points may land on
        // top of other regions (outlining a bubble that already has a detected box inside it)
        if (opt.target && !polygon) return;
        addPolygonPoint(opt.scenePoint);
        return;
      }
      // Pressing on an existing region selects or moves it instead of drawing on top
      if (opt.target) return;
      const start = pagePoint(opt.scenePoint, current.page);
      const style = draftOptions(kind);
      const obj = tool === "rect"
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
      if (canvasState().mode === "regions" && canvasState().tool === "brush") {
        brushCursor.set({ left: p.x, top: p.y, radius: canvasState().brushSize / 2, visible: true });
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
      if (geometry.w >= MIN_REGION && geometry.h >= MIN_REGION) createRegion(canvasState().kind, geometry);
    });

    canvas.on("mouse:dblclick", () => {
      if (canvasState().mode === "lettering") {
        focusLetteringText();
        return;
      }
      if (canvasState().tool === "polygon") finishPolygon();
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
        mask.setVisible(canvasState().mode === "regions" && (canvasState().showMask || canvasState().tool === "brush"));
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
    syncLettering(canvas, letteringRef.current, lettering, { mode, disabled, showTextLayer, selectedId });
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
    syncRegions(canvas, entriesRef.current, blocks, { mode, disabled, selectedId }, letteringRef.current);
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
    if (!rendersThisPage()) return;
    live.current.onModeChange?.(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, session]);

  // A different page starts a fresh history and has nothing painted yet
  useEffect(() => {
    history.clear();
    setPaintedAreas([]);
  }, [pageId, history]);

  // Keyboard: tools, undo / redo, delete, polygon finish / cancel, fit, space to pan
  useCanvasShortcuts({ enqueue, history, canvasRef, spaceRef, actionsRef, live, focusLetteringText });

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

  const panelSpot = panelPin ?? panelPosition;

  // Re-clean targets: the painted spots when there are any, otherwise the selected region's box
  const { targets: recleanTargets, title: recleanTitle } = recleanPlan(paintedAreas, blocks, selectedId);

  /** Runs after pending saves (so the painted layers are on the server); a failure only shows the error. */
  const reclean = () => {
    const used = paintedAreas;
    const areas = recleanTargets;
    // The areas belong to this page: the queued run must not re-clean, or update, a page opened meanwhile
    const targetPageId = pageId;
    if (areas.length === 0) return;
    const session = canvasSession();
    addBusy(1);
    setRecleaning(true);
    queueRef.current = queueRef.current
      .then(async () => {
        try {
          const detail = await recleanAreas(targetPageId, areas);
          if (live.current.pageId !== targetPageId) return;
          live.current.onDetail(detail);
          live.current.onImagesChanged();
          ifCurrent(session, () => {
            setPaintedAreas((current) => current.filter((area) => !used.includes(area)));
            setError(null);
          });
        } catch (err) {
          if (live.current.pageId === targetPageId) ifCurrent(session, () => setError(err instanceof Error ? err.message : String(err)));
        }
      })
      .finally(() => ifCurrent(session, () => {
        setRecleaning(false);
        addBusy(-1);
      }));
  };


  return (
    <section className="flex-1 min-w-0 min-h-0 flex flex-col">
      <CanvasToolbar
        toolbarStart={toolbarStart}
        disabled={disabled}
        textPreviewAvailable={textPreviewAvailable}
        reclean={reclean}
        recleanTargets={recleanTargets}
        recleanTitle={recleanTitle}
        enqueue={enqueue}
        history={history}
        actionsRef={actionsRef}
        selectedId={selectedId}
      />
      <div ref={panelHostRef} className="relative flex-1 min-h-0 overflow-hidden">
        <div ref={hostRef} className="absolute inset-0" />
        {mode === "lettering" && panelPosition && panelSpot && selectedId !== null && renderLetteringPanel && (
          <LetteringPanelFrame spot={panelSpot} pinned={panelPin !== null} onPin={setPanelPin} hostRef={panelHostRef}>
            {renderLetteringPanel(selectedId)}
          </LetteringPanelFrame>
        )}
      </div>
    </section>
  );
}
