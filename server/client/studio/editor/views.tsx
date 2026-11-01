/**
 * The page editor's whole-page views: the page while it is being translated, two stage images compared (zoomed and
 * moved like the editing canvas), and a finalized page. Split out of pages/StudioPageEditor.tsx.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent, type SyntheticEvent } from "react";
import { Loader2 } from "lucide-react";
import { PAGE_IMAGES, pageFileUrl, type PageImage } from "../../api";
import { JobProgress } from "../../components/JobProgress";
import { usePageJobEvents } from "../../hooks/usePageJobEvents";
import { useCanvasStore } from "../../stores/canvas";
import { MAX_ZOOM, MIN_ZOOM, WHEEL_HINTS } from "../canvas/config";
import { WheelModeButtons, ZoomControls } from "../canvas/ViewControls";
import { wheelIntent } from "../canvas/wheel";

/** Shown while the page runs in the pipeline (e.g. re-submitted from the extension): the original dimmed, with live progress. */
export function ProcessingView({ pageId, status, version, job }: {
  pageId: string;
  status: string;
  version: string;
  job: ReturnType<typeof usePageJobEvents>;
}) {
  const [originalLoaded, setOriginalLoaded] = useState(true);
  // original.png may not exist yet when a run starts; try again for each new version instead of spinning forever
  useEffect(() => setOriginalLoaded(true), [version]);

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
      <section className="flex-1 min-w-0 min-h-0 overflow-auto p-4 flex items-start justify-center">
        {originalLoaded ? (
          <img
            src={pageFileUrl(pageId, "original.png", version)}
            alt=""
            onError={() => setOriginalLoaded(false)}
            className="block max-h-[calc(100vh-8rem)] w-auto opacity-40"
          />
        ) : (
          <Loader2 className="mt-8 animate-spin text-gray-600" />
        )}
      </section>
      <aside className="lg:w-96 shrink-0 border-t lg:border-t-0 lg:border-l border-gray-800 overflow-y-auto p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 size={14} className="animate-spin text-indigo-400" />
          <span className="font-medium">{status === "queued" ? "Waiting in the queue…" : "Translating this page…"}</span>
        </div>
        <p className="text-xs text-gray-500">
          This page was submitted again. Editing is paused and the editor reloads when the run finishes.
        </p>
        {job.status === "idle" && job.lines.length === 0 ? (
          <p className="text-xs text-gray-600">Waiting for progress…</p>
        ) : (
          <JobProgress job={job} maxLogHeight="max-h-[60vh]" />
        )}
      </aside>
    </div>
  );
}

/** Where the compared page sits in its viewport: its scale, and its top-left corner in viewport pixels. */
interface CompareView {
  zoom: number;
  x: number;
  y: number;
}

/** Room left around the page when it is fitted, in screen pixels. */
const FIT_MARGIN = 16;

/**
 * Two stage images on top of each other with a slider revealing the left one. The wheel works as it does on the
 * editing canvas — the same wheel mode, Shift and Ctrl — and dragging the page moves it.
 */
