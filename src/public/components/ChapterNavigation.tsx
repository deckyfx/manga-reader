import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

interface ChapterNavigationProps {
  currentSeriesSlug: string;
  currentChapterSlug: string;
  currentPage: number;
  totalPages: number;
}

interface Series {
  id: number;
  title: string;
  slug: string | null;
}

interface Chapter {
  id: number;
  title: string;
  chapterNumber: string;
  slug: string | null;
}

/**
 * ChapterNavigation - Collapsible navigation panel for jumping between series, chapters, and pages
 *
 * Features:
 * - Lazy-loaded series and chapter lists (only load when opened)
 * - Filterable by title and chapter number
 * - Collapsible to floating action button (FAB)
 * - Follows scroll when collapsed
 */
export function ChapterNavigation({
  currentSeriesSlug,
  currentChapterSlug,
  currentPage,
  totalPages,
}: ChapterNavigationProps) {
  const navigate = useNavigate();

  // UI State
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isSeriesOpen, setIsSeriesOpen] = useState(false);
  const [isChaptersOpen, setIsChaptersOpen] = useState(false);

  // Data State
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [chaptersList, setChaptersList] = useState<Chapter[]>([]);
  const [seriesLoaded, setSeriesLoaded] = useState(false);
  const [chaptersLoaded, setChaptersLoaded] = useState(false);

  // Filter State
  const [seriesFilter, setSeriesFilter] = useState("");
  const [chapterFilter, setChapterFilter] = useState("");
  const [pageInput, setPageInput] = useState(currentPage.toString());

  // Update page input when currentPage changes
  useEffect(() => {
    setPageInput(currentPage.toString());
  }, [currentPage]);

  // Lazy load series list when dropdown opens (only series with chapters)
  const handleSeriesToggle = async () => {
    const newOpen = !isSeriesOpen;
    setIsSeriesOpen(newOpen);

    if (newOpen && !seriesLoaded) {
      try {
        const result = await api.api.series.get({
          query: { hasChapters: true },
        });
        if (result.data?.success && result.data.series) {
          setSeriesList(result.data.series);
          setSeriesLoaded(true);
        }
      } catch (error) {
        console.error("Failed to load series:", error);
      }
    }
  };

  // Lazy load chapters list when dropdown opens
  const handleChaptersToggle = async () => {
    const newOpen = !isChaptersOpen;
    setIsChaptersOpen(newOpen);

    if (newOpen && !chaptersLoaded) {
      try {
        const result = await api.api
          .series({ slug: currentSeriesSlug })
          .chapters.get();
        if (result.data?.success && result.data.chapters) {
          setChaptersList(result.data.chapters);
          setChaptersLoaded(true);
        }
      } catch (error) {
        console.error("Failed to load chapters:", error);
      }
    }
  };

  // Filter series by title
  const filteredSeries = seriesList.filter((series) =>
    series.title.toLowerCase().includes(seriesFilter.toLowerCase())
  );

  // Filter chapters by title AND chapter number
  const filteredChapters = chaptersList.filter(
    (chapter) =>
      chapter.title.toLowerCase().includes(chapterFilter.toLowerCase()) ||
      chapter.chapterNumber.toLowerCase().includes(chapterFilter.toLowerCase())
  );

  // Navigate to selected series (first chapter, first page)
  const handleSeriesSelect = async (seriesSlug: string) => {
    try {
      const result = await api.api.series({ slug: seriesSlug }).chapters.get();
      if (result.data?.success && result.data.chapters && result.data.chapters.length > 0) {
        const firstChapter = result.data.chapters[0];
        navigate(`/r/${seriesSlug}/${firstChapter?.slug}/1`);
        setIsSeriesOpen(false);
        setSeriesFilter("");
      }
    } catch (error) {
      console.error("Failed to navigate to series:", error);
    }
  };

  // Navigate to selected chapter (first page)
  const handleChapterSelect = (chapterSlug: string) => {
    navigate(`/r/${currentSeriesSlug}/${chapterSlug}/1`);
    setIsChaptersOpen(false);
    setChapterFilter("");
  };

  // Navigate to entered page number
  const handlePageJump = () => {
    const pageNum = parseInt(pageInput);
    if (pageNum >= 1 && pageNum <= totalPages) {
      navigate(`/r/${currentSeriesSlug}/${currentChapterSlug}/${pageNum}`);
    }
  };

  // FAB (Floating Action Button) when collapsed
  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className="fixed bottom-8 right-8 w-14 h-14 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center transition-colors z-50"
        title="Open navigation"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </button>
    );
  }

  // Full navigation panel when expanded
  return (
    <div className="fixed top-20 right-8 w-80 bg-white rounded-lg shadow-xl p-6 z-40 max-h-[calc(100vh-10rem)] overflow-y-auto">
      {/* Header with collapse button */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-800">Navigation</h3>
        <button
          onClick={() => setIsCollapsed(true)}
          className="text-gray-500 hover:text-gray-700"
          title="Collapse"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Series Selector */}
      <div className="mb-6">
        <button
          onClick={handleSeriesToggle}
          className="w-full flex items-center justify-between px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          <span className="font-semibold text-gray-700">Jump to Series</span>
          <svg
            className={`w-5 h-5 transition-transform ${isSeriesOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {isSeriesOpen && (
          <div className="mt-2 border border-gray-200 rounded-lg p-2">
            {/* Search filter */}
            <input
              type="text"
              placeholder="Search series..."
              value={seriesFilter}
              onChange={(e) => setSeriesFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-2 text-sm"
            />

            {/* Series list */}
            <div className="max-h-48 overflow-y-auto">
              {filteredSeries.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-2">
                  No series found
                </p>
              ) : (
                filteredSeries.map((series) => (
                  <button
                    key={series.id}
                    onClick={() => handleSeriesSelect(series.slug!)}
                    className={`w-full text-left px-3 py-2 rounded hover:bg-blue-50 transition-colors text-sm ${
                      series.slug === currentSeriesSlug
                        ? "bg-blue-100 font-semibold"
                        : ""
                    }`}
                  >
                    {series.title}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Chapter Selector */}
      <div className="mb-6">
        <button
          onClick={handleChaptersToggle}
          className="w-full flex items-center justify-between px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          <span className="font-semibold text-gray-700">Jump to Chapter</span>
          <svg
            className={`w-5 h-5 transition-transform ${isChaptersOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {isChaptersOpen && (
          <div className="mt-2 border border-gray-200 rounded-lg p-2">
            {/* Search filter */}
            <input
              type="text"
              placeholder="Search chapter..."
              value={chapterFilter}
              onChange={(e) => setChapterFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-2 text-sm"
            />

            {/* Chapters list */}
            <div className="max-h-48 overflow-y-auto">
              {filteredChapters.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-2">
                  No chapters found
                </p>
              ) : (
                filteredChapters.map((chapter) => (
                  <button
                    key={chapter.id}
                    onClick={() => handleChapterSelect(chapter.slug!)}
                    className={`w-full text-left px-3 py-2 rounded hover:bg-blue-50 transition-colors text-sm ${
                      chapter.slug === currentChapterSlug
                        ? "bg-blue-100 font-semibold"
                        : ""
                    }`}
                    title={chapter.title}
                  >
                    <div className="font-medium">Ch. {chapter.chapterNumber}</div>
                    <div className="text-xs text-gray-600">
                      {chapter.title.length > 50 ? `${chapter.title.substring(0, 50)}...` : chapter.title}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Page Selector */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Jump to Page
        </label>
        <div className="flex gap-2">
          <input
            type="number"
            min="1"
            max={totalPages}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handlePageJump();
              }
            }}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
            placeholder="Page number"
          />
          <button
            onClick={handlePageJump}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            Go
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Total: {totalPages} pages
        </p>
      </div>
    </div>
  );
}
