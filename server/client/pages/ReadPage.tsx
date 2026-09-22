import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Library, Loader2, Search, X } from "lucide-react";
import { listSeries, listSeriesTags, seriesCoverUrl, type SeriesQuery, type SeriesStatus } from "../api";

const STATUS_LABEL: Record<string, string> = { ongoing: "Ongoing", completed: "Completed", hiatus: "Hiatus" };

/** The library: browse and search series to read. Editing lives in Manage. */
export function ReadPage() {
  const [search, setSearch] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [status, setStatus] = useState<SeriesStatus | "">("");
  const [sort, setSort] = useState<"title" | "recent">("title");

  const query: SeriesQuery = {
    q: search.trim() || undefined,
    tags: tags.length ? tags : undefined,
    exclude: exclude.length ? exclude : undefined,
    status: status || undefined,
    sort,
  };
  const seriesQ = useQuery({ queryKey: ["series", query], queryFn: () => listSeries(query) });
  const tagsQ = useQuery({ queryKey: ["series-tags"], queryFn: listSeriesTags });

  /** A tag cycles: off → must have → must not have → off. */
  const cycleTag = (tag: string) => {
    if (tags.includes(tag)) {
      setTags(tags.filter((t) => t !== tag));
      setExclude([...exclude, tag]);
    } else if (exclude.includes(tag)) {
      setExclude(exclude.filter((t) => t !== tag));
    } else {
      setTags([...tags, tag]);
    }
  };

  const series = seriesQ.data ?? [];
  const filtered = tags.length > 0 || exclude.length > 0 || status !== "" || search.trim() !== "";

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-800">
        <Library size={18} className="text-gray-400" />
        <h1 className="text-base font-semibold">Library</h1>
        <span className="text-xs text-gray-500">{series.length} series</span>
        {seriesQ.error && <span className="text-xs text-red-400">{seriesQ.error.message}</span>}

        <label className="ml-auto flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5">
          <Search size={14} className="text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search titles"
            className="bg-transparent text-sm focus:outline-none w-44"
          />
          {search && (
            <button onClick={() => setSearch("")} aria-label="Clear search" className="text-gray-500 hover:text-gray-50">
              <X size={13} />
            </button>
          )}
        </label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as SeriesStatus | "")}
          aria-label="Status"
          className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-200"
        >
          <option value="">Any status</option>
          <option value="ongoing">Ongoing</option>
          <option value="completed">Completed</option>
          <option value="hiatus">Hiatus</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value === "recent" ? "recent" : "title")}
          aria-label="Sort"
          className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-200"
        >
          <option value="title">By title</option>
          <option value="recent">Recently updated</option>
        </select>
      </div>

      {(tagsQ.data?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-gray-800 text-xs">
          <span className="text-gray-500">Tags</span>
          {tagsQ.data?.map(({ tag, count }) => {
            const included = tags.includes(tag);
            const excluded = exclude.includes(tag);
            return (
              <button
                key={tag}
                onClick={() => cycleTag(tag)}
                title={included ? "Click to exclude" : excluded ? "Click to clear" : "Click to require"}
                className={`px-2 py-0.5 rounded-full border transition-colors ${
                  included
                    ? "border-indigo-500 bg-indigo-600/30 text-indigo-200"
                    : excluded
                      ? "border-red-500/60 bg-red-900/30 text-red-300 line-through"
                      : "border-gray-700 text-gray-400 hover:border-gray-600"
                }`}
              >
                {tag} <span className="text-gray-500">{count}</span>
              </button>
            );
          })}
          {filtered && (
            <button
              onClick={() => {
                setTags([]);
                setExclude([]);
                setStatus("");
                setSearch("");
              }}
              className="ml-auto text-gray-400 hover:text-gray-50"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {seriesQ.isLoading ? (
          <Loader2 className="animate-spin text-gray-500" />
        ) : series.length === 0 ? (
          <p className="text-sm text-gray-500">
            {filtered ? "No series match these filters." : "No series yet — add one in Manage."}
          </p>
        ) : (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
            {series.map((entry) => (
              <Link
                key={entry.id}
                to={`/read/series/${entry.id}`}
                className="group rounded-lg overflow-hidden bg-gray-900 border border-gray-800 hover:border-indigo-500/60 transition-colors"
              >
                <div className="aspect-2/3 bg-gray-950 flex items-center justify-center">
                  {entry.has_cover ? (
                    <img src={seriesCoverUrl(entry.id, entry.updated_at)} alt="" loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <BookOpen size={28} className="text-gray-700" />
                  )}
                </div>
                <div className="p-2 space-y-1">
                  <div className="text-sm font-medium truncate group-hover:text-indigo-300">{entry.title}</div>
                  <div className="flex items-center gap-2 text-[11px] text-gray-500">
                    <span>{entry.chapters} ch</span>
                    <span>{STATUS_LABEL[entry.status] ?? entry.status}</span>
                    <span className="ml-auto">{entry.reading_direction.toUpperCase()}</span>
                  </div>
                  {entry.tags.length > 0 && <div className="text-[11px] text-gray-600 truncate">{entry.tags.join(" · ")}</div>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
