import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, FolderInput, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { listPages, pageFileUrl, type PageScope, type StudioPageSummary } from "../api";
import { ChapterPicker } from "../components/ChapterPicker";
import { DiscardPageDialog } from "../components/DiscardPageDialog";
import { NewPageDialog } from "../components/NewPageDialog";
import { StatusBadge } from "../components/StatusBadge";

const SCOPE_KEY = "studio-scope";
const SCOPES: { value: PageScope; label: string; hint: string }[] = [
  { value: "inbox", label: "Inbox", hint: "Drafts: pages from the extension and uploads, not filed into a chapter yet" },
  { value: "chapter", label: "In chapters", hint: "Pages that belong to a chapter — editing one changes what people read once you publish" },
  { value: "all", label: "All", hint: "Every page" },
];

function readScope(): PageScope {
  try {
    const saved = localStorage.getItem(SCOPE_KEY);
    return saved === "chapter" || saved === "all" ? saved : "inbox";
  } catch {
    return "inbox";
  }
}

/** What a page is called in the Studio: its name, else the file name of its source, else the tail of its id. */
function pageLabel(page: StudioPageSummary): string {
  if (page.name) return page.name;
  if (page.source === "upload" || page.source === "import") return page.id.slice(-8);
  try {
    const file = new URL(page.source).pathname.split("/").filter(Boolean).pop();
    if (file) return decodeURIComponent(file);
  } catch {
    // Not a URL (an extension source string): fall through to the id
  }
  return page.id.slice(-8);
}

/** The Studio's pages: drafts waiting in the Inbox, and the chapter pages being worked on. */
export function StudioPagesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [filing, setFiling] = useState<StudioPageSummary | null>(null);
  const [discarding, setDiscarding] = useState<StudioPageSummary | null>(null);
  const [scope, setScopeState] = useState<PageScope>(readScope);

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
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-indigo-500"
        >
          <Plus size={14} /> New page
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
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
              <div key={page.id} className="group relative">
                <Link
                  to={`/studio/pages/${page.id}`}
                  className="flex flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900 transition-colors hover:border-indigo-500"
                >
                  <div className="aspect-2/3 overflow-hidden bg-gray-950">
                    <img
                      src={pageFileUrl(page.id, page.has_result ? "result.png" : "original.png", `${page.updated_at}-${page.revision}`)}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 px-3 pt-2">
                    <StatusBadge status={page.status} />
                    {page.has_edits ? (
                      <span
                        className="rounded-full bg-amber-900/60 px-2 py-0.5 text-xs font-medium text-amber-300"
                        title={page.published ? "Burned since the last publish — readers still see the published version" : "Not published yet"}
                      >
                        {page.published ? "edited" : "unpublished"}
                      </span>
                    ) : page.published ? (
                      <span className="text-xs text-gray-500" title={`Published as revision ${page.revision}`}>rev {page.revision}</span>
                    ) : null}
                  </div>
                  <div className="truncate px-3 pt-1 text-xs text-gray-300" title={page.source}>{pageLabel(page)}</div>
                  <div className="truncate px-3 pb-2 text-[11px] text-gray-500">
                    {page.location
                      ? `${page.location.chapter_title} · page ${page.location.index}/${page.location.total}`
                      : `${page.width}×${page.height} · draft`}
                  </div>
                </Link>

                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
                </div>
              </div>
            );
          })}
        </div>
      </div>

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
