import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSnackbar } from "../../hooks/useSnackbar";
import { api } from "../../lib/api";
import { StickyHeader } from "../../components/StickyHeader";
import { catchError } from "../../../lib/error-handler";

/**
 * Admin page - create new manga series
 */
export function CreateSeriesPage() {
  const navigate = useNavigate();
  const { showSnackbar, SnackbarComponent } = useSnackbar();
  const [title, setTitle] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [tags, setTags] = useState("");
  const [coverArt, setCoverArt] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

    const formData = {
      title: title.trim(),
      synopsis: synopsis.trim() || undefined,
      tags: tags.trim() || undefined,
      coverArt: coverArt || undefined,
    };

    const [error, result] = await catchError(
      api.api.series.post(formData)
    );

    if (error) {
      console.error("Failed to create series:", error);
      showSnackbar("Failed to create series", "error");
      setLoading(false);
      return;
    }

    if (result.data?.success) {
      showSnackbar("Series created successfully!", "success");

      // Navigate after a short delay to show the success message
      setTimeout(() => {
        navigate("/r");
      }, 1000);
    } else {
      showSnackbar(result.data?.error || "Failed to create series", "error");
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100">
      <StickyHeader
        backLink="/"
        backText="← Back to Home"
        title="Create New Series"
      />

      <div className="container mx-auto px-4 py-8">

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
                      <img
                        src={coverPreview}
                        alt="Cover preview"
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
                    maxLength={200}
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
                    maxLength={1000}
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
                    maxLength={100}
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
                    className={`flex-1 py-3 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2 ${
                      loading
                        ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                        : "bg-blue-500 hover:bg-blue-600 text-white"
                    }`}
                  >
                    <i className="fas fa-save"></i>
                    <span>{loading ? "Creating..." : "Create Series"}</span>
                  </button>

                  <Link
                    to="/"
                    className="flex-1 py-3 rounded-lg font-semibold text-center border-2 border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                  >
                    <i className="fas fa-times"></i>
                    <span>Cancel</span>
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
