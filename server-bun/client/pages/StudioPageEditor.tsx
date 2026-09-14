import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, History, Languages, Loader2, RefreshCw, RotateCcw, ScanText, Send, Trash2, TriangleAlert } from "lucide-react";
import {
  deletePage,
  getPage,
  historyImageUrl,
  listHistory,
  PAGE_IMAGES,
  pageFileUrl,
  publishPage,
  rollbackPage,
  runStage,
  updateBlockText,
  type PageImage,
  type StudioBlock,
  type StudioPageDetail,
} from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { JobProgress } from "../components/JobProgress";
import { StatusBadge } from "../components/StatusBadge";
import { usePageJobEvents } from "../hooks/usePageJobEvents";
import { PageCanvas } from "../studio/canvas/PageCanvas";

const isBusy = (status: string | undefined) => status === "queued" || status === "running";

/** Studio editor for one page: compare stage images, edit and re-run blocks, re-render, publish and roll back. */
export function StudioPageEditor() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const pageQ = useQuery({
    queryKey: ["studio-page", id],
    queryFn: () => getPage(id),
    enabled: id !== "",
    // The page can be re-run from elsewhere (extension, New page): poll so the editor notices, faster while it runs
    refetchInterval: (query) => (isBusy(query.state.data?.page.status) ? 2000 : 5000),
  });
  const setDetail = (detail: StudioPageDetail) => qc.setQueryData(["studio-page", id], detail);

  // Text saves run on blur, which fires just before a button's click: actions wait for them so they see the new text
  const pendingSaves = useRef(new Set<Promise<unknown>>());
  const trackSave = useCallback((save: Promise<unknown>) => {
    const tracked = save.finally(() => pendingSaves.current.delete(tracked));
    // The block shows its own save error; this only keeps the rejection from being reported as unhandled
    void tracked.catch(() => {});
    pendingSaves.current.add(tracked);
  }, []);
  // Actions waiting on saves, by key: the ref rejects a second click synchronously, the state disables its control
  const queuedRef = useRef(new Set<string>());
  const [queued, setQueued] = useState<ReadonlySet<string>>(() => new Set());
  const afterSaves = useCallback((key: string, action: () => void) => {
    if (queuedRef.current.has(key)) return;
    queuedRef.current.add(key);
    setQueued(new Set(queuedRef.current));
    const release = () => {
      queuedRef.current.delete(key);
      setQueued(new Set(queuedRef.current));
    };
    // A failed save leaves the server on the old text: don't run OCR, translate, render or publish against it.
    // Releasing right before the action lets React batch it with the mutation's pending state, so the control stays disabled.
    Promise.all([...pendingSaves.current]).then(() => {
      release();
      action();
    }, release);
  }, []);

  const [view, setView] = useState<"canvas" | "compare">("canvas");
  const [canvasImage, setCanvasImage] = useState<PageImage>("original.png");
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null);

  const [published, setPublished] = useState<{ revision: number; notified: number } | null>(null);
  const onPublished = (result: { revision: number; notified: number }) => {
    setPublished(result);
    void qc.invalidateQueries({ queryKey: ["studio-page", id] });
    void qc.invalidateQueries({ queryKey: ["studio-history", id] });
  };
  const renderM = useMutation({ mutationFn: () => runStage(id, "render"), onSuccess: setDetail });
  const translateAllM = useMutation({ mutationFn: () => runStage(id, "translate"), onSuccess: setDetail });
  const publishM = useMutation({ mutationFn: () => publishPage(id), onSuccess: onPublished });
  const navigate = useNavigate();
  const deleteM = useMutation({
    mutationFn: () => deletePage(id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["studio-page", id] });
      void qc.invalidateQueries({ queryKey: ["studio-pages"] });
      navigate("/studio");
    },
  });
  const confirm = useConfirm();
  const confirmDelete = async () => {
    const confirmed = await confirm({
      title: "Discard this page?",
      message: "Its translation, edits, publish history and all its images are deleted. This can't be undone.",
      confirmLabel: "Discard page",
      danger: true,
    });
    if (confirmed) deleteM.mutate();
  };

  // While the page runs in the pipeline its files are being rewritten: follow the job and reload when it ends
  const job = usePageJobEvents(isBusy(pageQ.data?.page.status) ? id : null, () => {
    void qc.invalidateQueries({ queryKey: ["studio-page", id] });
    void qc.invalidateQueries({ queryKey: ["studio-history", id] });
  });

  const detail = pageQ.data;
  if (pageQ.isLoading) return <Loader2 className="m-4 animate-spin text-gray-500" />;
  if (!detail) return <p className="m-4 text-sm text-red-400">{pageQ.error?.message ?? "Page not found"}</p>;

  const { page, stages, blocks } = detail;
  const stageStatus = (name: string) => stages.find((s) => s.stage === name)?.status;
  const renderStage = stages.find((s) => s.stage === "render");
  const busy = isBusy(page.status);
  const textBlocks = blocks.filter((b) => b.kind === "text");
  const sfxCount = blocks.length - textBlocks.length;
  const version = `${page.updated_at}-${page.revision}-${renderStage?.updated_at ?? ""}`;
  const actionError = renderM.error ?? translateAllM.error ?? publishM.error ?? deleteM.error;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-800">
        <Link to="/studio" className="text-gray-400 hover:text-white" title="All pages">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-base font-semibold truncate">Page {page.id.slice(-8)}</h1>
        <StatusBadge status={page.status} />
        <span className="text-xs text-gray-500">rev {page.revision}</span>
        <div className="flex flex-wrap gap-1.5">
          {stages.map((s) => (
            <span key={s.stage} title={s.error ?? s.updated_at}>
              <StatusBadge status={s.status} label={s.stage} />
            </span>
          ))}
        </div>

        <div className="flex items-center rounded-md border border-gray-700 overflow-hidden text-xs" role="group" aria-label="Editor view">
          {(["canvas", "compare"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setView(value)}
              aria-pressed={view === value}
              className={`px-2.5 py-1 ${view === value ? "bg-indigo-600 text-white" : "text-gray-400 hover:bg-gray-800"}`}
            >
              {value === "canvas" ? "Canvas" : "Compare"}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {actionError && <span className="text-xs text-red-400">{actionError.message}</span>}
          <button
            onClick={() => void confirmDelete()}
            disabled={busy || deleteM.isPending}
            title={busy ? "Can't discard while the page is being translated" : "Discard this page and all its images"}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-300 bg-gray-800 hover:bg-red-900/60 hover:text-red-200 disabled:opacity-50 transition-colors"
          >
            {deleteM.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Delete page
          </button>
          {published && !publishM.isPending && (
            <span className="text-xs text-emerald-400">
              Published rev {published.revision} · {published.notified} open tab{published.notified === 1 ? "" : "s"} updated
            </span>
          )}
          <ActionButton
            onClick={() => afterSaves("translate-all", () => translateAllM.mutate())}
            disabled={busy || translateAllM.isPending || queued.has("translate-all")}
            pending={translateAllM.isPending}
            highlight={stageStatus("translate") === "stale"}
            icon={<Languages size={14} />}
            label="Translate all"
          />
          <ActionButton
            onClick={() => afterSaves("render", () => renderM.mutate())}
            disabled={busy || renderM.isPending || queued.has("render")}
            pending={renderM.isPending}
            highlight={stageStatus("render") === "stale"}
            icon={<RefreshCw size={14} />}
            label="Re-render"
          />
          <button
            onClick={() => afterSaves("publish", () => publishM.mutate())}
            disabled={busy || publishM.isPending || queued.has("publish") || !page.has_result || renderStage?.status === "stale"}
            title={renderStage?.status === "stale" ? "Re-render before publishing" : "Replace the image in open extension tabs"}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {publishM.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Publish
          </button>
        </div>
      </div>

      {busy ? (
        <ProcessingView pageId={page.id} status={page.status} version={version} job={job} />
      ) : (
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {view === "canvas" ? (
          <PageCanvas
            pageId={page.id}
            imageUrl={pageFileUrl(page.id, canvasImage, version)}
            page={{ width: page.width, height: page.height }}
            blocks={blocks}
            disabled={busy}
            selectedId={selectedBlock}
            onSelect={setSelectedBlock}
            onDetail={setDetail}
            onReload={() => void qc.invalidateQueries({ queryKey: ["studio-page", id] })}
            toolbarStart={
              <select
                aria-label="Canvas background image"
                value={canvasImage}
                onChange={(e) => {
                  setCanvasImage(PAGE_IMAGES.find((img) => img.file === e.target.value)?.file ?? canvasImage);
                  // Hand the keyboard back to the canvas so Delete and the tool keys work right away
                  e.currentTarget.blur();
                }}
                className="bg-gray-900 border border-gray-700 rounded-md px-2 py-1 text-xs"
              >
                {PAGE_IMAGES.map((img) => (
                  <option key={img.file} value={img.file}>{img.label}</option>
                ))}
              </select>
            }
          />
        ) : (
          <StageCompare pageId={page.id} version={version} />
        )}

        <aside className="lg:w-96 shrink-0 border-t lg:border-t-0 lg:border-l border-gray-800 overflow-y-auto p-3 space-y-3">
          <div className="text-xs text-gray-500">
            {textBlocks.length} text block{textBlocks.length === 1 ? "" : "s"} · {sfxCount} sound effect{sfxCount === 1 ? "" : "s"}
          </div>
          {textBlocks.map((block) => (
            <BlockEditor key={block.id} pageId={page.id} block={block} disabled={busy} onChanged={setDetail} trackSave={trackSave} afterSaves={afterSaves} queued={queued} selected={selectedBlock === block.id} onSelect={() => setSelectedBlock(block.id)} />
          ))}
          <HistoryPanel pageId={page.id} currentRevision={page.revision} disabled={busy} onRolledBack={onPublished} />
        </aside>
      </div>
      )}
    </div>
  );
}

/** Shown while the page runs in the pipeline (e.g. re-submitted from the extension): the original dimmed, with live progress. */
function ProcessingView({ pageId, status, version, job }: {
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

function ActionButton({ onClick, disabled, pending, highlight, icon, label }: {
  onClick: () => void;
  disabled: boolean;
  pending: boolean;
  /** Stage is stale: draw attention to the button that refreshes it. */
  highlight: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors ${
        highlight ? "bg-amber-600 hover:bg-amber-500" : "bg-gray-800 hover:bg-gray-700"
      }`}
    >
      {pending ? <Loader2 size={14} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

/** Two stage images on top of each other with a slider revealing the left one. */
function StageCompare({ pageId, version }: { pageId: string; version: string }) {
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

/** A textarea that saves when it loses focus, and follows the server value when that changes. */
function useSavedText(saved: string) {
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  return { text, setText, dirty: text !== saved };
}

/** One text block: editable source text and translation, plus per-block OCR and translation re-runs. */
function BlockEditor({ pageId, block, disabled, onChanged, trackSave, afterSaves, queued, selected, onSelect }: {
  pageId: string;
  block: StudioBlock;
  disabled: boolean;
  onChanged: (detail: StudioPageDetail) => void;
  /** Registers an in-flight save so page actions wait for it. */
  trackSave: (save: Promise<unknown>) => void;
  /** Runs the action once every pending save has succeeded; a second call with the same key while queued is ignored. */
  afterSaves: (key: string, action: () => void) => void;
  /** Keys of actions currently waiting on saves. */
  queued: ReadonlySet<string>;
  /** Selected on the canvas: highlighted and scrolled into view. */
  selected: boolean;
  onSelect: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  const ocrKey = `block:${block.id}:ocr`;
  const translateKey = `block:${block.id}:translate`;
  const source = useSavedText(block.source_text ?? "");
  const translation = useSavedText(block.translated_text ?? "");
  const saveM = useMutation({
    mutationFn: (text: { source_text?: string; translated_text?: string }) => updateBlockText(pageId, block.id, text),
    onSuccess: onChanged,
  });
  const runM = useMutation({
    mutationFn: (stage: "ocr" | "translate") => runStage(pageId, stage, [block.id]),
    onSuccess: onChanged,
  });
  const locked = disabled || runM.isPending;
  const error = saveM.error ?? runM.error;

  return (
    <div
      ref={cardRef}
      onClick={onSelect}
      className={`bg-gray-900 border rounded-lg p-2.5 space-y-1.5 transition-colors ${selected ? "border-sky-400" : "border-gray-800"}`}
    >
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold text-sky-400">#{block.id}</span>
        {block.render && !block.render.fits && (
          <span className="flex items-center gap-1 text-amber-400" title="The text did not fit its area">
            <TriangleAlert size={12} /> overflow
          </span>
        )}
        {block.render && <span className="text-gray-500">{block.render.font_size}px</span>}
        {(saveM.isPending || runM.isPending) && <Loader2 size={12} className="animate-spin text-gray-500" />}
        {(source.dirty || translation.dirty) && !saveM.isPending && <span className="text-amber-400">unsaved</span>}
        <span className="ml-auto flex gap-1">
          <IconButton title="Read the text again (OCR)" disabled={locked || queued.has(ocrKey)} onClick={() => afterSaves(ocrKey, () => runM.mutate("ocr"))}>
            <ScanText size={13} />
          </IconButton>
          <IconButton title="Translate again" disabled={locked || queued.has(translateKey) || !source.text.trim()} onClick={() => afterSaves(translateKey, () => runM.mutate("translate"))}>
            <Languages size={13} />
          </IconButton>
        </span>
      </div>
      <textarea
        value={source.text}
        disabled={locked}
        onChange={(e) => source.setText(e.target.value)}
        onBlur={() => source.dirty && trackSave(saveM.mutateAsync({ source_text: source.text }))}
        rows={Math.min(4, Math.max(1, Math.ceil(source.text.length / 20)))}
        placeholder="Source text"
        className="w-full resize-y bg-gray-950/60 border border-gray-800 rounded-md px-2 py-1 text-sm text-gray-400 focus:outline-none focus:border-indigo-500"
      />
      <textarea
        value={translation.text}
        disabled={locked}
        onChange={(e) => translation.setText(e.target.value)}
        onBlur={() => translation.dirty && trackSave(saveM.mutateAsync({ translated_text: translation.text }))}
        rows={Math.min(6, Math.max(2, Math.ceil(translation.text.length / 40)))}
        placeholder="Translation"
        className="w-full resize-y bg-gray-950 border border-gray-700 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
      />
      {error && <p className="text-xs text-red-400">{error.message}</p>}
    </div>
  );
}

function IconButton({ title, disabled, onClick, children }: { title: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Earlier publishes with thumbnails; restoring one publishes it again as a new revision. */
function HistoryPanel({ pageId, currentRevision, disabled, onRolledBack }: {
  pageId: string;
  currentRevision: number;
  disabled: boolean;
  onRolledBack: (result: { revision: number; notified: number }) => void;
}) {
  const historyQ = useQuery({ queryKey: ["studio-history", pageId], queryFn: () => listHistory(pageId) });
  const rollbackM = useMutation({ mutationFn: (revision: number) => rollbackPage(pageId, revision), onSuccess: onRolledBack });
  const entries = historyQ.data ?? [];

  return (
    <div className="pt-2 border-t border-gray-800 space-y-2">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <History size={13} /> Published revisions
      </div>
      {entries.length === 0 && <p className="text-xs text-gray-600">Nothing published yet.</p>}
      {rollbackM.error && <p className="text-xs text-red-400">{rollbackM.error.message}</p>}
      <div className="grid grid-cols-3 gap-2">
        {entries.map((entry) => (
          <div key={entry.revision} className="flex flex-col gap-1">
            <a href={historyImageUrl(pageId, entry.revision)} target="_blank" rel="noreferrer" className="block aspect-[2/3] bg-gray-950 rounded overflow-hidden border border-gray-800 hover:border-indigo-500">
              <img src={historyImageUrl(pageId, entry.revision)} alt={`Revision ${entry.revision}`} loading="lazy" className="w-full h-full object-contain" />
            </a>
            <div className="flex items-center justify-between text-xs">
              <span className={entry.revision === currentRevision ? "text-emerald-400" : "text-gray-500"} title={entry.published_at}>
                rev {entry.revision}
              </span>
              {entry.revision !== currentRevision && (
                <button
                  title="Publish this revision again"
                  disabled={disabled || rollbackM.isPending}
                  onClick={() => rollbackM.mutate(entry.revision)}
                  className="text-gray-400 hover:text-white disabled:opacity-40"
                >
                  <RotateCcw size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
