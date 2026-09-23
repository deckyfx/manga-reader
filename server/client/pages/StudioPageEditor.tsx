import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eraser,
  FolderInput,
  Languages,
  Loader2,
  Megaphone,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  deleteBlock,
  getChapter,
  getPage,
  PAGE_IMAGES,
  pageFileUrl,
  placeText,
  publishPage,
  rerunPage,
  runStage,
  type TextStyle,
  type PageImage,
  type StudioPageDetail,
  getWorkspace,
} from "../api";
import { ActionsMenu, type MenuAction } from "../components/ActionsMenu";
import { ChapterPicker } from "../components/ChapterPicker";
import { FinalizeDialog } from "../components/FinalizeDialog";
import { DiscardPageDialog } from "../components/DiscardPageDialog";
import { useConfirm } from "../components/ConfirmDialog";
import { pageStatus, StatusBadge } from "../components/StatusBadge";
import { usePageJobEvents } from "../hooks/usePageJobEvents";
import { PageCanvas, type PageCanvasHandle } from "../studio/canvas/PageCanvas";
import { buildLettering, relayoutBlock, useTypesetter } from "../studio/text/typesetter";
import { readToolset, saveToolset, toolsetScope } from "../studio/toolset";
import { useEditorPage, useEditorStore } from "../stores/editor";
import { ProcessingView, StageCompare, FinalizedView } from "../studio/editor/views";
import { BlockEditor, blockCheck, SfxBlockRow } from "../studio/editor/BlockRows";
import { LetteringPanel } from "../studio/editor/StyleEditor";
import { HistoryPanel } from "../studio/editor/HistoryPanel";

const isBusy = (status: string | undefined) => status === "queued" || status === "running";

