import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, FolderInput, FolderPlus, Layers, Loader2, Plus, Search, Trash2, X, Link2 } from "lucide-react";
import { createWorkspace, importWorkspacePageUrls, listPages, listWorkspaces, pageFileUrl, type PageScope, type StudioPageSummary } from "../api";
import { ChapterPicker } from "../components/ChapterPicker";
import { DiscardPageDialog } from "../components/DiscardPageDialog";
import { Modal } from "../components/Modal";
import { AddPageUrlsDialog } from "../components/AddPageUrlsDialog";
import { NewPageDialog } from "../components/NewPageDialog";
import { StudioPageCard, pageLabel } from "../components/StudioPageCard";
import { useToast } from "../components/Toast";

const SCOPE_KEY = "studio-scope";
const SCOPES: { value: PageScope; label: string; hint: string }[] = [
  { value: "inbox", label: "Inbox", hint: "Drafts: pages from the extension and uploads, not filed into a chapter yet" },
  { value: "chapter", label: "In chapters", hint: "Pages that belong to a chapter — editing one changes what people read once you publish" },
  { value: "all", label: "All", hint: "Every page" },
];

/** A name for a workspace made from pasted addresses: the folder they share, else the day. */
function workspaceName(urls: string[]): string {
  try {
    const segments = new URL(urls[0]).pathname.split("/").filter(Boolean);
    const folder = segments.at(-2);
    if (folder) return decodeURIComponent(folder).slice(0, 80);
  } catch {
    // Not an address we can read a folder out of; the date will do
  }
  return `Imported ${new Date().toLocaleDateString()}`;
}

function readScope(): PageScope {
  try {
    const saved = localStorage.getItem(SCOPE_KEY);
    return saved === "chapter" || saved === "all" ? saved : "inbox";
  } catch {
    return "inbox";
  }
}

