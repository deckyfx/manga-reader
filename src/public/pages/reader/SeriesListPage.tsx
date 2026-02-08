import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { SeriesListItem } from "../../components/SeriesListItem";
import {
  SeriesFilterPanel,
  type SeriesFilters,
} from "../../components/SeriesFilterPanel";
import { StickyHeader } from "../../components/StickyHeader";
import { catchError } from "../../../lib/error-handler";
import type { GetSeriesQuery } from "../../../plugins/api/series";
import type { Series } from "../../../db/schema";

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
      mustNotHaveTags: mustNotHaveTagsParam
        ? mustNotHaveTagsParam.split(",")
        : [],
    };
  });

  // Reload when any filter changes
  useEffect(() => {
    loadSeries();
  }, [filters]);

  const loadSeries = async () => {
    setLoading(true);

    // Build query parameters
    const queryParams: Partial<GetSeriesQuery> = {};

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
    const [error, result] = await catchError(
      Object.keys(queryParams).length > 0
        ? api.api.series.get({ query: queryParams })
        : api.api.series.get(),
    );

    if (error) {
      console.error("Failed to load series:", error);
      setLoading(false);
      return;
    }

    if (result.data?.success && result.data.series) {
      setSeries(result.data.series);
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100">
      <StickyHeader
        backLink="/"
        backText="← Back to Home"
        title="Manga Series"
        actions={
          <Link
            to="/a/create"
            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold transition-colors whitespace-nowrap flex items-center gap-2"
          >
            <i className="fas fa-plus"></i>
            <span>Create Series</span>
          </Link>
        }
      />

      <div className="container mx-auto px-4 py-8">
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
              className="mt-4 inline-block px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold flex items-center gap-2 justify-center"
            >
              <i className="fas fa-plus"></i>
              <span>Create First Series</span>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {series
              .filter((s) => s.slug !== null) // Filter out series without slugs
              .map((s) => (
                <SeriesListItem key={s.id} series={s} />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
