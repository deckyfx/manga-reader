import { useState, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSnackbar } from "../../hooks/useSnackbar";
import { api } from "../../lib/api";
import { StickyHeader } from "../../components/StickyHeader";

/**
 * Admin page - edit chapter details (title and slug)
 */
export function EditChapterPage() {
  const { chapterSlug } = useParams();
  const navigate = useNavigate();
  const { showSnackbar, SnackbarComponent } = useSnackbar();
  const [chapter, setChapter] = useState<any>(null);
  const [chapterTitle, setChapterTitle] = useState("");
  const [chapterNumber, setChapterNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingChapter, setLoadingChapter] = useState(true);
  const [seriesSlug, setSeriesSlug] = useState<string>("");

  useEffect(() => {
    if (chapterSlug) {
      loadChapter();
    }
  }, [chapterSlug]);

  const loadChapter = async () => {
    try {
      const result = await api.api.chapters({ slug: chapterSlug! }).get();

      if (result.data?.success && result.data.chapter) {
        setChapter(result.data.chapter);
        setChapterTitle(result.data.chapter.title);
        setChapterNumber(result.data.chapter.chapterNumber);

        // Load series to get its slug
        const seriesId = result.data.chapter.seriesId;
        const seriesSlugString = `s${String(seriesId).padStart(5, "0")}`;
        setSeriesSlug(seriesSlugString);
      } else {
        showSnackbar("Chapter not found", "error");
        navigate("/r");
      }
    } catch (error) {
      console.error("Failed to load chapter:", error);
      showSnackbar("Failed to load chapter", "error");
      navigate("/r");
    } finally {
      setLoadingChapter(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!chapterTitle.trim() || !chapterNumber.trim()) {
      showSnackbar("Please fill all required fields", "warning");
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
    try {
      const result = await api.api.chapters({ slug: chapterSlug! }).put({
        title: chapterTitle.trim(),
        chapterNumber: chapterNumber.trim(),
      });

      if (result.data?.success) {
        showSnackbar("Chapter updated successfully!", "success");

        // Navigate back to series list after a short delay
        setTimeout(() => {
          navigate("/r");
        }, 1500);
      } else {
        showSnackbar(result.data?.error || "Failed to update chapter", "error");
      }
    } catch (error) {
      console.error("Failed to update chapter:", error);
      showSnackbar("Failed to update chapter", "error");
    } finally {
      setLoading(false);
    }
  };

  if (loadingChapter) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100">
      <StickyHeader
        backLink={seriesSlug ? `/r/${seriesSlug}` : "/r"}
        backText={seriesSlug ? "← Back to Series" : "← Back to List"}
        title="Edit Chapter"
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

            {/* Submit Button */}
            <div className="flex gap-4">
              <button
                type="submit"
                disabled={loading}
                className={`flex-1 py-3 rounded-lg font-semibold transition-colors ${
                  loading
                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                    : "bg-blue-500 hover:bg-blue-600 text-white"
                }`}
              >
                {loading ? "Updating..." : "Update Chapter"}
              </button>

              <Link
                to={seriesSlug ? `/r/${seriesSlug}` : "/r"}
                className="flex-1 py-3 rounded-lg font-semibold text-center border-2 border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>

      {SnackbarComponent}
    </div>
  );
}
