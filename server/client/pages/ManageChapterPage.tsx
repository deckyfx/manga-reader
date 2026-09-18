import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Download, Inbox, Loader2, Play, RefreshCw, SquarePen, Upload, X } from "lucide-react";
import {
  chapterExportUrl,
  filePage,
  getChapter,
  getChapterRun,
  importChapterPages,
  listInbox,
  readPageImageUrl,
  reorderChapterPages,
  rerunPage,
  startChapterRun,
  unfilePage,
  type ReadPage,
} from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { StatusBadge } from "../components/StatusBadge";

/** One chapter's pages: importing, reordering, translating the whole chapter and exporting it. */
export function ManageChapterPage() {
  const { id = "" } = useParams();
  const chapterId = Number(id);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const chapterQ = useQuery({ queryKey: ["chapter", chapterId], queryFn: () => getChapter(chapterId), enabled: Number.isFinite(chapterId) });
  const reload = () => {
    void qc.invalidateQueries({ queryKey: ["chapter", chapterId] });
    void qc.invalidateQueries({ queryKey: ["series"], refetchType: "none" });
  };

  // While a chapter run is going, follow its progress and the pages it finishes
  const runQ = useQuery({
    queryKey: ["chapter-run", chapterId],
    queryFn: () => getChapterRun(chapterId),
    enabled: Number.isFinite(chapterId),
    refetchInterval: (query) => ("running" in (query.state.data ?? {}) && (query.state.data as { running: boolean }).running ? 2000 : false),
  });
  const run = runQ.data && "running" in runQ.data ? runQ.data : null;
  const pending = runQ.data && "pending" in runQ.data ? runQ.data.pending : null;
  const running = run?.running ?? false;
  const [wasRunning, setWasRunning] = useState(false);
  if (running !== wasRunning) {
    setWasRunning(running);
    // The run rewrote page results: refresh the grid when it ends
    if (!running) reload();
  }

  const [cleanSfx, setCleanSfx] = useState(false);
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [showInbox, setShowInbox] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const importM = useMutation({
    mutationFn: (files: File[]) => importChapterPages(chapterId, files),
    onSuccess: (detail) => {
      setSkipped(detail.skipped);
      qc.setQueryData(["chapter", chapterId], detail);
      void qc.invalidateQueries({ queryKey: ["chapter-run", chapterId] });
      void qc.invalidateQueries({ queryKey: ["series"], refetchType: "none" });
    },
  });
  const reorderM = useMutation({
    mutationFn: (ids: string[]) => reorderChapterPages(chapterId, ids),
    onSuccess: (detail) => qc.setQueryData(["chapter", chapterId], detail),
  });
  const unfileM = useMutation({
    mutationFn: (pageId: string) => unfilePage(pageId),
    onSuccess: () => {
      reload();
      void qc.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
  const addM = useMutation({
    mutationFn: (pageId: string) => filePage(pageId, { chapter_id: chapterId }),
    onSuccess: () => {
      reload();
      void qc.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
  const runM = useMutation({
    mutationFn: (force: boolean) => startChapterRun(chapterId, { force, clean_sfx: cleanSfx }),
    onSuccess: (state) => {
      qc.setQueryData(["chapter-run", chapterId], state);
      void runQ.refetch();
    },
  });
  const rerunM = useMutation({ mutationFn: (pageId: string) => rerunPage(pageId, { clean_sfx: cleanSfx }), onSuccess: reload });

  const chapter = chapterQ.data?.chapter;
  const series = chapterQ.data?.series;
  const pages = chapterQ.data?.pages ?? [];
  const error = chapterQ.error ?? importM.error ?? reorderM.error ?? runM.error ?? rerunM.error ?? unfileM.error ?? addM.error;

  const importFiles = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (list.length > 0) importM.mutate(list);
  };

  /** Drops the dragged page in front of `targetId` and saves the new order. */
  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = pages.map((p) => p.id).filter((pageId) => pageId !== dragId);
    const at = ids.indexOf(targetId);
    ids.splice(at < 0 ? ids.length : at, 0, dragId);
    setDragId(null);
    reorderM.mutate(ids);
  };

  const removePage = async (page: ReadPage) => {
    const confirmed = await confirm({
      title: "Take this page out of the chapter?",
      message: "The page and its translation are kept; it returns to the Inbox.",
      confirmLabel: "Remove from chapter",
    });
    if (confirmed) unfileM.mutate(page.id);
  };

  if (chapterQ.isLoading) return <Loader2 className="m-4 animate-spin text-gray-500" />;
  if (!chapter || !series) return <p className="m-4 text-sm text-red-400">{chapterQ.error?.message ?? "Chapter not found"}</p>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-800 px-4 py-3">
        <Link to={`/manage/series/${series.id}`} className="text-gray-400 hover:text-white" title="Back to the series">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="truncate text-base font-semibold">
          {chapter.number ? `${chapter.number}. ` : ""}
          {chapter.title}
        </h1>
        <span className="truncate text-xs text-gray-500">{series.title}</span>
        <span className="text-xs text-gray-500">{pages.length} page{pages.length === 1 ? "" : "s"}</span>
        {error && <span className="truncate text-xs text-red-400">{error.message}</span>}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-400" title="Also remove sound effects when translating">
            <input type="checkbox" checked={cleanSfx} onChange={(e) => setCleanSfx(e.target.checked)} className="accent-indigo-500" />
            Clean SFX
          </label>
          <button
            onClick={() => runM.mutate(false)}
            disabled={running || runM.isPending || pages.length === 0}
            title="Translate the pages that still need it"
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {running || runM.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Translate chapter{pending ? ` (${pending})` : ""}
          </button>
          <button
            onClick={() => runM.mutate(true)}
            disabled={running || runM.isPending || pages.length === 0}
            title="Translate every page again, including finished ones"
            className="rounded-lg bg-gray-800 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          >
            Force all
          </button>
          {pages.length > 0 && (
            <>
              <Link to={`/read/chapters/${chapterId}/pages/1`} className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700">
                <BookOpen size={14} />
                Read
              </Link>
              <a
                href={chapterExportUrl(chapterId)}
                className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
                title="Download the chapter as a ZIP of its published pages"
              >
                <Download size={14} />
                Export
              </a>
            </>
          )}
        </div>
      </div>

      {run && (run.running || run.failed > 0) && (
        <div className="flex items-center gap-3 border-b border-gray-800 bg-gray-900/60 px-4 py-2 text-xs text-gray-400">
          <span>
            {run.running ? "Translating" : "Last run"}: {run.done}/{run.total} done{run.failed > 0 ? `, ${run.failed} failed` : ""}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded bg-gray-800">
            <div
              className="h-full bg-indigo-500 transition-[width]"
              style={{ width: `${run.total === 0 ? 0 : Math.round(((run.done + run.failed) / run.total) * 100)}%` }}
            />
          </div>
          {run.error && <span className="max-w-64 truncate text-amber-400">{run.error}</span>}
        </div>
      )}

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          importFiles(e.dataTransfer.files);
        }}
        className="flex flex-wrap items-center gap-2 border-b border-gray-800 bg-gray-900/40 px-4 py-3 text-xs text-gray-400"
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,.zip,.cbz"
          onChange={(e) => {
            importFiles(e.target.files);
            e.target.value = "";
          }}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={importM.isPending}
          className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          {importM.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          Add pages
        </button>
        <span>or drop images, ZIP or CBZ files here — they're appended in file-name order</span>
        <button onClick={() => setShowInbox((open) => !open)} className="ml-auto flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-gray-300 hover:bg-gray-800">
          <Inbox size={14} />
          {showInbox ? "Hide inbox" : "Add from inbox"}
        </button>
      </div>

      {skipped.length > 0 && (
        <div className="flex items-start gap-2 border-b border-gray-800 px-4 py-2 text-xs text-amber-400">
          <span className="flex-1">Skipped: {skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}</span>
          <button onClick={() => setSkipped([])} aria-label="Dismiss" className="rounded p-0.5 hover:bg-gray-800">
            <X size={12} />
          </button>
        </div>
      )}

      {showInbox && <InboxPicker onAdd={(pageId) => addM.mutate(pageId)} adding={addM.isPending} />}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {pages.length === 0 ? (
          <p className="text-sm text-gray-500">No pages yet. Add images or a ZIP / CBZ, or pick pages from the Inbox.</p>
        ) : (
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
            {pages.map((page, index) => (
              <div
                key={page.id}
                draggable
                onDragStart={() => setDragId(page.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropOn(page.id)}
                onDragEnd={() => setDragId(null)}
                className={`group relative cursor-grab overflow-hidden rounded-lg border bg-gray-900 active:cursor-grabbing ${
                  dragId === page.id ? "border-indigo-500 opacity-60" : "border-gray-800"
                }`}
              >
                <Link to={`/read/chapters/${chapterId}/pages/${index + 1}`} className="block aspect-[2/3] bg-gray-950">
                  <img
                    src={readPageImageUrl(page.id, `${page.revision}-${page.updated_at}`)}
                    alt={page.name ?? `Page ${index + 1}`}
                    loading="lazy"
                    className="h-full w-full object-contain"
                  />
                </Link>
                <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs">
                  <span className="tabular-nums text-gray-500">{index + 1}</span>
                  <span className="truncate text-gray-300">{page.name ?? "page"}</span>
                  <span className="ml-auto">{page.has_result ? <StatusBadge status="done" label="translated" /> : <StatusBadge status={page.status} />}</span>
                </div>
                <div className="absolute right-1 top-1 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <Link
                    to={`/studio/pages/${page.id}`}
                    title="Open in the Studio"
                    aria-label="Open in the Studio"
                    className="rounded bg-gray-900/90 p-1 text-gray-300 hover:text-white"
                  >
                    <SquarePen size={13} />
                  </Link>
                  <button
                    onClick={() => rerunM.mutate(page.id)}
                    disabled={rerunM.isPending || running}
                    title="Translate this page again"
                    aria-label="Translate this page again"
                    className="rounded bg-gray-900/90 p-1 text-gray-300 hover:text-white disabled:opacity-40"
                  >
                    <RefreshCw size={13} />
                  </button>
                  <button
                    onClick={() => void removePage(page)}
                    disabled={unfileM.isPending}
                    title="Remove from this chapter"
                    aria-label="Remove from this chapter"
                    className="rounded bg-gray-900/90 p-1 text-gray-300 hover:text-red-300 disabled:opacity-40"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Pages waiting in the Inbox (extension jobs and Studio uploads), to file into this chapter. */
function InboxPicker({ onAdd, adding }: { onAdd: (pageId: string) => void; adding: boolean }) {
  const inboxQ = useQuery({ queryKey: ["inbox"], queryFn: listInbox });
  const pages = inboxQ.data ?? [];

  return (
    <div className="border-b border-gray-800 bg-gray-950/60 px-4 py-3">
      {inboxQ.isLoading ? (
        <Loader2 size={14} className="animate-spin text-gray-500" />
      ) : pages.length === 0 ? (
        <p className="text-xs text-gray-500">The Inbox is empty: pages translated from the extension or uploaded in the Studio show up here.</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {pages.map((page) => (
            <button
              key={page.id}
              onClick={() => onAdd(page.id)}
              disabled={adding}
              title={`Add ${page.name ?? page.id.slice(-8)} to this chapter`}
              className="w-24 shrink-0 overflow-hidden rounded-lg border border-gray-800 bg-gray-900 hover:border-indigo-500 disabled:opacity-50"
            >
              <span className="block aspect-[2/3] bg-gray-950">
                <img src={readPageImageUrl(page.id, `${page.revision}-${page.updated_at}`)} alt="" loading="lazy" className="h-full w-full object-contain" />
              </span>
              <span className="block truncate px-1.5 py-1 text-[11px] text-gray-400">{page.name ?? page.id.slice(-8)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
