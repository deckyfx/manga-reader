import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDebounce } from "../hooks/useDebounce";
import { useTagSearch } from "../hooks/useTagCountDebounce";

interface SeriesFilterPanelProps {
  onFilterChange: (filters: SeriesFilters) => void;
  initialFilters?: SeriesFilters;
}

export interface SeriesFilters {
  searchName: string;
  hasChapters: boolean;
  mustHaveTags: string[];
  mustNotHaveTags: string[];
}

/**
 * SeriesFilterPanel - Filter panel for series list
 *
 * Features:
 * - Filter by series name (search)
 * - Filter by hasChapters (only show series with chapters)
 * - Must have tags (include series with these tags)
 * - Must not have tags (exclude series with these tags)
 */
export function SeriesFilterPanel({ onFilterChange, initialFilters }: SeriesFilterPanelProps) {
  const navigate = useNavigate();
  const [searchName, setSearchName] = useState(initialFilters?.searchName || "");
  const [hasChapters, setHasChapters] = useState(initialFilters?.hasChapters || false);
  const [mustHaveTagsInput, setMustHaveTagsInput] = useState(
    initialFilters?.mustHaveTags?.join(", ") || ""
  );
  const [mustNotHaveTagsInput, setMustNotHaveTagsInput] = useState(
    initialFilters?.mustNotHaveTags?.join(", ") || ""
  );
  const [isExpanded, setIsExpanded] = useState(
    !!(initialFilters?.searchName ||
       initialFilters?.hasChapters ||
       initialFilters?.mustHaveTags?.length ||
       initialFilters?.mustNotHaveTags?.length)
  );

  // Debounce searchName (500ms delay)
  const debouncedSearchName = useDebounce(searchName, 500);

  // Tag search based on comma count transitions (0→1, 1→2, etc.)
  const activeMustHaveTags = useTagSearch(mustHaveTagsInput, 500);
  const activeMustNotHaveTags = useTagSearch(mustNotHaveTagsInput, 500);

  // Parse comma-separated tags
  const parseTags = (input: string): string[] => {
    return input
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  };

  // Update filters when debounced values or hasChapters change
  useEffect(() => {
    onFilterChange({
      searchName: debouncedSearchName,
      hasChapters,
      mustHaveTags: parseTags(activeMustHaveTags),
      mustNotHaveTags: parseTags(activeMustNotHaveTags),
    });
  }, [debouncedSearchName, hasChapters, activeMustHaveTags, activeMustNotHaveTags]);

  const handleClearFilters = () => {
    // Clear state
    setSearchName("");
    setHasChapters(false);
    setMustHaveTagsInput("");
    setMustNotHaveTagsInput("");

    // Immediately trigger API call with empty filters (bypass debounce)
    onFilterChange({
      searchName: "",
      hasChapters: false,
      mustHaveTags: [],
      mustNotHaveTags: [],
    });

    // Clear URL params
    navigate("/r");
  };

  const hasActiveFilters = searchName || hasChapters || mustHaveTagsInput || mustNotHaveTagsInput;

  return (
    <div className="bg-white rounded-lg shadow-lg mb-6 overflow-hidden">
      {/* Header - Fully clickable */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between px-6 py-4 bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-gray-800">Filters</h2>
          {hasActiveFilters && (
            <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded">
              Active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <button
              onClick={(e) => {
                e.stopPropagation(); // Prevent expanding when clicking clear
                handleClearFilters();
              }}
              className="text-sm text-gray-600 hover:text-gray-800 underline"
            >
              Clear all
            </button>
          )}
          <svg
            className={`w-5 h-5 transition-transform text-gray-500 ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>

      {/* Filter Controls */}
      {isExpanded && (
        <div className="px-6 py-4 space-y-4">
          {/* Search by name */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Search by Name
            </label>
            <input
              type="text"
              placeholder="Enter series name..."
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Has Chapters checkbox */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hasChapters}
                onChange={(e) => setHasChapters(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm font-semibold text-gray-700">
                Only show series with chapters
              </span>
            </label>
          </div>

          {/* Must have tags */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Must Have Tags
            </label>
            <input
              type="text"
              placeholder="action, romance, comedy (comma-separated)"
              value={mustHaveTagsInput}
              onChange={(e) => setMustHaveTagsInput(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              Show only series that have ALL of these tags
            </p>
          </div>

          {/* Must not have tags */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Must NOT Have Tags
            </label>
            <input
              type="text"
              placeholder="horror, gore (comma-separated)"
              value={mustNotHaveTagsInput}
              onChange={(e) => setMustNotHaveTagsInput(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              Exclude series that have ANY of these tags
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