/** The stage that writes each page image; the original is always there. */
const IMAGE_STAGE: Partial<Record<PageImage, string>> = {
  "overlay.png": "detect",
  "mask.png": "detect",
  "clean-text.png": "clean_text",
  "clean-sfx.png": "clean_sfx",
  "render-overlay.png": "render",
  "result.png": "render",
};

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

  // What the editor is showing: shared with the canvas, the block list and the lettering panel. Page-specific
  // state comes through useEditorPage, which holds the defaults until the store is this page's; the panel is a
  // habit of the person's, not a property of the page
  const { view, canvasImage, selectedBlock, imagesNonce } = useEditorPage(id);
  const panelCollapsed = useEditorStore((state) => state.panelCollapsed);
  const { setView, setCanvasImage, selectBlock: setSelectedBlock, setPanelCollapsed, imagesChanged } = useEditorStore.getState();
  // A page opens fresh: nothing selected, no image rewritten yet. In a layout effect, not during render: this
  // editor is keyed by page, so a render-phase reset would notify the outgoing editor while this one renders.
  useLayoutEffect(() => { useEditorStore.getState().openPage(id); }, [id]);
  /**
   * Whether this page is still the one the editor's state belongs to. Work started here can finish after the user
   * has moved on — a mutation's onSuccess runs whether or not the component is still mounted, and so do the
   * canvas's callbacks — and the state is shared, so without this a late arrival would clear the next page's
   * selected block or reload its images.
   */
  const stillOpen = (): boolean => useEditorStore.getState().pageId === id;
  /**
   * Selecting a block, but only while this page is the open one. The canvas selects the block it has just created,
   * which it can only do once the server has answered — by then the user may be on the next page, and the
   * selection is shared with it.
   */
  const selectBlock = (blockId: number | null): void => {
    if (stillOpen()) setSelectedBlock(blockId);
  };
  const canvasHandle = useRef<PageCanvasHandle>(null);

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
    if (stillOpen()) imagesChanged();
  };
  const cleanTextM = useMutation({ mutationFn: () => runStage(id, "clean_text"), onSuccess: afterClean });
  const cleanSfxM = useMutation({ mutationFn: () => runStage(id, "clean_sfx"), onSuccess: afterClean });
  const publishM = useMutation({ mutationFn: () => publishPage(id), onSuccess: onPublished });
  // The whole pipeline again from the original; the page turns busy and the processing view follows the job
  const rerunM = useMutation({
    mutationFn: () => rerunPage(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["studio-page", id] }),
  });
  const navigate = useNavigate();
  const [discarding, setDiscarding] = useState(false);
  const [filing, setFiling] = useState(false);
  /** The finalize dialog: finalizing the page, or (already finalized) deleting its original too. */
  const [finalizing, setFinalizing] = useState<"finalize" | "raw" | null>(null);
  const confirm = useConfirm();
  // A page inside a chapter can be walked through in reading order, without going back to Manage each time
  const chapterId = pageQ.data?.page.location?.chapter_id ?? null;
  const chapterQ = useQuery({
    queryKey: ["chapter", chapterId, "library"],
    queryFn: () => getChapter(chapterId ?? 0, true),
    enabled: chapterId !== null,
  });
  // A page in a workspace walks through that workspace, in its order — including one filed into a chapter, which
  // belongs to both; the workspace is what is being worked on
  const workspaceId = pageQ.data?.page.workspace_id ?? null;
  const workspaceQ = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => getWorkspace(workspaceId ?? 0),
    enabled: workspaceId !== null,
  });
  const neighbours = workspaceId !== null ? (workspaceQ.data?.pages ?? []) : (chapterQ.data?.pages ?? []);

  // The toolset is shared by the pages of a workspace (or chapter): this page opens with the view and stage image the
  // last one was left on, and the canvas restores its zoom, tool and brush the same way
  const toolScope = pageQ.data ? toolsetScope(workspaceId, chapterId) : null;
  // Once per editor, which is once per page: the route remounts the editor for each page (key={id}), so every page
  // runs this, and checks the saved image against its own stages
  const restoredScope = useRef<string | null>(null);
  useEffect(() => {
    if (toolScope === null || restoredScope.current === toolScope) return;
    restoredScope.current = toolScope;
    const saved = readToolset(toolScope);
    if (saved.view) setView(saved.view);
    const image = PAGE_IMAGES.find((img) => img.file === saved.canvasImage)?.file;
    // Only an image this page has: the next page may not have reached the stage that made it yet
    const stage = image ? IMAGE_STAGE[image] : undefined;
    if (image && (stage === undefined || pageQ.data?.stages.some((s) => s.stage === stage && s.status !== "error"))) setCanvasImage(image);
  }, [toolScope, pageQ.data]);
  const chooseView = (next: "canvas" | "compare") => {
    setView(next);
    saveToolset(toolScope, { view: next });
  };
  const chooseImage = (next: PageImage) => {
    setCanvasImage(next);
    saveToolset(toolScope, { canvasImage: next });
  };
  const here = neighbours.findIndex((neighbour) => neighbour.id === id);
  const previousPage = here > 0 ? neighbours[here - 1] : undefined;
  const nextPage = here >= 0 ? neighbours[here + 1] : undefined;
  const deleteBlockM = useMutation({
    mutationFn: (blockId: number) => deleteBlock(id, blockId),
    onSuccess: (next) => {
      setDetail(next);
      selectBlock(null);
    },
  });
  /** Deletes a region: undoable through the canvas when it's open, otherwise after a confirmation. */
  const removeBlock = async (blockId: number) => {
    if (canvasHandle.current) {
      // After pending text saves, so the undo snapshot holds the saved text rather than the old one
      afterSaves(`delete:${blockId}`, () => canvasHandle.current?.deleteBlock(blockId));
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
  const [placeError, setPlaceError] = useState<string | null>(null);
  useEffect(() => {
    const current = pageQ.data;
    if (!current || isBusy(current.page.status)) return;
    if (!current.page.has_result && !current.stages.some((stage) => stage.stage === "clean_text")) return;
    const missing = current.blocks.filter((b) => (b.kind === "text" || b.kind === "sfx") && !b.area);
    if (missing.length === 0) return;
    const signature = JSON.stringify([id, missing.map((b) => [b.id, b.x, b.y, b.w, b.h])]);
    if (placeTried.current === signature) return;
    const timer = setTimeout(() => {
      // Marked before the request so an in-flight placement isn't started twice; cleared on failure so it's retried
      placeTried.current = signature;
      placeText(id).then(
        (next) => {
          setPlaceError(null);
          qc.setQueryData(["studio-page", id], next);
        },
        (err: unknown) => {
          if (placeTried.current === signature) placeTried.current = "";
          setPlaceError(err instanceof Error ? err.message : String(err));
        },
      );
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
  // The self-check after cleaning: blocks whose lettering still shows, or that were read as empty
  const toCheck = blocks.filter((block) => blockCheck(block) !== null);
  const version = `${page.updated_at}-${page.revision}-${renderStage?.updated_at ?? ""}-${imagesNonce}`;
  const cleaning = cleanTextM.isPending || cleanSfxM.isPending;
  const actionError = cleanTextM.error ?? cleanSfxM.error ?? renderM.error ?? translateAllM.error ?? publishM.error ?? rerunM.error ?? deleteBlockM.error;

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
      // Only when a block's source text has changed since it was translated — which is what the flag means, set
      // when a reading or an edit changes the Japanese and cleared when it is translated. The translate stage's own
      // status would add nothing and hides this on a page that has never been translated at all.
      attention: blocks.some((block) => block.needs_translate),
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
      key: "file",
      label: page.location ? "Move to another chapter" : "File into a chapter",
      icon: <FolderInput size={14} />,
      hint: page.location ? "Copy this page into another chapter" : "Copy this draft into a chapter so it can be read",
      onSelect: () => setFiling(true),
      unavailable: unavailableWhen(translating),
      separated: true,
    },
    {
      key: "finalize",
      label: "Finalize…",
      icon: <Archive size={14} />,
      hint: "Remove the working files, keeping the final image",
      onSelect: () => setFinalizing("finalize"),
      unavailable: unavailableWhen(translating, [!page.has_result, "No finished image yet"]),
    },
    {
      key: "rerun",
      label: page.finalized ? "Redo job…" : "Run again…",
      icon: <RotateCcw size={14} />,
      hint: "Detect, read, translate and clean the page again from its original",
      onSelect: () => {
        void (async () => {
          const ok = await confirm({
            title: "Run this page again?",
            message: "Every stage runs again from the original image. Regions you drew, text you edited and lettering styles are replaced by what the run finds. What readers see doesn't change until you publish.",
            confirmLabel: "Run again",
            danger: true,
          });
          if (ok) rerunM.mutate();
        })();
      },
      unavailable: unavailableWhen(translating, [rerunM.isPending, "Starting…"]),
      pending: rerunM.isPending,
      separated: true,
    },
    {
      key: "delete",
      label: page.location ? "Discard…" : "Delete page",
      icon: <Trash2 size={14} />,
      hint: page.location ? "Drop the edits, take the page out of the chapter, or delete it" : "Discard the page and all its images",
      onSelect: () => setDiscarding(true),
      unavailable: unavailableWhen([busy, "Can't discard while the page is being translated"]),
      danger: true,
    },
  ];

  // A finalized page has no working state left: redo it (original kept), delete its original, or delete it
  const menuActions: MenuAction[] = page.finalized
    ? [
        ...pageActions.filter((action) => action.key === "rerun" && page.raw_kept),
        ...(page.raw_kept
          ? [{
              key: "delete-raw",
              label: "Delete the original…",
              icon: <Archive size={14} />,
              hint: "Free its space; the page becomes read-only for good",
              onSelect: () => setFinalizing("raw"),
              unavailable: unavailableWhen(translating),
            }]
          : []),
        ...pageActions.filter((action) => action.key === "delete"),
      ]
    : pageActions;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-800">
        <Link
          to={workspaceId !== null ? `/studio/w/${workspaceId}` : page.location ? `/manage/chapters/${page.location.chapter_id}` : "/studio"}
          className="text-gray-400 hover:text-gray-50"
          title={workspaceId !== null ? "Back to the workspace" : page.location ? "Back to the chapter" : "All pages"}
        >
          <ArrowLeft size={18} />
        </Link>
        {workspaceId === null && page.location ? (
          <>
            <h1 className="flex min-w-0 max-w-[min(36rem,60vw)] items-center gap-1.5 text-base font-semibold">
              <Link to={`/read/series/${page.location.series_id}`} title={page.location.series_title} className="min-w-0 max-w-[50%] truncate text-gray-400 hover:text-gray-50">{page.location.series_title}</Link>
              <span className="text-gray-600">›</span>
              <Link to={`/manage/chapters/${page.location.chapter_id}`} title={page.location.chapter_title} className="min-w-0 truncate hover:text-indigo-300">{page.location.chapter_title}</Link>
            </h1>
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Link
                to={previousPage ? `/studio/pages/${previousPage.id}` : "#"}
                aria-disabled={!previousPage}
                title="Previous page in the chapter"
                aria-label="Previous page in the chapter"
                className={`rounded p-1 ${previousPage ? "hover:bg-gray-800 hover:text-gray-50" : "pointer-events-none opacity-30"}`}
              >
                <ChevronLeft size={14} />
              </Link>
              <span className="tabular-nums">page {page.location.index}/{page.location.total}</span>
              <Link
                to={nextPage ? `/studio/pages/${nextPage.id}` : "#"}
                aria-disabled={!nextPage}
                title="Next page in the chapter"
                aria-label="Next page in the chapter"
                className={`rounded p-1 ${nextPage ? "hover:bg-gray-800 hover:text-gray-50" : "pointer-events-none opacity-30"}`}
              >
                <ChevronRight size={14} />
              </Link>
            </div>
          </>
        ) : workspaceId !== null ? (
          <>
            <h1 className="flex min-w-0 max-w-[min(36rem,60vw)] items-center gap-1.5 text-base font-semibold">
              <Link to={`/studio/w/${workspaceId}`} title={workspaceQ.data?.workspace.name} className="min-w-0 max-w-[60%] truncate text-gray-400 hover:text-gray-50">
                {workspaceQ.data?.workspace.name ?? "Workspace"}
              </Link>
              <span className="text-gray-600">›</span>
              <span className="min-w-0 truncate" title={page.name ?? undefined}>{page.name ?? `Page ${page.id.slice(-8)}`}</span>
            </h1>
            {here >= 0 && (
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Link
                  to={previousPage ? `/studio/pages/${previousPage.id}` : "#"}
                  aria-disabled={!previousPage}
                  title="Previous page in the workspace"
                  aria-label="Previous page in the workspace"
                  className={`rounded p-1 ${previousPage ? "hover:bg-gray-800 hover:text-gray-50" : "pointer-events-none opacity-30"}`}
                >
                  <ChevronLeft size={14} />
                </Link>
                <span className="tabular-nums">page {here + 1}/{neighbours.length}</span>
                <Link
                  to={nextPage ? `/studio/pages/${nextPage.id}` : "#"}
                  aria-disabled={!nextPage}
                  title="Next page in the workspace"
                  aria-label="Next page in the workspace"
                  className={`rounded p-1 ${nextPage ? "hover:bg-gray-800 hover:text-gray-50" : "pointer-events-none opacity-30"}`}
                >
                  <ChevronRight size={14} />
                </Link>
              </div>
            )}
          </>
        ) : (
          <h1 className="max-w-[min(36rem,60vw)] truncate text-base font-semibold" title={page.name ?? undefined}>{page.name ?? `Page ${page.id.slice(-8)}`}</h1>
        )}
        <StatusBadge status={pageStatus(page)} />
        {page.has_edits ? (
          <span
            className="rounded-full bg-amber-900/60 px-2 py-0.5 text-xs font-medium text-amber-300"
            title={page.published
              ? "Burned since the last publish — readers still get the published version until you publish again"
              : "This page has never been published, so nobody is reading it yet"}
          >
            {page.published ? "edited since publish" : "unpublished"}
          </span>
        ) : (
          <span className="text-xs text-gray-500" title={page.published ? "Readers are seeing this revision" : undefined}>rev {page.revision}</span>
        )}
        <div className="flex flex-wrap gap-1.5">
          {stages.map((s) => (
            <span key={s.stage} title={s.error ?? s.updated_at}>
              <StatusBadge status={s.status} label={s.stage} />
            </span>
          ))}
          {toCheck.length > 0 && (
            <span
              className="flex items-center gap-1 rounded-full bg-amber-900/50 px-2 py-0.5 text-xs text-amber-300"
              title={`After the clean: ${toCheck.map((b) => `#${b.id} ${blockCheck(b)!.label}`).join(", ")}`}
            >
              <TriangleAlert size={12} /> {toCheck.length} to check
            </span>
          )}
        </div>

        <div className="flex items-center rounded-md border border-gray-700 overflow-hidden text-xs" role="group" aria-label="Editor view">
          {(["canvas", "compare"] as const).map((value) => (
            <button
              key={value}
              onClick={() => chooseView(value)}
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
          <ActionsMenu actions={menuActions} />
        </div>
      </div>

      {page.finalized && !busy ? (
        <FinalizedView pageId={page.id} rawKept={page.raw_kept} version={version} />
      ) : busy ? (
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
            onSelect={selectBlock}
            onDetail={setDetail}
            onReload={() => void qc.invalidateQueries({ queryKey: ["studio-page", id] })}
            onImagesChanged={() => { if (stillOpen()) imagesChanged(); }}
            lettering={letteringPlan.items}
            textPreviewAvailable={canvasImage === "clean-text.png" || canvasImage === "clean-sfx.png"}
            onStylePreview={setBlockStyle}
            relayout={relayout}
            initialToolset={readToolset(toolScope)}
            onToolsetChange={(patch) => saveToolset(toolScope, patch)}
            onModeChange={(mode) => {
              // Lettering is judged against the cleaned page, where it will be burned; a page not cleaned yet keeps its
              // background rather than pointing at an image that doesn't exist
              if (mode === "lettering" && canvasImage !== "clean-text.png" && canvasImage !== "clean-sfx.png") {
                if (stageStatus("clean_sfx") === "fresh") chooseImage("clean-sfx.png");
                else if (stageStatus("clean_text") !== undefined) chooseImage("clean-text.png");
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
                  chooseImage(PAGE_IMAGES.find((img) => img.file === e.target.value)?.file ?? canvasImage);
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
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-50 hover:bg-gray-800"
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
              className="ml-auto p-1 rounded-md text-gray-400 hover:text-gray-50 hover:bg-gray-800"
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
          {placeError && <p className="text-xs text-amber-400">Couldn't place the lettering yet: {placeError}</p>}
          {textBlocks.map((block) => (
            <BlockEditor key={block.id} pageId={page.id} block={block} disabled={busy} onChanged={setDetail} trackSave={trackSave} afterSaves={afterSaves} queued={queued} selected={selectedBlock === block.id} onSelect={() => selectBlock(block.id)} setBlockStyle={setBlockStyle} onDelete={() => void removeBlock(block.id)} />
          ))}
          {sfxBlocks.length > 0 && (
            <div className="pt-2 border-t border-gray-800 space-y-1.5">
              <div className="text-xs text-gray-400">Sound effects · ticked ones are removed by Clean SFX; give one lettering to draw it again</div>
              {sfxBlocks.map((block) => (
                <SfxBlockRow key={block.id} pageId={page.id} block={block} disabled={busy} onChanged={setDetail} trackSave={trackSave} selected={selectedBlock === block.id} onSelect={() => selectBlock(block.id)} setBlockStyle={setBlockStyle} onDelete={() => void removeBlock(block.id)} />
              ))}
            </div>
          )}
          <HistoryPanel pageId={page.id} currentRevision={page.revision} disabled={busy} onRolledBack={onPublished} />
        </aside>
        )}
      </div>
      )}

      {finalizing && (
        <FinalizeDialog
          pageIds={[page.id]}
          onlyRaw={finalizing === "raw"}
          onClose={() => setFinalizing(null)}
          onDone={() => setFinalizing(null)}
        />
      )}

      {filing && (
        <ChapterPicker
          pageId={page.id}
          pageLabel={page.name ?? page.id.slice(-8)}
          filed={page.location !== null && page.location !== undefined}
          onClose={() => setFiling(false)}
          onFiled={(toChapter) => {
            setFiling(false);
            void qc.invalidateQueries({ queryKey: ["studio-page", id] });
            navigate(`/manage/chapters/${toChapter}`);
          }}
        />
      )}

      {discarding && (
        <DiscardPageDialog
          page={page}
          onClose={() => setDiscarding(false)}
          onDone={({ deleted }) => {
            setDiscarding(false);
            if (deleted) {
              qc.removeQueries({ queryKey: ["studio-page", id] });
              navigate(workspaceId !== null
                ? `/studio/w/${workspaceId}`
                : page.location
                  ? `/manage/chapters/${page.location.chapter_id}`
                  : "/studio");
            } else {
              void qc.invalidateQueries({ queryKey: ["studio-page", id] });
            }
          }}
        />
      )}
    </div>
  );
}
