import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { Canvas, Circle, Ellipse, FabricImage, Line, Point, Polyline, Rect, type FabricObject } from "fabric";
import { Circle as EllipseIcon, Maximize, MousePointer2, Pentagon, Redo2, Square, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import {
  createBlock,
  deleteBlock,
  updateBlockGeometry,
  updateBlockText,
  type BlockGeometry,
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
  regionObject,
  REGION_COLORS,
  type PageSize,
  type RegionKind,
} from "./geometry";
import { CommandHistory, type Command } from "./history";

type Tool = "select" | "rect" | "ellipse" | "polygon";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
/** Drawn regions smaller than this (page pixels) are treated as accidental clicks. */
const MIN_REGION = 5;

const TOOL_HINTS: Record<Tool, string> = {
  select: "Click a region to select, drag to move, handles to resize, Delete to remove",
  rect: "Drag on empty space to draw a rectangle",
  ellipse: "Drag on empty space to draw an ellipse",
  polygon: "Click to add points; Enter, double-click or the first point to finish; Esc to cancel",
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
export function PageCanvas({ pageId, imageUrl, page, blocks, disabled, selectedId, onSelect, onDetail, onReload, toolbarStart }: PageCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const entriesRef = useRef(new Map<number, Entry>());
  const actionsRef = useRef<CanvasActions | null>(null);
  const fittedRef = useRef(false);
  const spaceRef = useRef(false);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const [tool, setTool] = useState<Tool>("select");
  const [kind, setKind] = useState<RegionKind>("text");
  const [zoom, setZoom] = useState(1);
  const [busyCount, setBusyCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const historyRef = useRef<CommandHistory | null>(null);
  historyRef.current ??= new CommandHistory(rerender);
  const history = historyRef.current;

  // Latest props for handlers registered once on the canvas
  const live = useRef({ pageId, page, blocks, disabled, tool, kind, onSelect, onDetail, onReload });
  live.current = { pageId, page, blocks, disabled, tool, kind, onSelect, onDetail, onReload };

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
    const snapshot = { kind: blockKind(block), geometry: blockGeometry(block), source: block.source_text, translation: block.translated_text };
    let current = id;
    perform({
      label: "Delete region",
      redo: async () => {
        live.current.onDetail(await deleteBlock(live.current.pageId, history.resolve(current)));
        live.current.onSelect(null);
      },
      undo: async () => {
        let detail = await createBlock(live.current.pageId, snapshot.kind, snapshot.geometry);
        const restored = newestId(detail);
        history.alias(history.resolve(current), restored);
        current = restored;
        // Bring back the text too; OCR and translation stay marked stale for the recreated region
        const text = {
          ...(snapshot.source !== null ? { source_text: snapshot.source } : {}),
          ...(snapshot.translation !== null ? { translated_text: snapshot.translation } : {}),
        };
        if (Object.keys(text).length > 0) detail = await updateBlockText(live.current.pageId, restored, text);
        live.current.onDetail(detail);
        live.current.onSelect(restored);
      },
    });
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

    const cancelDrawing = () => {
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
      setZoomTo(canvas.getZoom() * 0.999 ** e.deltaY, new Point(e.offsetX, e.offsetY));
    });

    canvas.on("mouse:down", (opt) => {
      const e = opt.e as MouseEvent;
      // A focused form control (e.g. the stage picker) would swallow Delete / Backspace and the tool keys
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && isTyping(focused)) focused.blur();
      if (spaceRef.current || e.button === 1) {
        panning = { x: e.clientX, y: e.clientY };
        canvas.setCursor("grabbing");
        return;
      }
      const current = live.current;
      if (current.disabled || current.tool === "select") return;
      if (current.tool === "polygon") {
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
      const kindOfBlock = blockKind(live.current.blocks.find((b) => b.id === id) ?? ({ kind: "text" } as StudioBlock));
      if (geometryKey(entry.geometry, kindOfBlock) === geometryKey(after, kindOfBlock)) return;
      reshapeRegion(id, entry.geometry, after);
    });

    return () => {
      resize.disconnect();
      actionsRef.current = null;
      canvasRef.current = null;
      entriesRef.current.clear();
      fittedRef.current = false;
      void canvas.dispose();
      host.replaceChildren();
    };
  }, [createRegion, deleteRegion, reshapeRegion]);

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
  }, [imageUrl, createRegion, deleteRegion, reshapeRegion]);

  // Regions: redraw only blocks whose geometry changed; keep the selection in sync with the panel
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const entries = entriesRef.current;
    const seen = new Set<number>();
    for (const block of blocks) {
      seen.add(block.id);
      const geometry = blockGeometry(block);
      const key = geometryKey(geometry, blockKind(block));
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
  }, [blocks, disabled, selectedId, createRegion, deleteRegion, reshapeRegion]);

  // Switching tools abandons a half-drawn region
  useEffect(() => {
    actionsRef.current?.cancelDrawing();
    const canvas = canvasRef.current;
    if (canvas) canvas.defaultCursor = tool === "select" ? "default" : "crosshair";
  }, [tool]);

  // A different page starts a fresh history
  useEffect(() => history.clear(), [pageId, history]);

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
        canvas.skipTargetFind = false;
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
        </div>
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
          {error ? <span className="text-red-400">{error}</span> : busyCount > 0 ? <span className="text-gray-400">Saving…</span> : <span className="text-gray-500">{TOOL_HINTS[tool]} · Space-drag to pan</span>}
        </span>
      </div>
      <div ref={hostRef} className="relative flex-1 min-h-0 overflow-hidden" />
    </section>
  );
}
