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
  const urlDialogRef = useRef<HTMLDialogElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedPage, setDraggedPage] = useState<Page | null>(null);
  const [pageToDelete, setPageToDelete] = useState<Page | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [refererInput, setRefererInput] = useState("");
  const [userAgentInput, setUserAgentInput] = useState("");

  useEffect(() => {
    if (seriesSlug && chapterSlug) {
      loadChapterData();
    }
  }, [seriesSlug, chapterSlug]);

  // Close add menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) {
        setShowAddMenu(false);
      }
    };

    if (showAddMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showAddMenu]);

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
      api.api.pages.delete.delete(undefined, {
        query: {
          page: pageToDelete.slug,
        },
      })
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

  const handleUrlDialogCancel = () => {
    urlDialogRef.current?.close();
    setUrlInput("");
    setRefererInput("");
    setUserAgentInput("");
  };

  const handleUrlDownload = async () => {
    if (!urlInput.trim() || !chapter) return;

    setDownloading(true);

    const [error, result] = await catchError(
      api.api.pages.download.post({
        chapterId: chapter.id.toString(),
        url: urlInput.trim(),
        referer: refererInput.trim() || undefined,
        userAgent: userAgentInput.trim() || undefined,
      })
    );

    if (error) {
      console.error("Failed to download page:", error);
      showSnackbar("Failed to download page", "error");
      setDownloading(false);
      return;
    }

    if (result.data?.success) {
      showSnackbar("Page downloaded successfully!", "success");
      urlDialogRef.current?.close();
      setUrlInput("");
      setRefererInput("");
      setUserAgentInput("");
      loadChapterData();
    } else {
      showSnackbar(result.data?.error || "Failed to download page", "error");
    }

    setDownloading(false);
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
            className="text-blue-600 hover:underline mb-4 inline-block flex items-center gap-2"
          >
            <i className="fas fa-arrow-left"></i>
            <span>Back to Series</span>
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
            <div className="relative" ref={addMenuRef}>
              <button
                onClick={() => setShowAddMenu(!showAddMenu)}
                disabled={uploading || downloading}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors whitespace-nowrap flex items-center gap-2 ${
                  uploading || downloading
                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                    : "bg-blue-500 hover:bg-blue-600 text-white"
                }`}
              >
                <i className="fas fa-plus"></i>
                <span>
                  {uploading
                    ? "Uploading..."
                    : downloading
                      ? "Downloading..."
                      : "Add Page"}
                </span>
                <i className="fas fa-chevron-down text-xs"></i>
              </button>

              {showAddMenu && (
                <div className="absolute top-full mt-2 right-0 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-50 min-w-[200px]">
                  <button
                    onClick={() => {
                      handleAddPageClick();
                      setShowAddMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-3 transition-colors"
                  >
                    <i className="fas fa-upload text-blue-500 w-5"></i>
                    <span className="font-medium">By Upload</span>
                  </button>
                  <button
                    onClick={() => {
                      urlDialogRef.current?.showModal();
                      setShowAddMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-3 transition-colors"
                  >
                    <i className="fas fa-link text-green-500 w-5"></i>
                    <span className="font-medium">From URL</span>
                  </button>
                </div>
              )}
            </div>
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

      {/* Download from URL Dialog */}
      <dialog
        ref={urlDialogRef}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg shadow-2xl p-0 backdrop:bg-black backdrop:opacity-70 max-w-none"
      >
        <div className="bg-white rounded-lg p-6 min-w-[500px]">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">
            Download from URL
          </h2>

          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Image URL <span className="text-red-500">*</span>
            </label>
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.com/image.jpg"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              disabled={downloading}
            />
          </div>

          <details className="mb-4">
            <summary className="cursor-pointer text-sm font-semibold text-gray-600 hover:text-gray-800">
              Advanced Options (Optional Headers)
            </summary>
            <div className="mt-3 space-y-3 pl-2 border-l-2 border-gray-200">
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Referer
                </label>
                <input
                  type="text"
                  value={refererInput}
                  onChange={(e) => setRefererInput(e.target.value)}
                  placeholder="https://source-website.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                  disabled={downloading}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  User-Agent
                </label>
                <input
                  type="text"
                  value={userAgentInput}
                  onChange={(e) => setUserAgentInput(e.target.value)}
                  placeholder="Mozilla/5.0 ..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                  disabled={downloading}
                />
              </div>
            </div>
          </details>

          <div className="flex gap-3 justify-end">
            <button
              onClick={handleUrlDialogCancel}
              disabled={downloading}
              className="px-4 py-2 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors flex items-center gap-2"
            >
              <i className="fas fa-times"></i>
              <span>Cancel</span>
            </button>
            <button
              onClick={handleUrlDownload}
              disabled={downloading || !urlInput.trim()}
              className={`px-4 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2 ${
                downloading || !urlInput.trim()
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-green-500 hover:bg-green-600 text-white"
              }`}
            >
              <i className="fas fa-download"></i>
              <span>{downloading ? "Downloading..." : "Download"}</span>
            </button>
          </div>
        </div>
      </dialog>

      {SnackbarComponent}
    </div>
  );
}
