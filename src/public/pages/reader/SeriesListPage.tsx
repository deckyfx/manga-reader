import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../lib/api";

/**
 * Series List page - displays all available manga series
 */
export function SeriesListPage() {
  const [series, setSeries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSeries();
  }, []);

  const loadSeries = async () => {
    try {
      const result = await api.api.series.get();

      if (result.data?.success && result.data.series) {
        setSeries(result.data.series);
      }
    } catch (error) {
      console.error("Failed to load series:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <Link to="/" className="text-blue-600 hover:underline mb-4 inline-block">
            ← Back to Home
          </Link>
          <h1 className="text-4xl font-bold text-gray-800">Manga Series</h1>
        </header>

        {loading ? (
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
          </div>
        ) : series.length === 0 ? (
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <p className="text-gray-600 text-lg">No series found.</p>
            <Link
              to="/a/create"
              className="mt-4 inline-block px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg"
            >
              Create First Series
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {series.map((s) => (
              <Link
                key={s.id}
                to={`/r/${s.id}`}
                className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow"
              >
                <h3 className="text-xl font-bold text-gray-800 mb-2">
                  {s.title}
                </h3>
                {s.tags && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {JSON.parse(s.tags).map((tag: string, i: number) => (
                      <span
                        key={i}
                        className="text-xs bg-gray-200 px-2 py-1 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
