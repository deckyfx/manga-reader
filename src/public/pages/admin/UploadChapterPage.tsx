import { useState, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSnackbar } from "../../hooks/useSnackbar";
import { api } from "../../lib/api";
import { StickyHeader } from "../../components/StickyHeader";
import { catchError } from "../../../lib/error-handler";
import type { Series } from "../../../db/schema";

/**
 * Admin page - upload compressed chapter containing pages
 */
export function UploadChapterPage() {
  const { seriesSlug } = useParams();
  const navigate = useNavigate();
  const { showSnackbar, SnackbarComponent } = useSnackbar();
  const [series, setSeries] = useState<Series | null>(null);
  const [chapterTitle, setChapterTitle] = useState("");
  const [chapterNumber, setChapterNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingSeries, setLoadingSeries] = useState(true);

  useEffect(() => {
    if (seriesSlug) {
      loadSeries();
    }
  }, [seriesSlug]);

  const loadSeries = async () => {
    const [error, result] = await catchError(
      api.api.series({ slug: seriesSlug! }).get()
    );

    if (error) {
      console.error("Failed to load series:", error);
      showSnackbar("Failed to load series", "error");
      navigate("/r");
      setLoadingSeries(false);
      return;
    }

    if (result.data?.success && result.data.series) {
      setSeries(result.data.series);
    } else {
      showSnackbar("Series not found", "error");
      navigate("/r");
    }

    setLoadingSeries(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const fileInput = document.getElementById("file") as HTMLInputElement;
    const selectedFile = fileInput.files?.[0];

    if (!chapterTitle.trim() || !chapterNumber.trim() || !selectedFile) {
      showSnackbar("Please fill all required fields", "warning");
      return;
    }

    // Validate file type
    const validTypes = [
      "application/zip",
      "application/x-zip-compressed",
      "application/x-rar-compressed",
    ];
    if (
      !validTypes.includes(selectedFile.type) &&
      !selectedFile.name.endsWith(".zip") &&
      !selectedFile.name.endsWith(".rar")
    ) {
      showSnackbar("Please upload a ZIP or RAR file", "warning");
      return;
    }

    // Validate chapter number format (numbers and dots only)
    if (!/^[\d.]+$/.test(chapterNumber)) {
      showSnackbar(
        "Chapter number must contain only numbers and dots (e.g., 1, 2, 1.5)",
        "warning",
      );
      return;
    }

    setLoading(true);

    const [error, result] = await catchError(
      api.api.chapters.post({
        seriesId: series!.id.toString(), // Send actual series ID (not slug)
        title: chapterTitle.trim(),
        chapterNumber: chapterNumber.trim(),
        zipFile: selectedFile,
      })
    );

    if (error) {
      console.error("Failed to upload chapter:", error);
      showSnackbar("Failed to upload chapter", "error");
      setLoading(false);
      return;
    }

    if (result.data?.success) {
      showSnackbar(
        `Chapter uploaded successfully! ${result.data.pagesCount} pages created.`,
        "success",
      );

      // Navigate after a short delay
      setTimeout(() => {
        navigate(`/r/${series!.slug}`);
      }, 1500);
    } else {
      showSnackbar(result.data?.error || "Failed to upload chapter", "error");
    }

    setLoading(false);
  };

  if (loadingSeries) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100">
      <StickyHeader
        backLink={`/r/${series?.slug}`}
        backText="← Back to Series"
        title={`Upload Chapter${series ? ` - ${series.title}` : ""}`}
      />

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Chapter Number */}
            <div>
              <label
                htmlFor="chapterNumber"
                className="block text-sm font-semibold text-gray-700 mb-2"
              >
                Chapter Number *
              </label>
              <input
                type="text"
                id="chapterNumber"
                value={chapterNumber}
                onChange={(e) => setChapterNumber(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., 1, 2, 1.5, 1.1"
                maxLength={5}
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Must be unique within this series. Use numbers and dots only.
              </p>
            </div>

            {/* Chapter Title */}
            <div>
              <label
                htmlFor="chapterTitle"
                className="block text-sm font-semibold text-gray-700 mb-2"
              >
                Chapter Title *
              </label>
              <input
                type="text"
                id="chapterTitle"
                value={chapterTitle}
                onChange={(e) => setChapterTitle(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., The Beginning"
                maxLength={100}
                required
              />
            </div>

            {/* File Upload */}
            <div>
              <label
                htmlFor="file"
                className="block text-sm font-semibold text-gray-700 mb-2"
              >
                Chapter Archive (ZIP/RAR) *
              </label>
              <input
                type="file"
                id="file"
                accept=".zip,.rar"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Upload a ZIP or RAR file containing manga pages (images)
              </p>
            </div>

            {/* Submit Button */}
            <div className="flex gap-4">
              <button
                type="submit"
                disabled={loading}
                className={`flex-1 py-3 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2 ${
                  loading
                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                    : "bg-blue-500 hover:bg-blue-600 text-white"
                }`}
              >
                <i className="fas fa-upload"></i>
                <span>{loading ? "Uploading..." : "Upload Chapter"}</span>
              </button>

              <Link
                to={`/r/${series?.slug}`}
                className="flex-1 py-3 rounded-lg font-semibold text-center border-2 border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
              >
                <i className="fas fa-times"></i>
                <span>Cancel</span>
              </Link>
            </div>
          </form>
        </div>
      </div>

      {SnackbarComponent}
    </div>
  );
}
