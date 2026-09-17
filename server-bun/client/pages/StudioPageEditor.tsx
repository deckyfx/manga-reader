import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eraser, History, Languages, Loader2, Megaphone, RefreshCw, RotateCcw, ScanText, Send, Trash2, TriangleAlert } from "lucide-react";
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
  updateBlock,
  type PageImage,
  type StudioBlock,
  type StudioPageDetail,
} from "../api";
import { ActionsMenu, type MenuAction } from "../components/ActionsMenu";
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
  /** Bumped when a cleaned image is rewritten, so image URLs change and the browser loads the new file. */
  const [imagesNonce, setImagesNonce] = useState(0);

  const [published, setPublished] = useState<{ revision: number; notified: number } | null>(null);
  const onPublished = (result: { revision: number; notified: number }) => {
    setPublished(result);
    void qc.invalidateQueries({ queryKey: ["studio-page", id] });
    void qc.invalidateQueries({ queryKey: ["studio-history", id] });
  };
  const renderM = useMutation({ mutationFn: () => runStage(id, "render"), onSuccess: setDetail });
  const translateAllM = useMutation({ mutationFn: () => runStage(id, "translate"), onSuccess: setDetail });
  const afterClean = (detail: StudioPageDetail) => {
    setDetail(detail);
    setImagesNonce((n) => n + 1);
  };
  const cleanTextM = useMutation({ mutationFn: () => runStage(id, "clean_text"), onSuccess: afterClean });
  const cleanSfxM = useMutation({ mutationFn: () => runStage(id, "clean_sfx"), onSuccess: afterClean });
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
  const sfxBlocks = blocks.filter((b) => b.kind !== "text");
  const version = `${page.updated_at}-${page.revision}-${renderStage?.updated_at ?? ""}-${imagesNonce}`;
  const cleaning = cleanTextM.isPending || cleanSfxM.isPending;
  const actionError = cleanTextM.error ?? cleanSfxM.error ?? renderM.error ?? translateAllM.error ?? publishM.error ?? deleteM.error;

  /** A stage's status in the latest page data: queued actions re-check it, since the saves they waited for can outdate it. */
  const latestStageStatus = (name: string) =>
    qc.getQueryData<StudioPageDetail>(["studio-page", id])?.stages.find((s) => s.stage === name)?.status;
  /** First reason in the list that applies, or undefined when the action can run. */
  const unavailableWhen = (...checks: [boolean, string][]): string | undefined => checks.find(([applies]) => applies)?.[1];
  const translating: [boolean, string] = [busy, "The page is being translated"];
  const textPassStatus = stageStatus("clean_text");
  const pageActions: MenuAction[] = [
    {
      key: "clean-text",
      label: "Clean text",
      icon: <Eraser size={14} />,
      hint: "Remove the lettering of text blocks",
      onSelect: () => afterSaves("clean-text", () => cleanTextM.mutate()),
      unavailable: unavailableWhen(translating, [cleaning, "A clean is already running"], [queued.has("clean-text"), "Waiting for edits to save"]),
      pending: cleanTextM.isPending,
      attention: textPassStatus === "stale",
    },
    {
      key: "clean-sfx",
      label: "Clean SFX",
      icon: <Megaphone size={14} />,
      hint: "Remove the ticked sound effects",
      onSelect: () => afterSaves("clean-sfx", () => {
        const textPass = latestStageStatus("clean_text");
        // A save it waited for (e.g. a "clean" toggle) may have outdated the text pass: the menu then shows why
        if (textPass === undefined || textPass === "fresh") cleanSfxM.mutate();
      }),
      // Sound effects are cleaned on top of the text pass: that one has to be current first
      unavailable: unavailableWhen(
        translating,
        [cleaning, "A clean is already running"],
        [queued.has("clean-sfx"), "Waiting for edits to save"],
        [textPassStatus !== undefined && textPassStatus !== "fresh", "Run Clean text first"],
      ),
      pending: cleanSfxM.isPending,
      attention: stageStatus("clean_sfx") === "stale",
    },
    {
      key: "translate-all",
      label: "Translate all",
      icon: <Languages size={14} />,
      hint: "Translate every text block again",
      onSelect: () => afterSaves("translate-all", () => translateAllM.mutate()),
      unavailable: unavailableWhen(translating, [translateAllM.isPending, "Already translating"], [queued.has("translate-all"), "Waiting for edits to save"]),
      pending: translateAllM.isPending,
      attention: stageStatus("translate") === "stale",
    },
    {
      key: "render",
      label: "Re-render",
      icon: <RefreshCw size={14} />,
      hint: "Typeset the translations again",
      onSelect: () => afterSaves("render", () => renderM.mutate()),
      unavailable: unavailableWhen(translating, [renderM.isPending, "Already rendering"], [queued.has("render"), "Waiting for edits to save"]),
      pending: renderM.isPending,
      attention: renderStage?.status === "stale",
    },
    {
      key: "publish",
      label: "Publish",
      icon: <Send size={14} />,
      hint: "Replace the image in open extension tabs",
      onSelect: () => afterSaves("publish", () => {
        // A text edit it waited for may have made the render stale: publishing would push the old image
        if (latestStageStatus("render") !== "stale") publishM.mutate();
      }),
      unavailable: unavailableWhen(
        translating,
        [publishM.isPending, "Already publishing"],
        [queued.has("publish"), "Waiting for edits to save"],
        [!page.has_result, "No result image yet"],
        [renderStage?.status === "stale", "Re-render before publishing"],
      ),
      pending: publishM.isPending,
    },
    {
      key: "delete",
      label: "Delete page",
      icon: <Trash2 size={14} />,
      hint: "Discard the page and all its images",
      onSelect: () => void confirmDelete(),
      unavailable: unavailableWhen([busy, "Can't discard while the page is being translated"], [deleteM.isPending, "Deleting…"]),
      pending: deleteM.isPending,
      danger: true,
      separated: true,
    },
  ];

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
          {published && !publishM.isPending && (
            <span className="text-xs text-emerald-400">
              Published rev {published.revision} · {published.notified} open tab{published.notified === 1 ? "" : "s"} updated
            </span>
          )}
          <ActionsMenu actions={pageActions} />
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
            onImagesChanged={() => setImagesNonce((n) => n + 1)}
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
            {textBlocks.length} text block{textBlocks.length === 1 ? "" : "s"} · {sfxBlocks.length} sound effect{sfxBlocks.length === 1 ? "" : "s"}
          </div>
          {textBlocks.map((block) => (
            <BlockEditor key={block.id} pageId={page.id} block={block} disabled={busy} onChanged={setDetail} trackSave={trackSave} afterSaves={afterSaves} queued={queued} selected={selectedBlock === block.id} onSelect={() => setSelectedBlock(block.id)} />
          ))}
          {sfxBlocks.length > 0 && (
            <div className="pt-2 border-t border-gray-800 space-y-1.5">
              <div className="text-xs text-gray-400">Sound effects · ticked ones are removed by Clean SFX</div>
              {sfxBlocks.map((block) => (
                <SfxBlockRow key={block.id} pageId={page.id} block={block} disabled={busy} onChanged={setDetail} trackSave={trackSave} selected={selectedBlock === block.id} onSelect={() => setSelectedBlock(block.id)} />
              ))}
            </div>
          )}
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
    mutationFn: (text: { source_text?: string; translated_text?: string }) => updateBlock(pageId, block.id, text),
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
        <IncludeToggle pageId={pageId} block={block} disabled={locked} onChanged={onChanged} trackSave={trackSave} title="Remove this block's lettering when the text is cleaned" />
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

