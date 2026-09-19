import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Check, FolderInput, ImageUp, Loader2, Pencil, Play, Trash2 } from "lucide-react";
import {
  deleteWorkspace,
  getWorkspace,
  getWorkspaceRun,
  renameWorkspace,
  startWorkspaceRun,
  uploadWorkspacePages,
} from "../api";
import { ChapterPicker } from "../components/ChapterPicker";
import { useConfirm } from "../components/ConfirmDialog";
import { LoadFailure } from "../components/LoadFailure";
import { StudioPageCard } from "../components/StudioPageCard";
import { useToast } from "../components/Toast";

/** A run is going, so progress is worth asking for often; otherwise the counts are enough. */
const RUN_POLL_MS = 1500;

/** One workspace: its pages in import order, what a run is doing, and the ways to add to or close it. */
export function StudioWorkspacePage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);
  const [uploading, setUploading] = useState(false);

  const workspaceQ = useQuery({ queryKey: ["workspace", id], queryFn: () => getWorkspace(id), enabled: Number.isInteger(id) });
  const runQ = useQuery({
    queryKey: ["workspace-run", id],
    queryFn: () => getWorkspaceRun(id),
    enabled: Number.isInteger(id),
    refetchInterval: (query) => ("running" in (query.state.data ?? {}) && (query.state.data as { running: boolean }).running ? RUN_POLL_MS : false),
  });

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

  /** Sends the chosen images as one batch, appended after the pages already here. */
  const addPages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const report = await uploadWorkspacePages(id, Array.from(files), pages.length);
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

  const close = async () => {
    const ok = await confirm({
      title: `Close "${workspace.name}"?`,
      message: "The workspace goes; its pages stay in the Studio as loose drafts, with everything done to them so far.",
      confirmLabel: "Close workspace",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteWorkspace(id);
      void qc.invalidateQueries({ queryKey: ["workspaces"] });
      void qc.invalidateQueries({ queryKey: ["studio-pages"] });
      navigate("/studio");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-800 px-4 py-3">
        <Link to="/studio" className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white">
          <ArrowLeft size={16} /> Studio
        </Link>

        {renaming === null ? (
          <h1 className="flex items-center gap-2 text-base font-semibold">
            {workspace.name}
            <button onClick={() => setRenaming(workspace.name)} aria-label="Rename workspace" className="text-gray-500 hover:text-white">
              <Pencil size={14} />
            </button>
          </h1>
        ) : (
          <form
            className="flex items-center gap-2"
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
              className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <button type="submit" disabled={!renaming.trim()} aria-label="Save name" className="text-gray-300 hover:text-white disabled:opacity-40">
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
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void addPages(e.target.files)} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-800 disabled:opacity-40"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImageUp size={14} />} Add pages
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
          <button
            onClick={() => runM.mutate()}
            disabled={runM.isPending || run?.running === true || pages.length === 0}
            title={run?.running ? "A run is going" : "Translate the pages that need it"}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-indigo-500 disabled:opacity-40"
          >
            <Play size={14} /> Run all{pending ? ` (${pending})` : ""}
          </button>
          <button
            onClick={() => void close()}
            aria-label="Close workspace"
            title="Close this workspace; its pages stay"
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

      <div className="flex-1 overflow-y-auto p-4">
        {pages.length === 0 ? (
          <p className="text-sm text-gray-500">No pages yet. Add some with “Add pages”, or import a chapter from the extension.</p>
        ) : (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
            {pages.map((page, index) => (
              <StudioPageCard key={page.id} page={page} caption={`page ${index + 1} of ${pages.length}`} />
            ))}
          </div>
        )}
      </div>

      {filing && (
        <ChapterPicker
          workspaceId={id}
          pageLabel={workspace.name}
          onClose={() => setFiling(false)}
          onFiled={() => {
            setFiling(false);
            refresh();
            toast.info("Filed into the chapter");
          }}
        />
      )}
    </div>
  );
}
