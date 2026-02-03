import { useState, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSnackbar } from "../../hooks/useSnackbar";
import { api } from "../../lib/api";

/**
 * Admin page - edit existing manga series
 */
export function EditSeriesPage() {
  const { seriesSlug } = useParams();
  const navigate = useNavigate();
  const { showSnackbar, SnackbarComponent } = useSnackbar();
  const [title, setTitle] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [tags, setTags] = useState("");
  const [coverArt, setCoverArt] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [existingCover, setExistingCover] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSeries, setLoadingSeries] = useState(true);

  useEffect(() => {
    if (seriesSlug) {
      loadSeries();
    }
  }, [seriesSlug]);

  const loadSeries = async () => {
    try {
      const result = await api.api.series({ slug: seriesSlug! }).get();

      if (result.data?.success && result.data.series) {
        const series = result.data.series;
        setTitle(series.title);
        setSynopsis(series.synopsis || "");
        setExistingCover(series.coverArt || null);

        // Tags are already comma-separated
        if (series.tags) {
          setTags(series.tags);
        }
      } else {
        showSnackbar("Series not found", "error");
        navigate("/r");
      }
    } catch (error) {
      console.error("Failed to load series:", error);
      showSnackbar("Failed to load series", "error");
      navigate("/r");
    } finally {
      setLoadingSeries(false);
    }
  };

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        showSnackbar("Please upload an image file", "warning");
        return;
      }
      setCoverArt(file);

      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setCoverPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      showSnackbar("Please enter a series title", "warning");
      return;
    }

    setLoading(true);
    try {
      const formData = {
        title: title.trim(),
        synopsis: synopsis.trim() || undefined,
        tags: tags.trim() || undefined,
        coverArt: coverArt || undefined,
      };

      const result = await api.api.series({ slug: seriesSlug! }).put(formData);

      if (result.data?.success) {
        showSnackbar("Series updated successfully!", "success");

        // Navigate after a short delay to show the success message
        setTimeout(() => {
          navigate(`/r/${seriesSlug}`);
        }, 1000);
      } else {
        showSnackbar(result.data?.error || "Failed to update series", "error");
      }
    } catch (error) {
      console.error("Failed to update series:", error);
      showSnackbar("Failed to update series", "error");
    } finally {
      setLoading(false);
    }
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
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <Link
            to={`/r/${seriesSlug}`}
            className="text-blue-600 hover:underline mb-4 inline-block"
          >
            ← Back to Series
          </Link>
          <h1 className="text-4xl font-bold text-gray-800">Edit Series</h1>
        </header>

        <div className="max-w-6xl mx-auto bg-white rounded-lg shadow-lg p-8">
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Left Column - Cover Art */}
              <div className="md:col-span-1">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Cover Art
                </label>
                <input
                  type="file"
                  id="coverArt"
                  onChange={handleCoverChange}
                  accept="image/*"
                  className="hidden"
                />
                <label
                  htmlFor="coverArt"
                  className="block cursor-pointer hover:opacity-80 transition-opacity"
                >
                  {coverPreview ? (
                    <div className="border-2 border-gray-300 rounded-lg p-4 hover:border-blue-400 transition-colors">
                      <p className="text-xs text-gray-600 mb-2">New cover:</p>
                      <img
                        src={coverPreview}
                        alt="Cover preview"
                        className="w-full rounded-lg shadow-md"
                      />
                      <p className="text-xs text-center text-gray-500 mt-2">
                        Click to change
                      </p>
                    </div>
                  ) : existingCover ? (
                    <div className="border-2 border-gray-300 rounded-lg p-4 hover:border-blue-400 transition-colors">
                      <p className="text-xs text-gray-600 mb-2">
                        Current cover:
                      </p>
                      <img
                        src={existingCover}
                        alt="Current cover"
                        className="w-full rounded-lg shadow-md"
                      />
                      <p className="text-xs text-center text-gray-500 mt-2">
                        Click to change
                      </p>
                    </div>
                  ) : (
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors">
                      <div className="text-5xl mb-3">📁</div>
                      <p className="text-sm font-medium">No cover uploaded</p>
                      <p className="text-xs mt-1">Click to add cover</p>
                    </div>
                  )}
                </label>
              </div>

              {/* Right Column - Form Fields */}
              <div className="md:col-span-2 space-y-6">
                {/* Title */}
                <div>
                  <label
                    htmlFor="title"
                    className="block text-sm font-semibold text-gray-700 mb-2"
                  >
                    Series Title *
                  </label>
                  <input
                    type="text"
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter series title"
                    required
                  />
                </div>

                {/* Synopsis */}
                <div>
                  <label
                    htmlFor="synopsis"
                    className="block text-sm font-semibold text-gray-700 mb-2"
                  >
                    Synopsis
                  </label>
                  <textarea
                    id="synopsis"
                    value={synopsis}
                    onChange={(e) => setSynopsis(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
                    placeholder="Enter series description or synopsis"
                    rows={6}
                  />
                </div>

                {/* Tags */}
                <div>
                  <label
                    htmlFor="tags"
                    className="block text-sm font-semibold text-gray-700 mb-2"
                  >
                    Tags (comma-separated)
                  </label>
                  <input
                    type="text"
                    id="tags"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g., action, romance, comedy"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Separate multiple tags with commas
                  </p>
                </div>

                {/* Submit Button */}
                <div className="flex gap-4 pt-4">
                  <button
                    type="submit"
                    disabled={loading}
                    className={`flex-1 py-3 rounded-lg font-semibold transition-colors ${
                      loading
                        ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                        : "bg-blue-500 hover:bg-blue-600 text-white"
                    }`}
                  >
                    {loading ? "Updating..." : "Update Series"}
                  </button>

                  <Link
                    to={`/r/${seriesSlug}`}
                    className="flex-1 py-3 rounded-lg font-semibold text-center border-2 border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </Link>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>

      {SnackbarComponent}
    </div>
  );
}
