/**
 * The page editor's whole-page views: the page while it is being translated, two stage images compared, and a
 * finalized page. Split out of pages/StudioPageEditor.tsx.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { PAGE_IMAGES, pageFileUrl, type PageImage } from "../../api";
import { JobProgress } from "../../components/JobProgress";
import { usePageJobEvents } from "../../hooks/usePageJobEvents";

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

/** Two stage images on top of each other with a slider revealing the left one. */
export function StageCompare({ pageId, version }: { pageId: string; version: string }) {
  const [left, setLeft] = useState<PageImage>("original.png");
  const [right, setRight] = useState<PageImage>("result.png");
  const [split, setSplit] = useState(50);

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
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800">
        {select(left, setLeft, "Left image")}
        <input
          type="range"
          aria-label="Comparison split between the left and right image"
          min={0}
          max={100}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          className="flex-1"
        />
        {select(right, setRight, "Right image")}
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4">
        <div className="relative mx-auto w-fit">
          <img src={pageFileUrl(pageId, right, version)} alt="" className="block max-h-[calc(100vh-10rem)] w-auto" />
          <img
            src={pageFileUrl(pageId, left, version)}
            alt=""
            className="absolute inset-0 h-full w-full"
            style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
          />
          <div className="absolute inset-y-0 w-0.5 bg-indigo-400 pointer-events-none" style={{ left: `${split}%` }} />
        </div>
      </div>
    </section>
  );
}

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
