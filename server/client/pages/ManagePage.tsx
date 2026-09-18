import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, FolderCog, Inbox, Loader2, Plus, Search, SquarePen, Trash2, X } from "lucide-react";
import { deleteSeries, listInbox, listSeries, seriesCoverUrl, type SeriesSummary } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { SeriesForm } from "../components/SeriesForm";

const STATUS_LABEL: Record<string, string> = { ongoing: "Ongoing", completed: "Completed", hiatus: "Hiatus" };

/** The library as a librarian sees it: create a series, edit or delete one, and see what's waiting in the Inbox. */
export function ManagePage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<SeriesSummary | null>(null);
  const [creating, setCreating] = useState(false);

  const query = { q: search.trim() || undefined, sort: "recent" as const };
  const seriesQ = useQuery({ queryKey: ["series", query], queryFn: () => listSeries(query) });
  const inboxQ = useQuery({ queryKey: ["inbox"], queryFn: listInbox });

  const deleteM = useMutation({
    mutationFn: (id: number) => deleteSeries(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["series"] });
      void qc.invalidateQueries({ queryKey: ["series-tags"] });
      void qc.invalidateQueries({ queryKey: ["inbox"] });
    },
  });

  const remove = async (series: SeriesSummary) => {
    const confirmed = await confirm({
      title: `Delete “${series.title}”?`,
      message: `Its ${series.volumes} volume${series.volumes === 1 ? "" : "s"} and ${series.chapters} chapter${
        series.chapters === 1 ? "" : "s"
      } go with it. The pages keep their images and return to the Inbox.`,
      confirmLabel: "Delete series",
      danger: true,
    });
    if (confirmed) deleteM.mutate(series.id);
  };

  const series = seriesQ.data ?? [];
  const error = seriesQ.error ?? deleteM.error;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-800 px-4 py-3">
        <FolderCog size={18} className="text-gray-400" />
        <h1 className="text-base font-semibold">Manage library</h1>
        <span className="text-xs text-gray-500">{series.length} series</span>
        {error && <span className="text-xs text-red-400">{error.message}</span>}

        <label className="ml-auto flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5">
          <Search size={14} className="text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search titles"
            className="w-44 bg-transparent text-sm focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} aria-label="Clear search" className="text-gray-500 hover:text-white">
              <X size={13} />
            </button>
          )}
        </label>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          <Plus size={14} />
          New series
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-gray-800 bg-gray-900/40 px-4 py-2 text-xs text-gray-400">
        <Inbox size={14} />
        {inboxQ.isLoading ? (
          <Loader2 size={12} className="animate-spin" />
        ) : inboxQ.isError ? (
          <span className="text-red-400">The Inbox couldn't be read: {inboxQ.error.message}</span>
        ) : (
          <span>
            {inboxQ.data?.length ?? 0} page{(inboxQ.data?.length ?? 0) === 1 ? "" : "s"} in the Inbox — pages from the extension and the Studio,
            waiting to be filed into a chapter.
          </span>
        )}
        <Link to="/studio" className="ml-auto text-indigo-300 hover:text-indigo-200">Open the Studio</Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {seriesQ.isLoading ? (
          <Loader2 className="animate-spin text-gray-500" />
        ) : series.length === 0 ? (
          <p className="text-sm text-gray-500">{search.trim() ? "No series match that search." : "No series yet — create one to start."}</p>
        ) : (
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
            {series.map((entry) => (
              <div key={entry.id} className="group flex gap-3 rounded-lg border border-gray-800 bg-gray-900 p-2.5">
                <Link
                  to={`/manage/series/${entry.id}`}
                  className="flex h-28 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-950"
                >
                  {entry.has_cover ? (
                    <img src={seriesCoverUrl(entry.id, entry.updated_at)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <BookOpen size={22} className="text-gray-700" />
                  )}
                </Link>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Link to={`/manage/series/${entry.id}`} className="truncate text-sm font-medium hover:text-indigo-300">
                    {entry.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                    <span>{STATUS_LABEL[entry.status] ?? entry.status}</span>
                    <span>{entry.volumes} vol</span>
                    <span>{entry.chapters} ch</span>
                    <span>{entry.reading_direction.toUpperCase()}</span>
                  </div>
                  {entry.tags.length > 0 && <div className="truncate text-[11px] text-gray-600">{entry.tags.join(" · ")}</div>}
                  <div className="mt-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      onClick={() => setEditing(entry)}
                      title="Edit this series"
                      aria-label={`Edit ${entry.title}`}
                      className="rounded-md p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
                    >
                      <SquarePen size={14} />
                    </button>
                    <Link
                      to={`/read/series/${entry.id}`}
                      title="Open in Read"
                      aria-label={`Read ${entry.title}`}
                      className="rounded-md p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
                    >
                      <BookOpen size={14} />
                    </Link>
                    <button
                      onClick={() => void remove(entry)}
                      disabled={deleteM.isPending}
                      title="Delete this series"
                      aria-label={`Delete ${entry.title}`}
                      className="ml-auto rounded-md p-1 text-gray-400 hover:bg-gray-800 hover:text-red-300 disabled:opacity-40"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(creating || editing) && (
        <SeriesForm
          series={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ["series"] });
            void qc.invalidateQueries({ queryKey: ["series-tags"] });
          }}
        />
      )}
    </div>
  );
}
