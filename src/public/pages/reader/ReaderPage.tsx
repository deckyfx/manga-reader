import { useState, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { MangaPage } from "../../components/MangaPage";
import { api } from "../../../lib/api";

/**
 * Reader page - displays a single manga page with navigation
 */
export function ReaderPage() {
  const { seriesId, chapterId, pageNum } = useParams();
  const navigate = useNavigate();

  const [pageData, setPageData] = useState<{
    id: number;
    originalImage: string;
    createdAt: Date;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(0);

  const currentPage = parseInt(pageNum || "1");

  useEffect(() => {
    loadPage();
  }, [seriesId, chapterId, pageNum]);

  const loadPage = async () => {
    setLoading(true);
    try {
      // Fetch all pages for the chapter
      const pagesResult = await api.api.chapters({ id: chapterId! }).pages.get();

      if (pagesResult.data?.success && pagesResult.data.pages) {
        const pages = pagesResult.data.pages;
        setTotalPages(pages.length);

        // Find the page with matching orderNum
        const page = pages.find((p: any) => p.orderNum === currentPage);
        if (page) {
          setPageData(page);
        }
      }
    } catch (error) {
      console.error("Failed to load page:", error);
    } finally {
      setLoading(false);
    }
  };

  const goToPreviousPage = () => {
    if (currentPage > 1) {
      navigate(`/r/${seriesId}/${chapterId}/${currentPage - 1}`);
    }
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      navigate(`/r/${seriesId}/${chapterId}/${currentPage + 1}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!pageData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100">
        <div className="container mx-auto px-4 py-8">
          <Link to={`/r/${seriesId}`} className="text-blue-600 hover:underline mb-4 inline-block">
            ← Back to Chapters
          </Link>
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <p className="text-gray-600 text-lg">Page not found.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100">
      <div className="container mx-auto px-4 py-8">
        {/* Navigation Header */}
        <div className="flex items-center justify-between mb-6">
          <Link
            to={`/r/${seriesId}`}
            className="text-blue-600 hover:underline"
          >
            ← Back to Chapters
          </Link>

          <div className="flex items-center gap-4">
            <span className="text-gray-700 font-semibold">
              Page {currentPage} / {totalPages}
            </span>
          </div>
        </div>

        {/* Manga Page */}
        <div className="flex justify-center">
          <MangaPage
            page={pageData}
            onPrevious={goToPreviousPage}
            onNext={goToNextPage}
          />
        </div>

        {/* Navigation Footer */}
        <div className="flex justify-center gap-4 mt-8">
          <button
            onClick={goToPreviousPage}
            disabled={currentPage === 1}
            className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
              currentPage === 1
                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                : "bg-blue-500 hover:bg-blue-600 text-white"
            }`}
          >
            ← Previous
          </button>

          <button
            onClick={goToNextPage}
            disabled={currentPage === totalPages}
            className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
              currentPage === totalPages
                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                : "bg-blue-500 hover:bg-blue-600 text-white"
            }`}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