/** Whether the clean pass removes a block; saved right away (the server marks the clean stages stale). */
function IncludeToggle({ pageId, block, disabled, onChanged, trackSave, title }: {
  pageId: string;
  block: StudioBlock;
  disabled: boolean;
  onChanged: (detail: StudioPageDetail) => void;
  /** Registers the save so Clean text / Clean SFX wait for it and clean with the new setting. */
  trackSave: (save: Promise<unknown>) => void;
  title: string;
}) {
  const includeM = useMutation({
    mutationFn: (include: boolean) => updateBlock(pageId, block.id, { include }),
    onSuccess: onChanged,
  });
  const checked = includeM.isPending && includeM.variables !== undefined ? includeM.variables : block.include;
  return (
    <label className="flex items-center gap-1 text-gray-400 cursor-pointer" title={includeM.error ? includeM.error.message : title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled || includeM.isPending}
        onChange={(e) => trackSave(includeM.mutateAsync(e.target.checked))}
        className="accent-indigo-500"
      />
      <span className={includeM.error ? "text-red-400" : undefined}>clean</span>
    </label>
  );
}

/** One sound-effect region: selectable, with its include-in-cleaning toggle. */
function SfxBlockRow({ pageId, block, disabled, onChanged, trackSave, selected, onSelect }: {
  pageId: string;
  block: StudioBlock;
  disabled: boolean;
  onChanged: (detail: StudioPageDetail) => void;
  trackSave: (save: Promise<unknown>) => void;
  selected: boolean;
  onSelect: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  return (
    <div
      ref={rowRef}
      onClick={onSelect}
      className={`flex items-center gap-2 bg-gray-900 border rounded-lg px-2.5 py-1.5 text-xs cursor-pointer transition-colors ${selected ? "border-orange-400" : "border-gray-800"}`}
    >
      <span className="font-semibold text-orange-400">#{block.id}</span>
      <span className="text-gray-500 tabular-nums">{block.w}×{block.h}</span>
      <span className="ml-auto">
        <IncludeToggle pageId={pageId} block={block} disabled={disabled} onChanged={onChanged} trackSave={trackSave} title="Remove this sound effect when SFX are cleaned" />
      </span>
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
