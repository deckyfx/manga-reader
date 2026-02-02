import { useState, useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../../lib/api";
import { useSnackbar } from "../../hooks/useSnackbar";

interface Page {
  id: number;
  chapterId: number;
  originalImage: string;
  orderNum: number;
}

interface Chapter {
  id: number;
  seriesId: number;
  title: string;
  slug: string;
}

interface Series {
  id: number;
  title: string;
  slug: string;
}

/**
 * Chapter Gallery Page - displays all pages in a grid layout with management features
 */
export function ChapterGalleryPage() {
  const { seriesId, chapterId } = useParams();
  const { showSnackbar, SnackbarComponent } = useSnackbar();
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedPage, setDraggedPage] = useState<Page | null>(null);
  const [pageToDelete, setPageToDelete] = useState<Page | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (seriesId && chapterId) {
      loadChapterData();
    }
  }, [seriesId, chapterId]);

  const loadChapterData = async () => {
    try {
      // Load series info
      const seriesResult = await api.api.series({ id: seriesId! }).get();
      if (seriesResult.data?.success && seriesResult.data.series) {
        setSeries(seriesResult.data.series);
      }

      // Load chapter info
      const chapterResult = await api.api.chapters({ id: chapterId! }).get();
      if (chapterResult.data?.success && chapterResult.data.chapter) {
        setChapter(chapterResult.data.chapter);
      }

      // Load pages
      const pagesResult = await api.api.chapters({ id: chapterId! }).pages.get();
      if (pagesResult.data?.success && pagesResult.data.pages) {
        setPages(pagesResult.data.pages);
      }
    } catch (error) {
      console.error("Failed to load chapter data:", error);
      showSnackbar("Failed to load chapter", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (page: Page, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPageToDelete(page);
    deleteDialogRef.current?.showModal();
  };

  const handleDeleteConfirm = async () => {
    if (!pageToDelete) return;

    setDeleting(true);
    try {
      const result = await api.api.pages({ id: pageToDelete.id.toString() }).delete();

      if (result.data?.success) {
        showSnackbar("Page deleted successfully!", "success");
        deleteDialogRef.current?.close();
        setPageToDelete(null);
        loadChapterData();
      } else {
        showSnackbar(result.data?.error || "Failed to delete page", "error");
      }
    } catch (error) {
      console.error("Failed to delete page:", error);
      showSnackbar("Failed to delete page", "error");
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    deleteDialogRef.current?.close();
    setPageToDelete(null);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Always add to the end
      const position = pages.length;

      // Upload page
      const result = await api.api["upload-page"].post({
        chapterId: parseInt(chapterId!),
        position: position,
        image: file,
      });

      if (result.data?.success) {
        showSnackbar("Page uploaded successfully!", "success");
        e.target.value = "";
        loadChapterData();
      } else {
        showSnackbar(result.data?.error || "Failed to upload page", "error");
      }
    } catch (error) {
      console.error("Failed to upload page:", error);
      showSnackbar("Failed to upload page", "error");
    }
  };

  const handleDragStart = (page: Page, e: React.DragEvent) => {
    setDraggedPage(page);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = async (targetPage: Page, e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedPage || draggedPage.id === targetPage.id) return;

    const newPages = [...pages];
    const draggedIndex = newPages.findIndex((p) => p.id === draggedPage.id);
    const targetIndex = newPages.findIndex((p) => p.id === targetPage.id);

    // Remove dragged page and insert at target position
    newPages.splice(draggedIndex, 1);
    newPages.splice(targetIndex, 0, draggedPage);

    // Update orderNum for all pages
    const updates = newPages.map((page, index) => ({
      id: page.id,
      orderNum: index + 1,
    }));

    // Optimistically update UI
    setPages(updates.map((u) => {
      const page = pages.find((p) => p.id === u.id)!;
      return { ...page, orderNum: u.orderNum };
    }));

    try {
      // Send batch update to server
      const result = await api.api["reorder-pages"].post({ updates });

      if (result.data?.success) {
        showSnackbar("Pages reordered successfully!", "success");
      } else {
        showSnackbar(result.data?.error || "Failed to reorder pages", "error");
        loadChapterData(); // Reload on error
      }
    } catch (error) {
      console.error("Failed to reorder pages:", error);
      showSnackbar("Failed to reorder pages", "error");
      loadChapterData(); // Reload on error
    }

    setDraggedPage(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!chapter || !series) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100">
        <div className="container mx-auto px-4 py-8">
          <Link
            to={`/r/${seriesId}`}
            className="text-blue-600 hover:underline mb-4 inline-block"
          >
            ← Back to Series
          </Link>
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <p className="text-gray-600 text-lg">Chapter not found.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <header className="mb-8">
          <Link
            to={`/r/${seriesId}`}
            className="text-blue-600 hover:underline mb-4 inline-block"
          >
            ← Back to {series.title}
          </Link>
          <h1 className="text-4xl font-bold text-gray-800">
            Chapter {chapter.slug}: {chapter.title}
          </h1>
          <p className="text-lg text-gray-600 mt-2">
            {pages.length} page{pages.length !== 1 ? "s" : ""}
          </p>
        </header>

        {/* Upload Section */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Upload Page</h2>
          <div>
            <label htmlFor="page-upload" className="block text-sm font-semibold text-gray-700 mb-2">
              Select Image (will be added at the end)
            </label>
            <input
              type="file"
              id="page-upload"
              accept="image/*"
              onChange={handleUpload}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Drag and drop pages below to reorder them
          </p>
        </div>

        {/* Pages Grid */}
        {pages.length === 0 ? (
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <p className="text-gray-600 text-lg">No pages available.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {pages.map((page) => (
              <div
                key={page.id}
                draggable
                onDragStart={(e) => handleDragStart(page, e)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(page, e)}
                className={`bg-white rounded-lg shadow-lg overflow-hidden hover:shadow-2xl transition-shadow cursor-move relative ${
                  draggedPage?.id === page.id ? "opacity-50" : ""
                }`}
              >
                <Link to={`/r/${seriesId}/${chapterId}/${page.orderNum}`} className="block">
                  <img
                    src={page.originalImage}
                    alt={`Page ${page.orderNum}`}
                    className="w-full h-auto pointer-events-none"
                  />
                  <div className="p-3 text-center">
                    <p className="text-sm font-semibold text-gray-700">
                      Page {page.orderNum}
                    </p>
                  </div>
                </Link>
                <button
                  onClick={(e) => handleDeleteClick(page, e)}
                  className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold shadow-lg transition-colors z-10"
                  title="Delete page"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <dialog
        ref={deleteDialogRef}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg shadow-2xl p-0 backdrop:bg-black backdrop:opacity-70 max-w-none"
      >
        <div className="bg-white rounded-lg p-6 min-w-[400px]">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">
            Delete Page?
          </h2>
          <p className="text-gray-600 mb-6">
            Are you sure you want to delete Page {pageToDelete?.orderNum}? This action cannot be undone.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={handleDeleteCancel}
              disabled={deleting}
              className="px-4 py-2 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                deleting
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-red-500 hover:bg-red-600 text-white"
              }`}
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </dialog>

      {SnackbarComponent}
    </div>
  );
}
