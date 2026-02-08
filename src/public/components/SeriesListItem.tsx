import { Link, useNavigate } from "react-router-dom";
import type { Series } from "../../db/schema";

/**
 * SeriesListItem props
 */
interface SeriesListItemProps {
  series: Series;
}

/**
 * SeriesListItem - displays a single series card with cover art and details
 */
export function SeriesListItem({ series }: SeriesListItemProps) {
  const navigate = useNavigate();

  const handleTagClick = (e: React.MouseEvent, tag: string) => {
    e.preventDefault(); // Prevent navigating to series detail
    e.stopPropagation();
    navigate(`/r?mustHaveTags=${encodeURIComponent(tag.trim())}`);
  };

  return (
    <Link
      to={`/r/${series.slug}`}
      className="bg-white rounded-lg shadow-lg hover:shadow-xl transition-shadow overflow-hidden"
    >
      <div className="flex">
        {/* Cover Art Thumbnail */}
        <div className="flex-shrink-0 w-32 h-48 bg-gray-200">
          {series.coverArt ? (
            <img
              src={series.coverArt}
              alt={`${series.title} cover`}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              <svg
                className="w-12 h-12"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
          )}
        </div>

        {/* Series Info */}
        <div className="flex-1 p-6">
          <h3 className="text-xl font-bold text-gray-800 mb-2">
            {`${series.title.substring(0, 100)}...`}
          </h3>
          {series.tags && (
            <div className="flex flex-wrap gap-2 mt-2">
              {(() => {
                const allTags = series.tags.split(",");
                const visibleTags = allTags.slice(0, 2);
                const remainingCount = allTags.length - 2;

                return (
                  <>
                    {visibleTags.map((tag: string, i: number) => (
                      <button
                        key={i}
                        onClick={(e) => handleTagClick(e, tag)}
                        className="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded transition-colors cursor-pointer"
                      >
                        {tag.trim()}
                      </button>
                    ))}
                    {remainingCount > 0 && (
                      <span className="text-xs text-gray-500 px-2 py-1">
                        +{remainingCount} more Tag
                        {remainingCount > 1 ? "s" : ""}
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
