import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Check, CheckSquare, FolderInput, ImageUp, Link2, Loader2, Pencil, Play, Send, Trash2 } from "lucide-react";
import {
  deleteWorkspace,
  getWorkspace,
  getWorkspaceRun,
  importWorkspacePageUrls,
  publishWorkspace,
  renameWorkspace,
  startWorkspaceRun,
  uploadWorkspacePages,
} from "../api";
import { AddPageUrlsDialog } from "../components/AddPageUrlsDialog";
import { ChapterPicker } from "../components/ChapterPicker";
import { FinalizeDialog } from "../components/FinalizeDialog";
import { SelectionBar } from "../components/SelectionBar";
import { usePageSelection } from "../hooks/usePageSelection";
import { LoadFailure } from "../components/LoadFailure";
import { Modal } from "../components/Modal";
import { forgetWorkspace } from "../lib/optimistic";
import { StudioPageCard } from "../components/StudioPageCard";
import { useToast } from "../components/Toast";
import { Toggle } from "../components/Toggle";

/** A run is going, so progress is worth asking for often; otherwise the counts are enough. */
const RUN_POLL_MS = 1500;

/** One workspace: its pages in import order, what a run is doing, and the ways to add to or close it. */
export function StudioWorkspacePage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importingUrls, setImportingUrls] = useState(false);
  const selection = usePageSelection();
  const [finalizingIds, setFinalizingIds] = useState<string[] | null>(null);
  // Where the address list's first send started, so sending the same list again fills the same positions
  const urlStart = useRef<{ workspaceId: number; index: number } | null>(null);
  // Where the next batch goes (files or addresses), from the last import's own answer: the cached workspace may not
  // have refetched yet, and a batch started at a filled position is skipped as a retry
  // One per workspace: this page stays mounted when the route moves to another, and a batch still going in the one
  // left behind must not move the new one's cursor
  const nextIndex = useRef(new Map<number, number>());
  /** The first free position: the last import's answer, or the workspace's if pages arrived some other way since. */
  const startIndex = () =>
    Math.max(nextIndex.current.get(id) ?? 0, workspaceQ.data?.workspace.next_index ?? 0);
  const noteNextIndex = (index: number) => {
    nextIndex.current.set(id, Math.max(startIndex(), index));
  };
  // Uploads and address imports take turns: each picks its start only after the one before has answered, so two
  // batches can never claim the same positions (the later one would be skipped as a retry)
  // One queue per workspace: moving to another workspace doesn't wait behind this one's imports
  const importQueues = useRef(new Map<number, Promise<unknown>>());
  const inTurn = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = (importQueues.current.get(id) ?? Promise.resolve()).then(task, task);
    importQueues.current.set(id, run.catch(() => undefined));
    return run;
  };
  // The close dialog, holding whether the loose pages stay; null while it's shut
  const [closing, setClosing] = useState<{ keepPages: boolean } | null>(null);

  const workspaceQ = useQuery({ queryKey: ["workspace", id], queryFn: () => getWorkspace(id), enabled: Number.isInteger(id) });
  const runQ = useQuery({
    queryKey: ["workspace-run", id],
    queryFn: () => getWorkspaceRun(id),
    enabled: Number.isInteger(id),
    refetchInterval: (query) => ("running" in (query.state.data ?? {}) && (query.state.data as { running: boolean }).running ? RUN_POLL_MS : false),
  });

  // Polling stops the moment a run reports itself finished, so the page data it changed is reloaded once, here
  const seenFinish = useRef<string | null>(null);
  const finishedAt = runQ.data && "finishedAt" in runQ.data ? runQ.data.finishedAt : null;
  useEffect(() => {
    if (finishedAt === null || seenFinish.current === finishedAt) return;
    seenFinish.current = finishedAt;
    void qc.invalidateQueries({ queryKey: ["workspace", id] });
    void qc.invalidateQueries({ queryKey: ["workspaces"] });
  }, [finishedAt, id, qc]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["workspace", id] });
    void qc.invalidateQueries({ queryKey: ["workspaces"] });
    void qc.invalidateQueries({ queryKey: ["workspace-run", id] });
  };

  const runM = useMutation({
    mutationFn: () => startWorkspaceRun(id),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  const publishM = useMutation({
    mutationFn: () => publishWorkspace(id),
    onSuccess: (result) => {
      refresh();
      void qc.invalidateQueries({ queryKey: ["studio-pages"] });
      toast.info(`Published ${result.published} page${result.published === 1 ? "" : "s"}`);
      for (const entry of result.skipped) toast.error(entry.reason);
    },
    onError: (error) => toast.error(error.message),
  });
  const renameM = useMutation({
    mutationFn: (name: string) => renameWorkspace(id, { name }),
    onSuccess: () => {
      setRenaming(null);
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  if (!Number.isInteger(id)) return <LoadFailure message="That isn't a workspace address." onRetry={() => navigate("/studio")} />;
  if (workspaceQ.isLoading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <Loader2 className="animate-spin text-gray-600" />
      </div>
    );
  }
  if (workspaceQ.isError) return <LoadFailure message={workspaceQ.error.message} onRetry={() => void workspaceQ.refetch()} />;

  const detail = workspaceQ.data;
  if (!detail) return <LoadFailure message="This workspace is gone." onRetry={() => navigate("/studio")} />;
  const { workspace, pages } = detail;
  const run = runQ.data && "running" in runQ.data ? runQ.data : null;
  const pending = runQ.data && "pending" in runQ.data ? runQ.data.pending : null;
  // A draft's badge is measured against the chapter page it replaces, so this counts what readers can't see yet
  const unpublished = pages.filter((page) => page.has_edits).length;

  /** Sends the chosen images as one batch, appended after the pages already here. */
  const addPages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      // Past every position in use, not the page count: a deleted page leaves a gap, and a batch landing on a
      // position that already has a page is skipped as a retry
      const report = await inTurn(async () => {
        const answer = await uploadWorkspacePages(id, Array.from(files), startIndex());
        noteNextIndex(answer.workspace.next_index);
        return answer;
      });
      refresh();
      const skipped = report.skipped.length;
      toast.info(`Added ${report.imported} page${report.imported === 1 ? "" : "s"}${skipped > 0 ? `, skipped ${skipped}` : ""}`);
      if (skipped > 0) for (const entry of report.skipped) toast.error(`${entry.name}: ${entry.reason}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /**
   * Closes the workspace and goes back to the Studio at once, with the workspace already off the list: deleting its
   * pages can take a while, and there's nothing to wait for. A refusal (a page still running) puts it back.
   */
  const close = async (keepPages: boolean) => {
    const name = workspace.name;
    await qc.cancelQueries({ queryKey: ["workspaces"] });
    const restore = forgetWorkspace(qc, id);
    navigate("/studio");
    try {
      await deleteWorkspace(id, keepPages);
      qc.removeQueries({ queryKey: ["workspace", id] });
    } catch (error) {
      restore();
      toast.error(`“${name}” wasn't closed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      void qc.invalidateQueries({ queryKey: ["workspaces"] });
      void qc.invalidateQueries({ queryKey: ["studio-pages"] });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-800 px-4 py-3">
        <Link to="/studio" className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-50">
          <ArrowLeft size={16} /> Studio
        </Link>

        {renaming === null ? (
          <h1 className="flex min-w-0 max-w-[min(36rem,60vw)] items-center gap-2 text-base font-semibold" title={workspace.name}>
            <span className="truncate">{workspace.name}</span>
            <button onClick={() => setRenaming(workspace.name)} aria-label="Rename workspace" className="text-gray-500 hover:text-gray-50">
              <Pencil size={14} />
            </button>
          </h1>
        ) : (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (renaming.trim()) renameM.mutate(renaming.trim());
            }}
          >
            <input
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              maxLength={200}
              autoFocus
              aria-label="Workspace name"
              className="w-full max-w-[40rem] rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <button type="submit" disabled={!renaming.trim()} aria-label="Save name" className="text-gray-300 hover:text-gray-50 disabled:opacity-40">
              <Check size={16} />
            </button>
          </form>
        )}

        <span className="text-xs text-gray-500">
          {workspace.pages} page{workspace.pages === 1 ? "" : "s"}
          {workspace.done > 0 && ` · ${workspace.done} done`}
          {workspace.stale > 0 && ` · ${workspace.stale} stale`}
          {workspace.error > 0 && ` · ${workspace.error} failed`}
        </span>
        {workspace.source_url && (
          <a href={workspace.source_url} target="_blank" rel="noreferrer" className="truncate text-xs text-gray-500 hover:text-gray-300" title={workspace.source_url}>
            {workspace.source_provider ?? "source"}
          </a>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => (selection.selecting ? selection.stop() : selection.start())}
            aria-pressed={selection.selecting}
            disabled={pages.length === 0}
            title="Pick pages to finalize together"
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-40 ${
              selection.selecting ? "border-indigo-500 text-indigo-300" : "border-gray-700 text-gray-300 hover:bg-gray-800"
            }`}
          >
            <CheckSquare size={14} /> Select
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void addPages(e.target.files)} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-800 disabled:opacity-40"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImageUp size={14} />} Add pages
          </button>
          <button
            onClick={() => {
              urlStart.current = null;
              setImportingUrls(true);
            }}
            title="Download pages from their addresses"
            className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-800"
          >
            <Link2 size={14} /> From addresses
          </button>
          {workspace.chapter_id === null ? (
            <button
              onClick={() => setFiling(true)}
              disabled={pages.length === 0}
              title="Move these pages into a chapter, publishing the translated ones"
              className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-800 disabled:opacity-40"
            >
              <FolderInput size={14} /> File into chapter
            </button>
          ) : (
            <Link
              to={`/manage/chapters/${workspace.chapter_id}`}
              title="This workspace works on that chapter"
              className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-800"
            >
              <BookOpen size={14} /> Its chapter
            </Link>
          )}
          {unpublished > 0 && (
            <button
              onClick={() => publishM.mutate()}
              disabled={publishM.isPending || workspace.chapter_id === null}
              title={workspace.chapter_id === null
                ? "File this workspace into a chapter first; readers only see pages that belong to one"
                : "Copy each edited draft over its chapter page and publish it"}
              className="flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-500 disabled:opacity-50"
            >
              {publishM.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Publish {unpublished}
            </button>
          )}
          <button
            onClick={() => runM.mutate()}
            disabled={runM.isPending || run?.running === true || pages.length === 0}
            title={run?.running ? "A run is going" : "Translate the pages that need it"}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-indigo-500 disabled:opacity-40"
          >
            <Play size={14} /> Run all{pending ? ` (${pending})` : ""}
          </button>
          <button
            onClick={() => setClosing({ keepPages: false })}
            aria-label="Close workspace"
            title="Close this workspace"
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-red-400"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {run?.running && (
        <div className="flex items-center gap-3 border-b border-gray-800 bg-gray-900/60 px-4 py-2 text-xs text-gray-300">
          <Loader2 size={14} className="animate-spin text-indigo-400" />
          Translating page {run.done + run.failed + 1} of {run.total}
          {run.failed > 0 && <span className="text-amber-400">· {run.failed} failed</span>}
          {run.error && <span className="truncate text-gray-500" title={run.error}>· {run.error}</span>}
        </div>
      )}
      {run && !run.running && run.finishedAt && (run.done > 0 || run.failed > 0) && (
        <div className="border-b border-gray-800 bg-gray-900/60 px-4 py-2 text-xs text-gray-400">
          Last run: {run.done} translated{run.failed > 0 && `, ${run.failed} failed`}
          {run.error && <span className="text-gray-500"> · {run.error}</span>}
        </div>
      )}

      {selection.selecting && (
        <SelectionBar
          count={selection.selected.size}
          total={pages.length}
          onSelectAll={() => selection.selectAll(pages.map((page) => page.id))}
          onFinalize={() => setFinalizingIds([...selection.selected])}
          onCancel={selection.stop}
        />
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {pages.length === 0 ? (
          <p className="text-sm text-gray-500">No pages yet. Add some with “Add pages”, or import a chapter from the extension.</p>
        ) : (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
            {pages.map((page, index) => (
              <StudioPageCard
                key={page.id}
                page={page}
                caption={`page ${index + 1} of ${pages.length}`}
                selecting={selection.selecting}
                selected={selection.selected.has(page.id)}
                onToggleSelect={() => selection.toggle(page.id)}
              />
            ))}
          </div>
        )}
      </div>

      {filing && (
        <ChapterPicker
          workspaceId={id}
          pageLabel={workspace.name}
          suggestedTags={workspace.tags}
          adult={workspace.adult}
          onClose={() => setFiling(false)}
          onFiled={(_chapterId, skipped) => {
            setFiling(false);
            refresh();
            void qc.invalidateQueries({ queryKey: ["studio-pages"] });
            toast.info("Filed into the chapter");
            // Pages that moved but couldn't be published, or were left behind: say so rather than look complete
            for (const entry of skipped ?? []) toast.error(entry.reason);
          }}
        />
      )}

      {finalizingIds && (
        <FinalizeDialog
          pageIds={finalizingIds}
          onClose={() => setFinalizingIds(null)}
          onDone={(report) => {
            setFinalizingIds(null);
            selection.stop();
            refresh();
            const done = report.pages.filter((page) => page.ok).length;
            toast.info(`Finalized ${done} page${done === 1 ? "" : "s"}`);
          }}
        />
      )}

      {importingUrls && (
        <AddPageUrlsDialog
          title={`Download pages into “${workspace.name}”`}
          resendable
          onClose={() => {
            setImportingUrls(false);
            refresh();
          }}
          onImport={async (urls, { resend }) => {
            // A resend reuses the first send's positions, so pages that already landed are skipped, not doubled
            const report = await inTurn(async () => {
              // Only this workspace's first send: the dialog can outlive a route change (browser back with it open)
              const first = urlStart.current?.workspaceId === id ? urlStart.current.index : null;
              const start = resend && first !== null ? first : startIndex();
              urlStart.current = { workspaceId: id, index: start };
              const answer = await importWorkspacePageUrls(id, urls, start);
              noteNextIndex(answer.workspace.next_index);
              return answer;
            });
            refresh();
            return {
              imported: report.imported,
              skipped: report.skipped.map((entry) => ({ url: entry.url, name: entry.name, reason: entry.reason })),
            };
          }}
        />
      )}

      {closing && (
        <Modal
          title={`Close “${workspace.name}”?`}
          onClose={() => setClosing(null)}
          footer={
            <>
              <button
                onClick={() => setClosing(null)}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => void close(closing.keepPages)}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
              >
                {closing.keepPages ? "Close workspace" : "Close and delete pages"}
              </button>
            </>
          }
        >
          <div className="space-y-3 text-sm text-gray-300">
            <p>
              {closing.keepPages
                ? "The workspace goes; its pages stay in the Studio as loose drafts, with everything done to them so far."
                : "The workspace goes, and so do its pages and their images. This can't be undone."}
            </p>
            {workspace.chapter_id !== null && (
              <p className="text-xs text-gray-500">Pages already in its chapter stay there either way; only drafts are affected.</p>
            )}
            <Toggle checked={closing.keepPages} onChange={(keepPages) => setClosing({ keepPages })} className="text-sm">
              Keep the pages as loose drafts
            </Toggle>
          </div>
        </Modal>
      )}
    </div>
  );
}
