import { useState, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSnackbar } from "../../hooks/useSnackbar";
import { api } from "../../lib/api";

/**
 * Admin page - edit chapter details (title and slug)
 */
export function EditChapterPage() {
  const { chapterId } = useParams();
  const navigate = useNavigate();
  const { showSnackbar, SnackbarComponent } = useSnackbar();
  const [chapter, setChapter] = useState<any>(null);
  const [chapterTitle, setChapterTitle] = useState("");
  const [chapterSlug, setChapterSlug] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingChapter, setLoadingChapter] = useState(true);

  useEffect(() => {
    if (chapterId) {
      loadChapter();
    }
  }, [chapterId]);

  const loadChapter = async () => {
    try {
      const result = await api.api.chapters({ id: chapterId! }).get();

      if (result.data?.success && result.data.chapter) {
        setChapter(result.data.chapter);
        setChapterTitle(result.data.chapter.title);
        setChapterSlug(result.data.chapter.slug);
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

    if (!chapterTitle.trim() || !chapterSlug.trim()) {
      showSnackbar("Please fill all required fields", "warning");
      return;
    }

    // Validate slug format (numbers and dots only)
    if (!/^[\d.]+$/.test(chapterSlug)) {
      showSnackbar(
        "Chapter number must contain only numbers and dots (e.g., 1, 2, 1.5)",
        "warning",
      );
      return;
    }

    setLoading(true);
    try {
      const result = await api.api.chapters({ id: chapterId! }).put({
        title: chapterTitle.trim(),
        slug: chapterSlug.trim(),
      });

      if (result.data?.success) {
        showSnackbar("Chapter updated successfully!", "success");

        // Navigate back after a short delay
        setTimeout(() => {
          if (chapter?.seriesId) {
            navigate(`/r/${chapter.seriesId}`);
          } else {
            navigate("/r");
          }
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
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <Link
            to={chapter?.seriesId ? `/r/${chapter.seriesId}` : "/r"}
            className="text-blue-600 hover:underline mb-4 inline-block"
          >
            ← Back to Series
          </Link>
          <h1 className="text-4xl font-bold text-gray-800">Edit Chapter</h1>
        </header>

        <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Chapter Number (Slug) */}
            <div>
              <label
                htmlFor="chapterSlug"
                className="block text-sm font-semibold text-gray-700 mb-2"
              >
                Chapter Number *
              </label>
              <input
                type="text"
                id="chapterSlug"
                value={chapterSlug}
                onChange={(e) => setChapterSlug(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., 1, 2, 1.5, 1.1"
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
                to={chapter?.seriesId ? `/r/${chapter.seriesId}` : "/r"}
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
