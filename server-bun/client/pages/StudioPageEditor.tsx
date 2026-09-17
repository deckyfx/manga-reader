import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlignCenter, AlignLeft, AlignRight, ArrowLeft, Eraser, History, Languages, Loader2, Megaphone, PanelRightClose, PanelRightOpen, RefreshCw, RotateCcw, ScanText, Send, Trash2, TriangleAlert } from "lucide-react";
import {
  deleteBlock,
  deletePage,
  getPage,
  historyImageUrl,
  listHistory,
  PAGE_IMAGES,
  pageFileUrl,
  placeText,
  publishPage,
  rollbackPage,
  runStage,
  updateBlock,
  type FontVariant,
  type TextAlign,
  type TextStyle,
  type PageImage,
  type StudioBlock,
  type StudioPageDetail,
} from "../api";
import { ActionsMenu, type MenuAction } from "../components/ActionsMenu";
import { useConfirm } from "../components/ConfirmDialog";
import { JobProgress } from "../components/JobProgress";
import { StatusBadge } from "../components/StatusBadge";
import { usePageJobEvents } from "../hooks/usePageJobEvents";
import { PageCanvas, type PageCanvasHandle } from "../studio/canvas/PageCanvas";
import { buildLettering, relayoutBlock, useTypesetter } from "../studio/text/typesetter";

const isBusy = (status: string | undefined) => status === "queued" || status === "running";

const PANEL_COLLAPSED_KEY = "studio-editor-panel-collapsed";

