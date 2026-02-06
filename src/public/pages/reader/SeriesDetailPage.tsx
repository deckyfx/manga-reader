import { useState, useEffect, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useSnackbar } from "../../hooks/useSnackbar";
import { ChapterListItem } from "../../components/ChapterListItem";
import { StickyHeader } from "../../components/StickyHeader";
import { catchError } from "../../../lib/error-handler";

/**
 * Series Detail page - displays series info and chapter list
 */
export function SeriesDetailPage() {
  const { seriesSlug } = useParams();
  const navigate = useNavigate();
  const { showSnackbar, SnackbarComponent } = useSnackbar();
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const deleteChapterDialogRef = useRef<HTMLDialogElement>(null);
  const [series, setSeries] = useState<any>(null);
  const [chapters, setChapters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deletingChapter, setDeletingChapter] = useState(false);
  const [chapterToDelete, setChapterToDelete] = useState<any>(null);

  useEffect(() => {
    if (seriesSlug) {
      loadSeriesData();
    }
  }, [seriesSlug]);

  const loadSeriesData = async () => {
    const [error, results] = await catchError(
      Promise.all([
        api.api.series({ slug: seriesSlug! }).get(),
        api.api.series({ slug: seriesSlug! }).chapters.get(),
      ])
    );

    if (error) {
      console.error("[SeriesDetailPage] Failed to load series data:", error);
      setLoading(false);
      return;
    }

    const [seriesResult, chaptersResult] = results;

    if (seriesResult.data?.success && seriesResult.data.series) {
      setSeries(seriesResult.data.series);
    }

    if (chaptersResult.data?.success && chaptersResult.data.chapters) {
      setChapters(chaptersResult.data.chapters);
    }

    setLoading(false);
  };

  const handleDeleteClick = () => {
    deleteDialogRef.current?.showModal();
  };

  const handleDeleteConfirm = async () => {
    setDeleting(true);

    const [error, result] = await catchError(
      api.api.series({ slug: seriesSlug! }).delete()
    );

    if (error) {
      console.error("Failed to delete series:", error);
      showSnackbar("Failed to delete series", "error");
      setDeleting(false);
      return;
    }

    if (result.data?.success) {
      showSnackbar("Series deleted successfully!", "success");
      deleteDialogRef.current?.close();

      // Navigate after a short delay
      setTimeout(() => {
        navigate("/r");
      }, 1000);
    } else {
      showSnackbar(result.data?.error || "Failed to delete series", "error");
    }

    setDeleting(false);
  };

  const handleDeleteCancel = () => {
    deleteDialogRef.current?.close();
  };

  const handleDeleteChapterClick = (chapter: any) => {
    setChapterToDelete(chapter);
    deleteChapterDialogRef.current?.showModal();
  };

  const handleDeleteChapterConfirm = async () => {
    if (!chapterToDelete) return;

    setDeletingChapter(true);

    const [error, result] = await catchError(
      api.api.chapters({ slug: chapterToDelete.slug }).delete()
    );

    if (error) {
      console.error("Failed to delete chapter:", error);
      showSnackbar("Failed to delete chapter", "error");
      setDeletingChapter(false);
      return;
    }

    if (result.data?.success) {
      showSnackbar("Chapter deleted successfully!", "success");
      deleteChapterDialogRef.current?.close();
      setChapterToDelete(null);

      // Reload chapters list
      loadSeriesData();
    } else {
      showSnackbar(result.data?.error || "Failed to delete chapter", "error");
    }

    setDeletingChapter(false);
  };

  const handleDeleteChapterCancel = () => {
    deleteChapterDialogRef.current?.close();
    setChapterToDelete(null);
  };

  const handleDownloadChapterClick = async (chapter: any) => {
    try {
      showSnackbar("Preparing download...", "info");

      // Call API to download chapter as tar.gz
      const response = await fetch(
        `/api/chapters/${chapter.slug}/download-zip`,
        {
          method: "POST",
        }
      );

      if (!response.ok) {
        showSnackbar("Failed to download chapter", "error");
        return;
      }

      // Get the blob and create download link
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${series.title} - ${chapter.title}.tar.gz`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      showSnackbar("Chapter downloaded successfully!", "success");
    } catch (error) {
      console.error("Download error:", error);
      showSnackbar("Failed to download chapter", "error");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!series) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100">
        <div className="container mx-auto px-4 py-8">
          <Link
            to="/r"
            className="text-blue-600 hover:underline mb-4 inline-block flex items-center gap-2"
          >
            <i className="fas fa-arrow-left"></i>
            <span>Back to Series List</span>
          </Link>
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <p className="text-gray-600 text-lg">Series not found.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100">
      <StickyHeader
        backLink="/r"
        backText="← Back to Series List"
        title={series.title}
        actions={
          <>
            <Link
              to={`/a/series/${series.slug}/edit`}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold transition-colors whitespace-nowrap flex items-center gap-2"
            >
              <i className="fas fa-edit"></i>
              <span>Edit</span>
            </Link>
            <button
              onClick={handleDeleteClick}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold transition-colors whitespace-nowrap flex items-center gap-2"
            >
              <i className="fas fa-trash"></i>
              <span>Delete</span>
            </button>
          </>
        }
      />

      <div className="container mx-auto px-4 py-8">
        {/* Series Info */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">

          <div className="flex gap-6">
            {series.coverArt && (
              <div className="flex-shrink-0">
                <img
                  src={`${series.coverArt}?t=${new Date().getTime()}`}
                  alt={`${series.title} cover`}
                  className="w-48 rounded-lg shadow-lg"
                />
              </div>
            )}

            <div className="flex-1">
              {series.synopsis && (
                <p className="text-gray-700 mb-4 leading-relaxed">
                  {series.synopsis}
                </p>
              )}

              {series.tags && (
                <div className="flex flex-wrap gap-2">
                  {series.tags.split(',').map((tag: string, i: number) => (
                    <button
                      key={i}
                      onClick={() => navigate(`/r?mustHaveTags=${encodeURIComponent(tag.trim())}`)}
                      className="text-sm bg-blue-100 text-blue-800 px-3 py-1 rounded-full hover:bg-blue-200 transition-colors cursor-pointer"
                    >
                      {tag.trim()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Chapters List */}
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-gray-800">Chapters</h2>
            <Link
              to={`/a/series/${series.slug}/chapter`}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold transition-colors flex items-center gap-2"
            >
              <i className="fas fa-upload"></i>
              <span>Upload Chapter</span>
            </Link>
          </div>
          {chapters.length === 0 ? (
            <div className="bg-white rounded-lg shadow-lg p-8 text-center">
              <p className="text-gray-600 text-lg">
                No chapters available yet.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {chapters.map((chapter) => (
                <ChapterListItem
                  key={chapter.slug}
                  chapter={chapter}
                  seriesSlug={series.slug}
                  onDeleteClick={handleDeleteChapterClick}
                  onDownloadClick={handleDownloadChapterClick}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <dialog
        ref={deleteDialogRef}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg shadow-2xl p-0 backdrop:bg-black backdrop:opacity-70 max-w-none"
      >
        <div className="bg-white rounded-lg p-6 min-w-[400px]">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">
            Delete Series?
          </h2>
          <p className="text-gray-600 mb-6">
            Are you sure you want to delete "{series?.title}"? This will also
            delete all chapters and pages associated with this series. This
            action cannot be undone.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={handleDeleteCancel}
              disabled={deleting}
              className="px-4 py-2 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors flex items-center gap-2"
            >
              <i className="fas fa-times"></i>
              <span>Cancel</span>
            </button>
            <button
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className={`px-4 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2 ${
                deleting
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-red-500 hover:bg-red-600 text-white"
              }`}
            >
              <i className="fas fa-trash"></i>
              <span>{deleting ? "Deleting..." : "Delete"}</span>
            </button>
          </div>
        </div>
      </dialog>

      {/* Delete Chapter Confirmation Dialog */}
      <dialog
        ref={deleteChapterDialogRef}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg shadow-2xl p-0 backdrop:bg-black backdrop:opacity-70 max-w-none"
      >
        <div className="bg-white rounded-lg p-6 min-w-[400px]">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">
            Delete Chapter?
          </h2>
          <p className="text-gray-600 mb-6">
            Are you sure you want to delete "Chapter {chapterToDelete?.slug}:{" "}
            {chapterToDelete?.title}"? This will also delete all pages in this
            chapter. This action cannot be undone.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={handleDeleteChapterCancel}
              disabled={deletingChapter}
              className="px-4 py-2 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors flex items-center gap-2"
            >
              <i className="fas fa-times"></i>
              <span>Cancel</span>
            </button>
            <button
              onClick={handleDeleteChapterConfirm}
              disabled={deletingChapter}
              className={`px-4 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2 ${
                deletingChapter
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-red-500 hover:bg-red-600 text-white"
              }`}
            >
              <i className="fas fa-trash"></i>
              <span>{deletingChapter ? "Deleting..." : "Delete"}</span>
            </button>
          </div>
        </div>
      </dialog>

      {SnackbarComponent}
    </div>
  );
}
