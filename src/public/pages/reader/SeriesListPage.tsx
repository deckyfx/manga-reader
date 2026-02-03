import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { SeriesListItem } from "../../components/SeriesListItem";
import { SeriesFilterPanel, type SeriesFilters } from "../../components/SeriesFilterPanel";

interface Series {
  id: number;
  title: string;
  slug: string | null;
  tags: string | null;
  coverArt: string | null;
}

/**
 * Series List page - displays all available manga series with server-side filtering
 */
export function SeriesListPage() {
  const [searchParams] = useSearchParams();
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);

  // Initialize filters from URL params
  const [filters, setFilters] = useState<SeriesFilters>(() => {
    const mustHaveTagsParam = searchParams.get("mustHaveTags");
    const mustNotHaveTagsParam = searchParams.get("mustNotHaveTags");
    const searchNameParam = searchParams.get("searchName");
    const hasChaptersParam = searchParams.get("hasChapters");

    return {
      searchName: searchNameParam || "",
      hasChapters: hasChaptersParam === "true",
      mustHaveTags: mustHaveTagsParam ? mustHaveTagsParam.split(",") : [],
      mustNotHaveTags: mustNotHaveTagsParam ? mustNotHaveTagsParam.split(",") : [],
    };
  });

  // Reload when any filter changes
  useEffect(() => {
    loadSeries();
  }, [filters]);

  const loadSeries = async () => {
    setLoading(true);
    try {
      // Build query parameters
      const queryParams: any = {};

      if (filters.searchName) {
        queryParams.searchName = filters.searchName;
      }

      if (filters.hasChapters) {
        queryParams.hasChapters = true;
      }

      if (filters.mustHaveTags.length > 0) {
        queryParams.mustHaveTags = filters.mustHaveTags.join(",");
      }

      if (filters.mustNotHaveTags.length > 0) {
        queryParams.mustNotHaveTags = filters.mustNotHaveTags.join(",");
      }

      // Call API with query parameters (or no query if no filters)
      const result = Object.keys(queryParams).length > 0
        ? await api.api.series.get({ query: queryParams })
        : await api.api.series.get();

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
          <Link
            to="/"
            className="text-blue-600 hover:underline mb-4 inline-block"
          >
            ← Back to Home
          </Link>
          <h1 className="text-4xl font-bold text-gray-800">Manga Series</h1>
        </header>

        {/* Filter Panel */}
        <SeriesFilterPanel
          onFilterChange={setFilters}
          initialFilters={filters}
        />

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
              <SeriesListItem key={s.id} series={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