/** Saved side-panel state; storage can be unavailable (private mode), so default to expanded. */
function readPanelCollapsed(): boolean {
  try {
    return localStorage.getItem(PANEL_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

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
  const [panelCollapsed, setPanelCollapsedState] = useState(readPanelCollapsed);
  const setPanelCollapsed = (collapsed: boolean) => {
    setPanelCollapsedState(collapsed);
    try {
      localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // Not persisted; the choice still applies for this visit
    }
  };
  const canvasHandle = useRef<PageCanvasHandle>(null);
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
  const deleteBlockM = useMutation({
    mutationFn: (blockId: number) => deleteBlock(id, blockId),
    onSuccess: (next) => {
      setDetail(next);
      setSelectedBlock(null);
    },
  });
  /** Deletes a region: undoable through the canvas when it's open, otherwise after a confirmation. */
  const removeBlock = async (blockId: number) => {
    if (canvasHandle.current) {
      canvasHandle.current.deleteBlock(blockId);
      return;
    }
    const confirmed = await confirm({
      title: `Delete region #${blockId}?`,
      message: "Its text, translation and lettering are removed. Outside the canvas this can't be undone.",
      confirmLabel: "Delete region",
      danger: true,
    });
    if (confirmed) deleteBlockM.mutate(blockId);
  };
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

  /** Shows a block's style right away; the save that follows replaces it with the server's answer. */
  const setBlockStyle = useCallback((blockId: number, style: TextStyle | null) => {
    qc.setQueryData<StudioPageDetail>(["studio-page", id], (current) =>
      current && { ...current, blocks: current.blocks.map((b) => (b.id === blockId ? { ...b, style } : b)) });
  }, [qc, id]);

  /** Shows typed lettering right away; the save that follows replaces it with the server's answer. */
  const setBlockText = useCallback((blockId: number, text: string) => {
    qc.setQueryData<StudioPageDetail>(["studio-page", id], (current) =>
      current && { ...current, blocks: current.blocks.map((b) => (b.id === blockId ? { ...b, translated_text: text } : b)) });
  }, [qc, id]);

  // Lettering as the burn would draw it, from the same shared typesetter the server uses
  const { typesetter, error: typesetterError } = useTypesetter();
  const previewDetail = pageQ.data;
  const letteringPlan = useMemo(
    () => (typesetter && previewDetail ? buildLettering(previewDetail, typesetter) : { items: [], pageFontSize: 0 }),
    [typesetter, previewDetail],
  );
  const relayout = useCallback(
    (blockId: number, box: { x: number; y: number; w: number; h: number }) =>
      typesetter && previewDetail ? relayoutBlock(typesetter, previewDetail, blockId, box, letteringPlan.pageFontSize) : null,
    [typesetter, previewDetail, letteringPlan.pageFontSize],
  );

  // Blocks without a found text area (never placed, or moved since) are placed automatically, without a burn, so the
  // lettering preview doesn't wait for one. Each set of missing blocks is tried once, so a block with no room can't loop.
  const placeTried = useRef("");
  useEffect(() => {
    const current = pageQ.data;
    if (!current || isBusy(current.page.status)) return;
    if (!current.page.has_result && !current.stages.some((stage) => stage.stage === "clean_text")) return;
    const missing = current.blocks.filter((b) => (b.kind === "text" || b.kind === "sfx") && !b.area);
    if (missing.length === 0) return;
    const signature = JSON.stringify(missing.map((b) => [b.id, b.x, b.y, b.w, b.h]));
    if (placeTried.current === signature) return;
    const timer = setTimeout(() => {
      placeTried.current = signature;
      placeText(id).then((next) => qc.setQueryData(["studio-page", id], next), () => {});
    }, 700);
    return () => clearTimeout(timer);
  }, [pageQ.data, id, qc]);

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
  const actionError = cleanTextM.error ?? cleanSfxM.error ?? renderM.error ?? translateAllM.error ?? publishM.error ?? deleteM.error ?? deleteBlockM.error;

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
      label: "Burn lettering",
      icon: <RefreshCw size={14} />,
      hint: "Draw the lettering into the page image",
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
            ref={canvasHandle}
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
            lettering={letteringPlan.items}
            textPreviewAvailable={canvasImage === "clean-text.png" || canvasImage === "clean-sfx.png"}
            onStylePreview={setBlockStyle}
            relayout={relayout}
            onModeChange={(mode) => {
              // Lettering is judged against the cleaned page, where it will be burned
              if (mode === "lettering" && canvasImage !== "clean-text.png" && canvasImage !== "clean-sfx.png") {
                setCanvasImage(stageStatus("clean_sfx") === "fresh" ? "clean-sfx.png" : "clean-text.png");
              }
            }}
            renderLetteringPanel={(blockId) => {
              const block = blocks.find((b) => b.id === blockId);
              return block ? (
                <LetteringPanel
                  key={block.id}
                  pageId={page.id}
                  block={block}
                  disabled={busy}
                  onChanged={setDetail}
                  trackSave={trackSave}
                  setBlockStyle={setBlockStyle}
                  setBlockText={setBlockText}
                  onDelete={() => void removeBlock(block.id)}
                />
              ) : null;
            }}
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

        {panelCollapsed ? (
        <aside className="shrink-0 border-t lg:border-t-0 lg:border-l border-gray-800 p-1.5 flex lg:flex-col items-center gap-2">
          <button
            onClick={() => setPanelCollapsed(false)}
            title="Show the side panel"
            aria-label="Show the side panel"
            className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-800"
          >
            <PanelRightOpen size={16} />
          </button>
          <span className="text-[11px] text-gray-500 lg:[writing-mode:vertical-rl]">{blocks.length} regions</span>
        </aside>
        ) : (
        <aside className="lg:w-96 shrink-0 border-t lg:border-t-0 lg:border-l border-gray-800 overflow-y-auto p-3 space-y-3">
          {/* Stays in view while the list scrolls, so the panel can be collapsed from anywhere */}
          <div className="sticky -top-3 z-10 -mx-3 -mt-3 px-3 pt-3 pb-2 flex items-center gap-2 text-xs text-gray-500 bg-gray-950/95 backdrop-blur border-b border-gray-800/60">
            {textBlocks.length} text block{textBlocks.length === 1 ? "" : "s"} · {sfxBlocks.length} sound effect{sfxBlocks.length === 1 ? "" : "s"}
            <button
              onClick={() => setPanelCollapsed(true)}
              title="Hide the side panel for more room"
              aria-label="Hide the side panel"
              className="ml-auto p-1 rounded-md text-gray-400 hover:text-white hover:bg-gray-800"
            >
              <PanelRightClose size={15} />
            </button>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
            <span title="Speech bubbles and captions: read with OCR, translated, removed by Clean text, lettered with the translation">
              <span className="inline-block h-2 w-2 rounded-sm bg-sky-400 mr-1 align-middle" />Text: OCR → translate → Clean text
            </span>
            <span title="Drawn sound effects: not read or translated; removed by Clean SFX when ticked; lettered only when you type new lettering">
              <span className="inline-block h-2 w-2 rounded-sm bg-orange-400 mr-1 align-middle" />Sound effect: Clean SFX, optional new lettering
            </span>
          </div>
          {typesetterError && <p className="text-xs text-red-400">Lettering preview unavailable: {typesetterError}</p>}
          {textBlocks.map((block) => (
            <BlockEditor key={block.id} pageId={page.id} block={block} disabled={busy} onChanged={setDetail} trackSave={trackSave} afterSaves={afterSaves} queued={queued} selected={selectedBlock === block.id} onSelect={() => setSelectedBlock(block.id)} setBlockStyle={setBlockStyle} onDelete={() => void removeBlock(block.id)} />
          ))}
          {sfxBlocks.length > 0 && (
            <div className="pt-2 border-t border-gray-800 space-y-1.5">
              <div className="text-xs text-gray-400">Sound effects · ticked ones are removed by Clean SFX; give one lettering to draw it again</div>
              {sfxBlocks.map((block) => (
                <SfxBlockRow key={block.id} pageId={page.id} block={block} disabled={busy} onChanged={setDetail} trackSave={trackSave} selected={selectedBlock === block.id} onSelect={() => setSelectedBlock(block.id)} setBlockStyle={setBlockStyle} onDelete={() => void removeBlock(block.id)} />
              ))}
            </div>
          )}
          <HistoryPanel pageId={page.id} currentRevision={page.revision} disabled={busy} onRolledBack={onPublished} />
        </aside>
        )}
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
function BlockEditor({ pageId, block, disabled, onChanged, trackSave, afterSaves, queued, selected, onSelect, setBlockStyle, onDelete }: {
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
  setBlockStyle: (blockId: number, style: TextStyle | null) => void;
  onDelete: () => void;
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
          <IconButton title="Delete this region" disabled={locked} onClick={onDelete}>
            <Trash2 size={13} />
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
      <StyleEditor pageId={pageId} block={block} disabled={locked} onChanged={onChanged} trackSave={trackSave} setBlockStyle={setBlockStyle} />
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

/** One sound-effect region: selectable, with its include-in-cleaning toggle and optional new lettering. */
function SfxBlockRow({ pageId, block, disabled, onChanged, trackSave, selected, onSelect, setBlockStyle, onDelete }: {
  pageId: string;
  block: StudioBlock;
  disabled: boolean;
  onChanged: (detail: StudioPageDetail) => void;
  trackSave: (save: Promise<unknown>) => void;
  selected: boolean;
  onSelect: () => void;
  setBlockStyle: (blockId: number, style: TextStyle | null) => void;
  onDelete: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  const lettering = useSavedText(block.translated_text ?? "");
  const saveM = useMutation({
    mutationFn: (text: string) => updateBlock(pageId, block.id, { translated_text: text }),
    onSuccess: onChanged,
  });
  return (
    <div
      ref={rowRef}
      onClick={onSelect}
      className={`bg-gray-900 border rounded-lg px-2.5 py-1.5 text-xs space-y-1.5 cursor-pointer transition-colors ${selected ? "border-orange-400" : "border-gray-800"}`}
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold text-orange-400">#{block.id}</span>
        <span className="text-gray-500 tabular-nums">{block.w}×{block.h}</span>
        {saveM.isPending && <Loader2 size={12} className="animate-spin text-gray-500" />}
        <span className="ml-auto">
          <IncludeToggle pageId={pageId} block={block} disabled={disabled} onChanged={onChanged} trackSave={trackSave} title="Remove this sound effect when SFX are cleaned" />
        </span>
        <IconButton title="Delete this region" disabled={disabled} onClick={onDelete}>
          <Trash2 size={13} />
        </IconButton>
      </div>
      <textarea
        value={lettering.text}
        disabled={disabled}
        onChange={(e) => lettering.setText(e.target.value)}
        onBlur={() => lettering.dirty && trackSave(saveM.mutateAsync(lettering.text))}
        rows={1}
        placeholder="New lettering (optional)"
        className="w-full resize-y bg-gray-950 border border-gray-800 rounded-md px-2 py-1 text-sm focus:outline-none focus:border-indigo-500"
      />
      {saveM.error && <p className="text-red-400">{saveM.error.message}</p>}
      {lettering.text.trim() !== "" && (
        <StyleEditor pageId={pageId} block={block} disabled={disabled} onChanged={onChanged} trackSave={trackSave} setBlockStyle={setBlockStyle} />
      )}
    </div>
  );
}

/**
 * Saves the latest value after `delay` ms without changes. The save is registered with `trackSave` as soon as it's
 * scheduled (not when the timer fires), so page actions such as Burn lettering or Publish wait for edits made just
 * before them. A save still pending when the component goes away is sent right then.
 */
function useDebouncedSave<T>(delay: number, save: (value: T) => Promise<unknown>, trackSave: (save: Promise<unknown>) => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ save, trackSave });
  latest.current = { save, trackSave };
  const pending = useRef<{ value: T; resolve: () => void; reject: (err: unknown) => void } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    setSaving(true);
    latest.current.save(next.value)
      .then(
        () => {
          setError(null);
          next.resolve();
        },
        (err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
          next.reject(err);
        },
      )
      .finally(() => setSaving(false));
  }, []);
  useEffect(() => flush, [flush]);

  const schedule = (value: T) => {
    if (pending.current) {
      pending.current.value = value;
    } else {
      let settle: { resolve: () => void; reject: (err: unknown) => void } = { resolve: () => {}, reject: () => {} };
      const promise = new Promise<void>((resolve, reject) => {
        settle = { resolve, reject };
      });
      pending.current = { value, ...settle };
      latest.current.trackSave(promise);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };

  return { schedule, flush, saving, error };
}

/** Drops unset fields; an empty style means automatic lettering. */
function compactStyle(style: TextStyle): TextStyle | null {
  const next = { ...style } as Record<string, unknown>;
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  return Object.keys(next).length > 0 ? (next as TextStyle) : null;
}

/**
 * Lettering overrides for one block. Changes show in the canvas preview at once and are saved after a short pause
 * (page actions wait for the save); a save still pending when the panel goes away is sent right then.
 */
function StyleEditor({ pageId, block, disabled, onChanged, trackSave, setBlockStyle, open = false }: {
  pageId: string;
  block: StudioBlock;
  disabled: boolean;
  onChanged: (detail: StudioPageDetail) => void;
  trackSave: (save: Promise<unknown>) => void;
  setBlockStyle: (blockId: number, style: TextStyle | null) => void;
  /** Starts expanded (the floating lettering panel). */
  open?: boolean;
}) {
  const style = (block.style ?? {}) as TextStyle;
  const { schedule, saving, error } = useDebouncedSave<TextStyle | null>(
    400,
    (next) => updateBlock(pageId, block.id, { style: next }).then(onChanged),
    trackSave,
  );

  const change = (patch: Partial<TextStyle>) => {
    const next = compactStyle({ ...style, ...patch });
    setBlockStyle(block.id, next);
    schedule(next);
  };

  const custom = block.style !== null && Object.keys(style).length > 0;
  const previewable = !!style.box || !!block.area || block.kind === "sfx";

  return (
    <details open={open || undefined} className="rounded-md border border-gray-800 bg-gray-950/40">
      <summary className="cursor-pointer select-none px-2 py-1 text-xs text-gray-400 flex items-center gap-2">
        Lettering
        {custom && <span className="text-violet-300">custom</span>}
        {!previewable && <span className="text-gray-600">· placing…</span>}
        {saving && <Loader2 size={11} className="animate-spin" />}
      </summary>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-2 pb-2 pt-1 text-xs text-gray-400">
        <label className="flex items-center justify-between gap-2">
          Font
          <select
            value={style.font ?? "bold"}
            disabled={disabled}
            onChange={(e) => change({ font: e.target.value === "bold" ? undefined : (e.target.value as FontVariant) })}
            className="bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-gray-200"
          >
            <option value="regular">Regular</option>
            <option value="bold">Bold</option>
            <option value="italic">Italic</option>
          </select>
        </label>
        <NumberField label="Size" value={style.font_size} min={6} max={400} step={1} placeholder="auto" disabled={disabled}
          onChange={(v) => change({ font_size: v === undefined ? undefined : Math.round(v) })} />
        <ColorField label="Fill" value={style.fill} fallback="#000000" disabled={disabled} onChange={(v) => change({ fill: v })} />
        <ColorField label="Outline" value={style.stroke} fallback="#ffffff" disabled={disabled} onChange={(v) => change({ stroke: v })} />
        <NumberField label="Outline px" value={style.stroke_width} min={0} max={60} step={0.5} placeholder="auto" disabled={disabled}
          onChange={(v) => change({ stroke_width: v })} />
        <NumberField label="Line height" value={style.line_height} min={0.6} max={3} step={0.05} placeholder="1.1" disabled={disabled}
          onChange={(v) => change({ line_height: v })} />
        <div className="flex items-center justify-between gap-2">
          Align
          <span className="flex rounded border border-gray-700 overflow-hidden" role="group" aria-label="Alignment">
            {([["left", <AlignLeft size={12} />], ["center", <AlignCenter size={12} />], ["right", <AlignRight size={12} />]] as [TextAlign, ReactNode][]).map(([value, icon]) => (
              <button
                key={value}
                type="button"
                disabled={disabled}
                aria-pressed={(style.align ?? "center") === value}
                aria-label={`Align ${value}`}
                onClick={() => change({ align: value === "center" ? undefined : value })}
                className={`px-1.5 py-1 ${(style.align ?? "center") === value ? "bg-gray-700 text-white" : "hover:bg-gray-800"}`}
              >
                {icon}
              </button>
            ))}
          </span>
        </div>
        <NumberField label="Rotation °" value={style.rotation} min={-180} max={180} step={1} placeholder="0" disabled={disabled}
          onChange={(v) => change({ rotation: v === 0 ? undefined : v })} />
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={style.uppercase ?? true}
            disabled={disabled}
            onChange={(e) => change({ uppercase: e.target.checked ? undefined : false })}
            className="accent-indigo-500"
          />
          Capitals
        </label>
        <div className="flex items-center justify-end">
          {style.box || style.offset ? (
            <button type="button" disabled={disabled} onClick={() => change({ box: undefined, offset: undefined })} className="text-violet-300 hover:text-violet-200 disabled:opacity-40">
              Back to bubble
            </button>
          ) : (
            <span className="text-gray-600" title="In Lettering mode (L), drag the lettering to move it or its handles to resize and rotate">In bubble</span>
          )}
        </div>
        <button
          type="button"
          disabled={disabled || !custom}
          onClick={() => change({ font: undefined, font_size: undefined, fill: undefined, stroke: undefined, stroke_width: undefined, align: undefined, line_height: undefined, uppercase: undefined, rotation: undefined, box: undefined, offset: undefined })}
          className="col-span-2 justify-self-start text-gray-400 hover:text-white disabled:opacity-40"
        >
          Reset to automatic
        </button>
      </div>
      {error && <p className="px-2 pb-2 text-xs text-red-400">{error}</p>}
    </details>
  );
}

/**
 * The floating editor next to selected lettering (Lettering mode): its text, drawn live on the page as you type and
 * saved after a short pause, and its style.
 */
function LetteringPanel({ pageId, block, disabled, onChanged, trackSave, setBlockStyle, setBlockText, onDelete }: {
  pageId: string;
  block: StudioBlock;
  disabled: boolean;
  onChanged: (detail: StudioPageDetail) => void;
  trackSave: (save: Promise<unknown>) => void;
  setBlockStyle: (blockId: number, style: TextStyle | null) => void;
  setBlockText: (blockId: number, text: string) => void;
  onDelete: () => void;
}) {
  const saved = block.translated_text ?? "";
  const [text, setText] = useState(saved);
  const editing = useRef(false);
  // Follow the server value unless the user is typing here
  useEffect(() => {
    if (!editing.current) setText(saved);
  }, [saved]);
  const { schedule: scheduleText, flush: flushText, saving, error } = useDebouncedSave<string>(
    600,
    (next) => updateBlock(pageId, block.id, { translated_text: next }).then(onChanged),
    trackSave,
  );

  const isSfx = block.kind === "sfx";
  return (
    <div className="p-2.5 space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <span className={`font-semibold ${isSfx ? "text-orange-400" : "text-sky-400"}`}>#{block.id}</span>
        <span className="text-gray-400">{isSfx ? "Sound effect lettering" : "Text lettering"}</span>
        {saving && <Loader2 size={11} className="animate-spin text-gray-500" />}
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          title="Delete this region (Ctrl+Z undoes it)"
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-gray-400 hover:bg-red-900/50 hover:text-red-200 disabled:opacity-40"
        >
          <Trash2 size={12} />
          Delete
        </button>
      </div>
      <textarea
        data-lettering-text
        value={text}
        disabled={disabled}
        rows={3}
        onFocus={() => {
          editing.current = true;
        }}
        onBlur={() => {
          editing.current = false;
          flushText();
        }}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          setBlockText(block.id, next);
          scheduleText(next);
        }}
        placeholder={isSfx ? "New lettering for this sound effect" : "Translation"}
        className="w-full resize-y bg-gray-950 border border-gray-700 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-violet-500"
      />
      {error && <p className="text-red-400">{error}</p>}
      {text.trim() === "" && <p className="text-gray-500">Type to letter this {isSfx ? "sound effect" : "block"}.</p>}
      <StyleEditor pageId={pageId} block={block} disabled={disabled} onChanged={onChanged} trackSave={trackSave} setBlockStyle={setBlockStyle} open />
    </div>
  );
}

/** A number input that only reports values inside [min, max]; empty means unset. Shows the saved value on blur. */
function NumberField({ label, value, min, max, step, placeholder, disabled, onChange }: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  step: number;
  placeholder: string;
  disabled: boolean;
  onChange: (value: number | undefined) => void;
}) {
  const shown = value === undefined ? "" : String(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  return (
    <label className="flex items-center justify-between gap-2">
      {label}
      <input
        type="number"
        inputMode="decimal"
        value={text}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (next === "") return onChange(undefined);
          const n = Number(next);
          if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={() => setText(shown)}
        className="w-16 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-right text-gray-200 tabular-nums"
      />
    </label>
  );
}

/** A colour that is automatic (by background brightness) until its box is ticked. */
function ColorField({ label, value, fallback, disabled, onChange }: {
  label: string;
  value: string | undefined;
  fallback: string;
  disabled: boolean;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="flex items-center gap-1.5" title="Tick for a fixed colour; unticked picks black or white by the background">
        <input
          type="checkbox"
          checked={value !== undefined}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? fallback : undefined)}
          className="accent-indigo-500"
        />
        {label}
      </label>
      <input
        type="color"
        aria-label={`${label} colour`}
        value={value ?? fallback}
        disabled={disabled || value === undefined}
        onChange={(e) => onChange(e.target.value)}
        className="h-5 w-8 bg-transparent disabled:opacity-40"
      />
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
