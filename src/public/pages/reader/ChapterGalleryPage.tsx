import { useState, useEffect, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useSnackbar } from "../../hooks/useSnackbar";
import { ChapterGalleryItem } from "../../components/ChapterGalleryItem";
import { StickyHeader } from "../../components/StickyHeader";
import { catchError } from "../../../lib/error-handler";

interface Page {
  id: number;
  chapterId: number;
  originalImage: string;
  orderNum: number;
  slug: string | null;
}

interface Chapter {
  id: number;
  seriesId: number;
  title: string;
  slug: string | null;
  chapterNumber: string;
}

interface Series {
  id: number;
  title: string;
  slug: string | null;
}

/**
 * Chapter Gallery Page - displays all pages in a grid layout with management features
 */
export function ChapterGalleryPage() {
  const { seriesSlug, chapterSlug } = useParams();
  const navigate = useNavigate();
  const { showSnackbar, SnackbarComponent } = useSnackbar();
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedPage, setDraggedPage] = useState<Page | null>(null);
  const [pageToDelete, setPageToDelete] = useState<Page | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (seriesSlug && chapterSlug) {
      loadChapterData();
    }
  }, [seriesSlug, chapterSlug]);

  const loadChapterData = async () => {
    setLoading(true);

    // Load chapter and series in parallel
    const [error1, results] = await catchError(
      Promise.all([
        api.api.chapters({ slug: chapterSlug! }).get(),
        api.api.series({ slug: seriesSlug! }).get(),
      ])
    );

    if (error1) {
      console.error("Failed to load chapter data:", error1);
      showSnackbar("Failed to load chapter", "error");
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

    // Validate relationship: chapter must belong to series
    if (chapter.seriesId !== series.id) {
      console.warn(
        `Chapter ${chapterSlug} does not belong to series ${seriesSlug}. Redirecting to correct series...`
      );

      // Load the correct series for this chapter
      const [error2, correctSeriesResult] = await catchError(
        api.api.series({ slug: `s${String(chapter.seriesId).padStart(5, "0")}` }).get()
      );

      if (error2) {
        console.error("Failed to load correct series:", error2);
        setLoading(false);
        return;
      }

      if (correctSeriesResult.data?.success && correctSeriesResult.data.series) {
        const correctSeries = correctSeriesResult.data.series;
        // Redirect to correct URL
        navigate(`/r/${correctSeries.slug}/${chapterSlug}`, {
          replace: true,
        });
      }
      setLoading(false);
      return;
    }

    // Fetch all pages for the chapter
    const [error3, pagesResult] = await catchError(
      api.api.chapters({ slug: chapterSlug! }).pages.get()
    );

    if (error3) {
      console.error("Failed to load pages:", error3);
      showSnackbar("Failed to load chapter", "error");
      setLoading(false);
      return;
    }

    if (pagesResult.data?.success && pagesResult.data.pages) {
      setPages(pagesResult.data.pages);
      setSeries(series);
      setChapter(chapter);
    }

    setLoading(false);
  };

  const handleDeleteClick = (page: Page, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPageToDelete(page);
    deleteDialogRef.current?.showModal();
  };

  const handleDeleteConfirm = async () => {
    if (!pageToDelete || !pageToDelete.slug) return;

    setDeleting(true);

    const [error, result] = await catchError(
      api.api.pages({ slug: pageToDelete.slug }).delete()
    );

    if (error) {
      console.error("Failed to delete page:", error);
      showSnackbar("Failed to delete page", "error");
      setDeleting(false);
      return;
    }

    if (result.data?.success) {
      showSnackbar("Page deleted successfully!", "success");
      deleteDialogRef.current?.close();
      setPageToDelete(null);
      loadChapterData();
    } else {
      showSnackbar(result.data?.error || "Failed to delete page", "error");
    }

    setDeleting(false);
  };

  const handleDeleteCancel = () => {
    deleteDialogRef.current?.close();
    setPageToDelete(null);
  };

  const handleAddPageClick = () => {
    const fileInput = document.getElementById(
      "page-upload",
    ) as HTMLInputElement;
    fileInput.click();
  };

  const handleFileSelected = async () => {
    const fileInput = document.getElementById(
      "page-upload",
    ) as HTMLInputElement;
    const selectedFile = fileInput.files?.[0];

    if (!selectedFile) return;

    // Validate file type
    if (!selectedFile.type.startsWith("image/")) {
      showSnackbar("Please upload an image file", "warning");
      fileInput.value = "";
      return;
    }

    setUploading(true);

    // Upload page (will be added at the end automatically)
    const [error, result] = await catchError(
      api.api.pages.upload.post({
        chapterId: chapter!.id.toString(),
        image: selectedFile,
      })
    );

    if (error) {
      console.error("Failed to upload page:", error);
      showSnackbar("Failed to upload page", "error");
      setUploading(false);
      return;
    }

    if (result.data?.success) {
      showSnackbar("Page uploaded successfully!", "success");
      fileInput.value = "";
      loadChapterData();
    } else {
      showSnackbar(result.data?.error || "Failed to upload page", "error");
    }

    setUploading(false);
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
    setPages(
      updates.map((u) => {
        const page = pages.find((p) => p.id === u.id)!;
        return { ...page, orderNum: u.orderNum };
      }),
    );

    // Send batch update to server
    const [error, result] = await catchError(
      api.api.pages.reorder.post({ updates })
    );

    if (error) {
      console.error("Failed to reorder pages:", error);
      showSnackbar("Failed to reorder pages", "error");
      loadChapterData(); // Reload on error
      setDraggedPage(null);
      return;
    }

    if (result.data?.success) {
      showSnackbar("Pages reordered successfully!", "success");
    } else {
      showSnackbar(result.data?.error || "Failed to reorder pages", "error");
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
            to={`/r/${series?.slug}`}
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
      <StickyHeader
        backLink={`/r/${series?.slug}`}
        backText={`← Back to ${series.title}`}
        title={`Chapter ${chapter.chapterNumber}: ${chapter.title}`}
        actions={
          <>
            <input
              type="file"
              id="page-upload"
              accept="image/*"
              onChange={handleFileSelected}
              className="hidden"
            />
            <button
              onClick={handleAddPageClick}
              disabled={uploading}
              className={`px-4 py-2 rounded-lg font-semibold transition-colors whitespace-nowrap ${
                uploading
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-blue-500 hover:bg-blue-600 text-white"
              }`}
            >
              {uploading ? "Uploading..." : "+ Add Page"}
            </button>
          </>
        }
      />

      <div className="container mx-auto px-4 py-8">
        <div className="mb-4 text-center text-gray-600">
          {pages.length} page{pages.length !== 1 ? "s" : ""} • Drag and drop to reorder
        </div>

        {/* Pages Grid */}
        {pages.length === 0 ? (
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <p className="text-gray-600 text-lg">No pages available.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {pages.map((page) => (
              <ChapterGalleryItem
                key={page.id}
                page={page}
                seriesSlug={series.slug!}
                chapterSlug={chapter.slug!}
                isDragging={draggedPage?.id === page.id}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDeleteClick={handleDeleteClick}
              />
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
            Are you sure you want to delete Page {pageToDelete?.orderNum}? This
            action cannot be undone.
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
