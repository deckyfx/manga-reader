import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { MangaPageV2 } from "../../components/MangaPageV2";
import { ChapterNavigation } from "../../components/ChapterNavigation";
import { StickyHeader } from "../../components/StickyHeader";
import { api } from "../../lib/api";
import { catchError } from "../../../lib/error-handler";
import { useSnackbar } from "../../hooks/useSnackbar";
import type { Page, Chapter } from "../../../db/schema";

/**
 * Reader page - displays a single manga page with navigation
 */
export function ReaderPage() {
  const { seriesSlug, chapterSlug, pageNum } = useParams();
  const navigate = useNavigate();
  const { showSnackbar, SnackbarComponent } = useSnackbar();

  const [pageData, setPageData] = useState<{
    id: number;
    slug?: string | null;
    originalImage: string;
    createdAt: Date;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pagesCache, setPagesCache] = useState<Page[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [chaptersCache, setChaptersCache] = useState<Chapter[]>([]);
  const [chapterTitle, setChapterTitle] = useState("");

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

    // Load chapter and series in parallel
    const [error1, results] = await catchError(
      Promise.all([
        api.api.chapters({ slug: chapterSlug! }).get(),
        api.api.series({ slug: seriesSlug! }).get(),
      ]),
    );

    if (error1) {
      console.error("Failed to load chapter:", error1);
      setLoading(false);
      return;
    }

    const [chapterResult, seriesResult] = results;

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

    // Set chapter title
    setChapterTitle(chapter.title);

    // Validate relationship: chapter must belong to series
    if (chapter.seriesId !== series.id) {
      console.warn(
        `Chapter ${chapterSlug} does not belong to series ${seriesSlug}. Redirecting to correct series...`,
      );

      // Load the correct series for this chapter
      const [error2, correctSeriesResult] = await catchError(
        api.api
          .series({ slug: `s${String(chapter.seriesId).padStart(5, "0")}` })
          .get(),
      );

      if (error2) {
        console.error("Failed to load correct series:", error2);
        setLoading(false);
        return;
      }

      if (
        correctSeriesResult.data?.success &&
        correctSeriesResult.data.series
      ) {
        const correctSeries = correctSeriesResult.data.series;
        // Redirect to correct URL
        navigate(`/r/${correctSeries.slug}/${chapterSlug}/${pageNum}`, {
          replace: true,
        });
      }
      setLoading(false);
      return;
    }

    // Fetch all pages for the chapter (ONCE)
    const [error3, pagesResult] = await catchError(
      api.api.chapters({ slug: chapterSlug! }).pages.get(),
    );

    if (error3) {
      console.error("Failed to load pages:", error3);
      setLoading(false);
      return;
    }

    if (pagesResult.data?.success && pagesResult.data.pages) {
      const pages = pagesResult.data.pages;
      setPagesCache(pages); // Cache all pages
      setTotalPages(pages.length);

      // Set initial page
      const page = pages.find((p) => p.orderNum === currentPage);
      if (page) {
        setPageData(page);
      }
    }

    // Fetch all chapters for the series (for next/previous chapter navigation)
    const [error4, chaptersResult] = await catchError(
      api.api.series({ slug: seriesSlug! }).chapters.get(),
    );

    if (error4) {
      console.error("Failed to load chapters:", error4);
      setLoading(false);
      return;
    }

    if (chaptersResult.data?.success && chaptersResult.data.chapters) {
      setChaptersCache(chaptersResult.data.chapters);
    }

    setLoading(false);
  };

  // Update current page from cache (no API call)
  const updateCurrentPage = () => {
    const page = pagesCache.find((p) => p.orderNum === currentPage);
    if (page) {
      setPageData(page);
    }
  };

  const goToPreviousPage = async () => {
    if (currentPage > 1) {
      // Navigate to previous page in same chapter
      navigate(`/r/${seriesSlug}/${chapterSlug}/${currentPage - 1}`);
    } else {
      // At first page - try to go to previous chapter's last page
      const currentChapterIndex = chaptersCache.findIndex(
        (ch) => ch.slug === chapterSlug,
      );

      if (currentChapterIndex > 0) {
        const previousChapter = chaptersCache[currentChapterIndex - 1];

        if (!previousChapter || !previousChapter.slug) return;

        // Load previous chapter's pages to get last page
        const [error, pagesResult] = await catchError(
          api.api.chapters({ slug: previousChapter.slug }).pages.get(),
        );

        if (error) {
          console.error("Failed to load previous chapter:", error);
          return;
        }

        if (
          pagesResult.data?.success &&
          pagesResult.data.pages &&
          pagesResult.data.pages.length > 0
        ) {
          const lastPage = pagesResult.data.pages.length;
          navigate(`/r/${seriesSlug}/${previousChapter.slug}/${lastPage}`);
        }
      }
    }
  };

  const goToNextPage = async () => {
    if (currentPage < totalPages) {
      // Navigate to next page in same chapter
      navigate(`/r/${seriesSlug}/${chapterSlug}/${currentPage + 1}`);
    } else {
      // At last page - try to go to next chapter's first page
      const currentChapterIndex = chaptersCache.findIndex(
        (ch) => ch.slug === chapterSlug,
      );

      if (
        currentChapterIndex !== -1 &&
        currentChapterIndex < chaptersCache.length - 1
      ) {
        const nextChapter = chaptersCache[currentChapterIndex + 1];

        if (!nextChapter || !nextChapter.slug) return;

        // Load next chapter's pages to check if it has pages
        const [error, pagesResult] = await catchError(
          api.api.chapters({ slug: nextChapter.slug }).pages.get(),
        );

        if (error) {
          console.error("Failed to load next chapter:", error);
          return;
        }

        if (
          pagesResult.data?.success &&
          pagesResult.data.pages &&
          pagesResult.data.pages.length > 0
        ) {
          navigate(`/r/${seriesSlug}/${nextChapter.slug}/1`);
        }
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100">
      {SnackbarComponent}
      <StickyHeader
        backLink={`/r/${seriesSlug}`}
        backText="&larr; Back to Chapters"
        title={chapterTitle}
        actions={
          <>
            <button
              onClick={() =>
                navigate(`/studio/${chapterSlug}#${pageData?.slug || ""}`)
              }
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition-colors whitespace-nowrap flex items-center gap-2"
              title="Open Studio editor"
            >
              <i className="fas fa-palette"></i>
              <span>Studio</span>
            </button>

            <span className="text-gray-700 font-semibold whitespace-nowrap">
              Page {currentPage} / {totalPages}
            </span>
          </>
        }
      />

      <div className="container mx-auto px-4 py-8">
        {/* Manga Page or Loading Spinner */}
        <div className="flex justify-center">
          {loading ? (
            <div className="flex items-center justify-center min-h-[600px]">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
            </div>
          ) : pageData ? (
            <MangaPageV2
              page={pageData}
              onPrevious={goToPreviousPage}
              onNext={goToNextPage}
              showNotification={showSnackbar}
            />
          ) : (
            <div className="bg-white rounded-lg shadow-lg p-8 text-center">
              <p className="text-gray-600 text-lg">Page not found.</p>
            </div>
          )}
        </div>

        {/* Navigation Footer */}
        <div className="flex justify-center gap-4 mt-8">
          {(() => {
            // Detect if at chapter boundaries
            const currentChapterIndex = chaptersCache.findIndex(
              (ch) => ch.slug === chapterSlug,
            );
            const hasPreviousChapter = currentChapterIndex > 0;
            const hasNextChapter =
              currentChapterIndex !== -1 &&
              currentChapterIndex < chaptersCache.length - 1;

            const isAtPreviousChapterBoundary =
              currentPage === 1 && hasPreviousChapter;
            const isAtNextChapterBoundary =
              currentPage === totalPages && hasNextChapter;

            const isPreviousDisabled =
              loading || (currentPage === 1 && !hasPreviousChapter);
            const isNextDisabled =
              loading || (currentPage === totalPages && !hasNextChapter);

            return (
              <>
                <button
                  onClick={goToPreviousPage}
                  disabled={isPreviousDisabled}
                  className={`px-6 py-3 rounded-lg font-semibold transition-colors flex items-center gap-2 ${
                    isPreviousDisabled
                      ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                      : isAtPreviousChapterBoundary
                        ? "bg-purple-500 hover:bg-purple-600 text-white"
                        : "bg-blue-500 hover:bg-blue-600 text-white"
                  }`}
                >
                  <i className="fas fa-arrow-left"></i>
                  <span>
                    {isAtPreviousChapterBoundary
                      ? "Previous Chapter"
                      : "Previous Page"}
                  </span>
                </button>

                <button
                  onClick={goToNextPage}
                  disabled={isNextDisabled}
                  className={`px-6 py-3 rounded-lg font-semibold transition-colors flex items-center gap-2 ${
                    isNextDisabled
                      ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                      : isAtNextChapterBoundary
                        ? "bg-purple-500 hover:bg-purple-600 text-white"
                        : "bg-blue-500 hover:bg-blue-600 text-white"
                  }`}
                >
                  <span>
                    {isAtNextChapterBoundary ? "Next Chapter" : "Next Page"}
                  </span>
                  <i className="fas fa-arrow-right"></i>
                </button>
              </>
            );
          })()}
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
