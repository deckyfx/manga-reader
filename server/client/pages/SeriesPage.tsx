import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Loader2, Settings2 } from "lucide-react";
import { RatingBadge, Reviews } from "../components/Reviews";
import { getSeries, seriesCoverUrl, type ChapterSummary } from "../api";
import { chapterLink, savedPage } from "../lib/read-progress";

const STATUS_LABEL: Record<string, string> = { ongoing: "Ongoing", completed: "Completed", hiatus: "Hiatus" };

/** One series to read: its details, its volumes and their chapters, and any chapters outside a volume. */
export function SeriesPage() {
  const { id = "" } = useParams();
  const seriesId = Number(id);
  const seriesQ = useQuery({ queryKey: ["series", seriesId], queryFn: () => getSeries(seriesId), enabled: Number.isFinite(seriesId) });

  if (seriesQ.isLoading) return <Loader2 className="m-4 animate-spin text-gray-500" />;
  if (!seriesQ.data) return <p className="m-4 text-sm text-red-400">{seriesQ.error?.message ?? "Series not found"}</p>;

  const { series, volumes, unsorted } = seriesQ.data;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-800">
        <Link to="/read" className="text-gray-400 hover:text-white" title="Library">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="max-w-[min(36rem,60vw)] truncate text-base font-semibold" title={series.title}>{series.title}</h1>
        <span className="text-xs text-gray-500">{series.chapters} chapter{series.chapters === 1 ? "" : "s"}</span>
        <Link
          to={`/manage/series/${series.id}`}
          className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-gray-300 bg-gray-800 hover:bg-gray-700"
          title="Edit this series in Manage"
        >
          <Settings2 size={14} />
          Manage
        </Link>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-wrap gap-4 p-4 border-b border-gray-800">
          <div className="w-40 shrink-0 aspect-2/3 rounded-lg overflow-hidden bg-gray-950 border border-gray-800 flex items-center justify-center">
            {series.has_cover ? (
              <img src={seriesCoverUrl(series.id, series.updated_at)} alt="" className="w-full h-full object-cover" />
            ) : (
              <BookOpen size={28} className="text-gray-700" />
            )}
          </div>
          <div className="flex-1 min-w-56 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
              <span className="px-2 py-0.5 rounded bg-gray-800">{STATUS_LABEL[series.status] ?? series.status}</span>
              <span className="px-2 py-0.5 rounded bg-gray-800">{series.reading_direction === "rtl" ? "Right to left" : "Left to right"}</span>
              {series.author && <span>by {series.author}</span>}
            </div>
            <RatingBadge rating={series.rating} />
            {series.synopsis && <p className="text-sm text-gray-300 whitespace-pre-wrap">{series.synopsis}</p>}
            {series.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {series.tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 rounded-full border border-gray-700 text-[11px] text-gray-400">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-4 space-y-5">
          {volumes.map((volume) => (
            <section key={volume.id} className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-300">
                {volume.number ? `Volume ${volume.number} · ` : ""}
                {volume.title}
              </h2>
              <ChapterList chapters={volume.chapters} />
            </section>
          ))}

          {unsorted.length > 0 && (
            <section className="space-y-2">
              {volumes.length > 0 && <h2 className="text-sm font-semibold text-gray-300">Chapters</h2>}
              <ChapterList chapters={unsorted} />
            </section>
          )}

          {volumes.length === 0 && unsorted.length === 0 && (
            <p className="text-sm text-gray-500">No chapters yet — add them in Manage.</p>
          )}

          <div className="border-t border-gray-800 pt-5">
            <Reviews target="series" id={series.id} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChapterList({ chapters }: { chapters: ChapterSummary[] }) {
  if (chapters.length === 0) return <p className="text-xs text-gray-600">No chapters in this volume yet.</p>;
  return (
    <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
      {chapters.map((chapter) => {
        // Where this chapter was left off, so the card resumes instead of starting over
        const resumeAt = savedPage(chapter.id, chapter.pages);
        return (
          <Link
            key={chapter.id}
            to={chapter.pages > 0 ? chapterLink(chapter.id, chapter.pages) : `/manage/chapters/${chapter.id}`}
            className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 hover:border-indigo-500/60 transition-colors"
          >
            <span className="min-w-0 text-sm truncate" title={chapter.title}>
              {chapter.number ? `${chapter.number}. ` : ""}
              {chapter.title}
            </span>
            {resumeAt > 1 && (
              <span className="shrink-0 rounded-full bg-indigo-600/25 px-2 py-0.5 text-[11px] text-indigo-200" title="Continue where you left off">
                page {resumeAt}
              </span>
            )}
            <span className="ml-auto text-xs text-gray-500">{chapter.pages} pg</span>
          </Link>
        );
      })}
    </div>
  );
}
