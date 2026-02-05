import { Link } from "react-router-dom";

interface StickyHeaderProps {
  backLink: string;
  backText: string;
  title?: string;
  actions?: React.ReactNode;
}

/**
 * StickyHeader - Reusable sticky header with gradient background
 */
export function StickyHeader({ backLink, backText, title, actions }: StickyHeaderProps) {
  return (
    <div className="sticky top-0 z-30 bg-gradient-to-r from-purple-100 to-blue-100 shadow-md">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          <Link
            to={backLink}
            className="text-blue-600 hover:underline font-semibold whitespace-nowrap"
          >
            {backText}
          </Link>

          {/* Title (centered) */}
          {title && (
            <div className="flex-1 text-center">
              <h2 className="text-lg font-bold text-gray-800" title={title}>
                {title.length > 50 ? `${title.substring(0, 50)}...` : title}
              </h2>
            </div>
          )}

          {/* Actions (right side) */}
          {actions && (
            <div className="flex gap-2">
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