/** The Studio: the workspaces being worked on, then the loose pages (Inbox drafts and chapter pages). */
export function StudioPagesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [filing, setFiling] = useState<StudioPageSummary | null>(null);
  const [discarding, setDiscarding] = useState<StudioPageSummary | null>(null);
  const [scope, setScopeState] = useState<PageScope>(readScope);
  const [newWorkspace, setNewWorkspace] = useState<string | null>(null);
  const [importingUrls, setImportingUrls] = useState(false);
  const toast = useToast();

  const setScope = (next: PageScope) => {
    setScopeState(next);
    try {
      localStorage.setItem(SCOPE_KEY, next);
    } catch {
      // Not remembered for next time; the choice still applies now
    }
  };

  const query = { filed: scope, ...(search.trim() ? { q: search.trim() } : {}) };
  const pagesQ = useQuery({ queryKey: ["studio-pages", query], queryFn: () => listPages(query), refetchInterval: 5000 });
  const pages = pagesQ.data ?? [];
  // Workspaces hold their own pages, so they are listed above the loose ones rather than among them
  const workspacesQ = useQuery({ queryKey: ["workspaces"], queryFn: () => listWorkspaces(), refetchInterval: 10_000 });
  const workspaces = workspacesQ.data ?? [];

  const createM = useMutation({
    mutationFn: (name: string) => createWorkspace({ name }),
    onSuccess: (workspace) => {
      setNewWorkspace(null);
      void qc.invalidateQueries({ queryKey: ["workspaces"] });
      navigate(`/studio/w/${workspace.id}`);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-800 px-4 py-3">
        <h1 className="text-base font-semibold">Studio</h1>
        <div className="flex rounded-lg border border-gray-800 bg-gray-900 p-0.5">
          {SCOPES.map((entry) => (
            <button
              key={entry.value}
              onClick={() => setScope(entry.value)}
              title={entry.hint}
              aria-pressed={scope === entry.value}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                scope === entry.value ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500">{pages.length} page{pages.length === 1 ? "" : "s"}</span>

        <label className="ml-auto flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5">
          <Search size={14} className="text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search names and sources"
            className="w-48 bg-transparent text-sm focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} aria-label="Clear search" className="text-gray-500 hover:text-white">
              <X size={13} />
            </button>
          )}
        </label>
        <button
          onClick={() => setNewWorkspace("")}
          title="A folder of pages worked on together"
          className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-800"
        >
          <FolderPlus size={14} /> New workspace
        </button>
        <button
          onClick={() => setImportingUrls(true)}
          className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-800"
          title="Paste a list of image addresses; they are downloaded into a new workspace"
        >
          <Link2 size={14} /> From addresses
        </button>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-indigo-500"
        >
          <Plus size={14} /> New page
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {workspacesQ.isError && (
          <p className="mb-4 text-sm text-red-400">
            The workspaces couldn't be loaded: {workspacesQ.error.message}{" "}
            <button type="button" onClick={() => void workspacesQ.refetch()} className="text-gray-300 underline hover:text-white">Try again</button>
          </p>
        )}
        {workspaces.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              <Layers size={13} /> Workspaces
            </h2>
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
              {workspaces.map((workspace) => (
                <Link
                  key={workspace.id}
                  to={`/studio/w/${workspace.id}`}
                  className="flex gap-3 overflow-hidden rounded-xl border border-gray-800 bg-gray-900 p-2 transition-colors hover:border-indigo-500"
                >
                  <div className="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-gray-950">
                    {workspace.first_page_id && (
                      <img src={pageFileUrl(workspace.first_page_id, "original.png", workspace.updated_at)} alt="" loading="lazy" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-gray-200" title={workspace.name}>{workspace.name}</div>
                    <div className="text-[11px] text-gray-500">
                      {workspace.pages} page{workspace.pages === 1 ? "" : "s"}
                      {workspace.running > 0 && <span className="text-indigo-400"> · {workspace.running} running</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                      {workspace.done > 0 && <span className="rounded-full bg-emerald-900/50 px-1.5 text-emerald-300">{workspace.done} done</span>}
                      {workspace.idle > 0 && <span className="rounded-full bg-gray-800 px-1.5 text-gray-400">{workspace.idle} to do</span>}
                      {workspace.stale > 0 && <span className="rounded-full bg-amber-900/50 px-1.5 text-amber-300">{workspace.stale} stale</span>}
                      {workspace.error > 0 && <span className="rounded-full bg-red-900/50 px-1.5 text-red-300">{workspace.error} failed</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {workspaces.length > 0 && (
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Loose pages</h2>
        )}
        {pagesQ.isLoading && <Loader2 className="animate-spin text-gray-500" />}
        {pagesQ.error && <p className="text-sm text-red-400">{pagesQ.error.message}</p>}
        {!pagesQ.isLoading && pages.length === 0 && (
          <p className="text-sm text-gray-500">
            {search.trim()
              ? "No pages match that search."
              : scope === "inbox"
                ? "The Inbox is empty. Translate a page from the extension, or add one here."
                : "No pages in chapters yet — import some in Manage."}
          </p>
        )}

        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
          {pages.map((page) => {
            const busy = page.status === "queued" || page.status === "running";
            return (
              <StudioPageCard
                key={page.id}
                page={page}
                actions={
                  <>
                    {page.location ? (
                      <Link
                        to={`/manage/chapters/${page.location.chapter_id}`}
                        title={`${page.location.series_title} · ${page.location.chapter_title}`}
                        aria-label="Open the chapter in Manage"
                        className="rounded-md bg-gray-900/90 p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white"
                      >
                        <BookOpen size={14} />
                      </Link>
                    ) : (
                      <button
                        onClick={() => setFiling(page)}
                        disabled={busy}
                        title="File this draft into a chapter"
                        aria-label="File into a chapter"
                        className="rounded-md bg-gray-900/90 p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-40"
                      >
                        <FolderInput size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => setDiscarding(page)}
                      disabled={busy}
                      title={busy ? "Can't discard while the page is being translated" : "Discard page"}
                      aria-label="Discard page"
                      className="rounded-md bg-gray-900/90 p-1.5 text-gray-400 hover:bg-gray-800 hover:text-red-400 disabled:opacity-40"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                }
              />
            );
          })}
        </div>
      </div>

      {importingUrls && (
        <AddPageUrlsDialog
          title="Download pages into a new workspace"
          onClose={() => {
            setImportingUrls(false);
            void qc.invalidateQueries({ queryKey: ["workspaces"] });
          }}
          onImport={async (urls) => {
            // A workspace first, so a part-finished download still leaves the pages somewhere they can be worked on
            const workspace = await createWorkspace({ name: workspaceName(urls) });
            const detail = await importWorkspacePageUrls(workspace.id, urls, 0);
            void qc.invalidateQueries({ queryKey: ["workspaces"] });
            if (detail.imported > 0) navigate(`/studio/w/${workspace.id}`);
            return {
              imported: detail.imported,
              skipped: detail.skipped.map((entry) => ({ name: entry.name, reason: entry.reason })),
            };
          }}
        />
      )}

      {creating && (
        <NewPageDialog
          onClose={() => {
            setCreating(false);
            void qc.invalidateQueries({ queryKey: ["studio-pages"] });
          }}
          onCreated={(pageId) => {
            void qc.invalidateQueries({ queryKey: ["studio-pages"] });
            navigate(`/studio/pages/${pageId}`);
          }}
        />
      )}

      {filing && (
        <ChapterPicker
          pageId={filing.id}
          pageLabel={pageLabel(filing)}
          onClose={() => setFiling(null)}
          onFiled={() => setFiling(null)}
        />
      )}

      {newWorkspace !== null && (
        <Modal
          title="New workspace"
          onClose={() => setNewWorkspace(null)}
          footer={
            <>
              <button onClick={() => setNewWorkspace(null)} className="rounded-lg px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-800">Cancel</button>
              <button
                onClick={() => createM.mutate(newWorkspace.trim())}
                disabled={!newWorkspace.trim() || createM.isPending}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {createM.isPending && <Loader2 size={14} className="animate-spin" />} Create
              </button>
            </>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newWorkspace.trim()) createM.mutate(newWorkspace.trim());
            }}
          >
            <label className="block text-sm">
              <span className="mb-1 block text-gray-400">Name</span>
              <input
                value={newWorkspace}
                onChange={(e) => setNewWorkspace(e.target.value)}
                placeholder="Chapter 12"
                maxLength={200}
                autoFocus
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </label>
            <p className="mt-2 text-xs text-gray-500">A folder of pages worked on together: add pages to it, run them all, then file them into a chapter.</p>
          </form>
        </Modal>
      )}

      {discarding && (
        <DiscardPageDialog
          page={discarding}
          onClose={() => setDiscarding(null)}
          onDone={() => setDiscarding(null)}
        />
      )}
    </div>
  );
}
