import { useState, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { MangaPage } from "../../components/MangaPage";
import { ChapterNavigation } from "../../components/ChapterNavigation";
import { api } from "../../lib/api";

/**
 * Reader page - displays a single manga page with navigation
 */
export function ReaderPage() {
  const { seriesSlug, chapterSlug, pageNum } = useParams();
  const navigate = useNavigate();

  const [pageData, setPageData] = useState<{
    id: number;
    originalImage: string;
    createdAt: Date;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pagesCache, setPagesCache] = useState<any[]>([]);
  const [totalPages, setTotalPages] = useState(0);

  const currentPage = parseInt(pageNum || "1");

  // Load chapter data ONCE when chapter changes
  useEffect(() => {
    loadChapter();
  }, [seriesSlug, chapterSlug]);

  // Update current page when pageNum changes (no API call)
  useEffect(() => {
    if (pagesCache.length > 0) {
      updateCurrentPage();
    }
  }, [pageNum, pagesCache]);

  // Load chapter data ONCE (series, chapter, all pages)
  const loadChapter = async () => {
    setLoading(true);
    try {
      // Load chapter and series in parallel
      const [chapterResult, seriesResult] = await Promise.all([
        api.api.chapters({ slug: chapterSlug! }).get(),
        api.api.series({ slug: seriesSlug! }).get(),
      ]);

      // Validate chapter exists
      if (!chapterResult.data?.success || !chapterResult.data.chapter) {
        setLoading(false);
        return;
      }

      // Validate series exists
      if (!seriesResult.data?.success || !seriesResult.data.series) {
        setLoading(false);
        return;
      }

      const chapter = chapterResult.data.chapter;
      const series = seriesResult.data.series;

      // Validate relationship: chapter must belong to series
      if (chapter.seriesId !== series.id) {
        console.warn(
          `Chapter ${chapterSlug} does not belong to series ${seriesSlug}. Redirecting to correct series...`
        );

        // Load the correct series for this chapter
        const correctSeriesResult = await api.api
          .series({ slug: `s${String(chapter.seriesId).padStart(5, "0")}` })
          .get();

        if (correctSeriesResult.data?.success && correctSeriesResult.data.series) {
          const correctSeries = correctSeriesResult.data.series;
          // Redirect to correct URL
          navigate(`/r/${correctSeries.slug}/${chapterSlug}/${pageNum}`, {
            replace: true,
          });
        }
        return;
      }

      // Fetch all pages for the chapter (ONCE)
      const pagesResult = await api.api
        .chapters({ slug: chapterSlug! })
        .pages.get();

      if (pagesResult.data?.success && pagesResult.data.pages) {
        const pages = pagesResult.data.pages;
        setPagesCache(pages); // Cache all pages
        setTotalPages(pages.length);

        // Set initial page
        const page = pages.find((p: any) => p.orderNum === currentPage);
        if (page) {
          setPageData(page);
        }
      }
    } catch (error) {
      console.error("Failed to load chapter:", error);
    } finally {
      setLoading(false);
    }
  };

  // Update current page from cache (no API call)
  const updateCurrentPage = () => {
    const page = pagesCache.find((p: any) => p.orderNum === currentPage);
    if (page) {
      setPageData(page);
    }
  };

  const goToPreviousPage = () => {
    if (currentPage > 1) {
      navigate(`/r/${seriesSlug}/${chapterSlug}/${currentPage - 1}`);
    }
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      navigate(`/r/${seriesSlug}/${chapterSlug}/${currentPage + 1}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100">
      <div className="container mx-auto px-4 py-8">
        {/* Navigation Header */}
        <div className="flex items-center justify-between mb-6">
          <Link to={`/r/${seriesSlug}`} className="text-blue-600 hover:underline">
            ← Back to Chapters
          </Link>

          <div className="flex items-center gap-4">
            <span className="text-gray-700 font-semibold">
              Page {currentPage} / {totalPages}
            </span>
          </div>
        </div>

        {/* Manga Page or Loading Spinner */}
        <div className="flex justify-center">
          {loading ? (
            <div className="flex items-center justify-center min-h-[600px]">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
            </div>
          ) : pageData ? (
            <MangaPage
              page={pageData}
              onPrevious={goToPreviousPage}
              onNext={goToNextPage}
            />
          ) : (
            <div className="bg-white rounded-lg shadow-lg p-8 text-center">
              <p className="text-gray-600 text-lg">Page not found.</p>
            </div>
          )}
        </div>

        {/* Navigation Footer */}
        <div className="flex justify-center gap-4 mt-8">
          <button
            onClick={goToPreviousPage}
            disabled={currentPage === 1 || loading}
            className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
              currentPage === 1 || loading
                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                : "bg-blue-500 hover:bg-blue-600 text-white"
            }`}
          >
            ← Previous
          </button>

          <button
            onClick={goToNextPage}
            disabled={currentPage === totalPages || loading}
            className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
              currentPage === totalPages || loading
                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                : "bg-blue-500 hover:bg-blue-600 text-white"
            }`}
          >
            Next →
          </button>
        </div>
      </div>

      {/* Chapter Navigation Panel */}
      {!loading && seriesSlug && chapterSlug && (
        <ChapterNavigation
          currentSeriesSlug={seriesSlug}
          currentChapterSlug={chapterSlug}
          currentPage={currentPage}
          totalPages={totalPages}
        />
      )}
    </div>
  );
}