export function StageCompare({ pageId, version }: { pageId: string; version: string }) {
  const [left, setLeft] = useState<PageImage>("original.png");
  const [right, setRight] = useState<PageImage>("result.png");
  const [split, setSplit] = useState(50);
  const wheelMode = useCanvasStore((state) => state.wheelMode);

  const viewport = useRef<HTMLDivElement>(null);
  /** The page's size in image pixels, from whichever image loads first: every stage image shares it, and the right one
   * may not exist yet (no result before a render) */
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const measure = (e: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
    // A size of nothing would make every fit divide by zero, and stick: the first size measured is kept
    if (width <= 0 || height <= 0) return;
    setSize((current) => current ?? { width, height });
  };
  const [view, setView] = useState<CompareView | null>(null);

  const fit = useCallback(() => {
    const el = viewport.current;
    if (!el || !size) return;
    // No room yet (laid out at nothing): fitting now would settle on the smallest zoom, and the first fit is the only one
    if (el.clientWidth <= 2 * FIT_MARGIN || el.clientHeight <= 2 * FIT_MARGIN) return;
    const zoom = clampZoom(Math.min(
      (el.clientWidth - 2 * FIT_MARGIN) / size.width,
      (el.clientHeight - 2 * FIT_MARGIN) / size.height,
    ));
    setView({ zoom, x: (el.clientWidth - size.width * zoom) / 2, y: (el.clientHeight - size.height * zoom) / 2 });
  }, [size]);
  // The first time the page's size is known; switching images keeps where you are
  const fitted = view !== null;
  useEffect(() => {
    if (!fitted) fit();
  }, [fit, fitted]);

  /** Zooms by `factor`, keeping the page point under (px, py) — viewport pixels — where it is. */
  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    setView((current) => {
      if (!current) return current;
      const zoom = clampZoom(current.zoom * factor);
      const scale = zoom / current.zoom;
      return { zoom, x: px - (px - current.x) * scale, y: py - (py - current.y) * scale };
    });
  }, []);
  const zoomAtCentre = (factor: number) => {
    const el = viewport.current;
    if (el) zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2);
  };

  // A listener of our own rather than onWheel: React's is passive, and the page itself must not scroll
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const intent = wheelIntent(e, useCanvasStore.getState().wheelMode, el.clientHeight);
      if ("zoom" in intent) {
        const rect = el.getBoundingClientRect();
        zoomAt(intent.zoom, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        const { dx, dy } = intent.pan;
        setView((current) => current && { ...current, x: current.x - dx, y: current.y - dy });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Dragging the page moves it; the pointer is captured, so a drag that leaves the viewport keeps going
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const from = drag.current;
    if (!from || from.pointer !== e.pointerId) return;
    const dx = e.clientX - from.x, dy = e.clientY - from.y;
    drag.current = { ...from, x: e.clientX, y: e.clientY };
    setView((current) => current && { ...current, x: current.x + dx, y: current.y + dy });
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  const select = (value: PageImage, onChange: (file: PageImage) => void, label: string) => (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(PAGE_IMAGES.find((img) => img.file === e.target.value)?.file ?? value)}
      className="bg-gray-900 border border-gray-700 rounded-md px-2 py-1 text-xs"
    >
      {PAGE_IMAGES.map((img) => (
        <option key={img.file} value={img.file}>{img.label}</option>
      ))}
    </select>
  );

  return (
    <section className="flex-1 min-w-0 min-h-0 flex flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-gray-800">
        {select(left, setLeft, "Left image")}
        <input
          type="range"
          aria-label="Comparison split between the left and right image"
          min={0}
          max={100}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          className="flex-1 min-w-24"
        />
        {select(right, setRight, "Right image")}
        <WheelModeButtons />
        <ZoomControls
          zoom={view?.zoom ?? 1}
          onZoomBy={zoomAtCentre}
          onZoomTo={(value) => zoomAtCentre(value / (view?.zoom ?? 1))}
          onFit={fit}
        />
        <span className="hidden xl:inline text-xs text-gray-500">{WHEEL_HINTS[wheelMode]}, Ctrl+wheel zooms, drag to move</span>
      </div>
      <div
        ref={viewport}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`relative flex-1 min-h-0 overflow-hidden touch-none select-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: size?.width,
            height: size?.height,
            transform: view ? `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` : undefined,
            // Measured first, shown once it has been fitted
            visibility: view ? "visible" : "hidden",
          }}
        >
          <img
            src={pageFileUrl(pageId, right, version)}
            alt=""
            draggable={false}
            onLoad={measure}
            className="absolute inset-0 h-full w-full max-w-none"
          />
          <img
            src={pageFileUrl(pageId, left, version)}
            alt=""
            draggable={false}
            onLoad={measure}
            className="absolute inset-0 h-full w-full max-w-none"
            style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
          />
        </div>
        {/* Outside the scaled layer, so the line stays one width at any zoom */}
        {view && size && (
          <div
            className="absolute w-0.5 bg-indigo-400 pointer-events-none"
            style={{ left: view.x + (size.width * view.zoom * split) / 100, top: view.y, height: size.height * view.zoom }}
          />
        )}
      </div>
    </section>
  );
}

const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** A finalized page: only its final image is left, and what can still be done with it. */
export function FinalizedView({ pageId, rawKept, version }: { pageId: string; rawKept: boolean; version: string | number }) {
  return (
    <div className="flex flex-1 min-h-0 flex-col items-center gap-3 overflow-y-auto p-6">
      <p className="max-w-xl text-center text-sm text-gray-400">
        This page is finalized: its working files, regions and stages were removed, and this is its final image.{" "}
        {rawKept
          ? "The original is kept, so Redo job in the actions menu can rebuild it."
          : "Its original was deleted too, so it is read-only."}
      </p>
      <img src={pageFileUrl(pageId, "result.png", version)} alt="The finished page" className="max-h-[80vh] max-w-full object-contain" />
    </div>
  );
}
