import { Link } from "react-router-dom";
import type { Chapter } from "../../db/schema";

/**
 * ChapterListItem props
 */
interface ChapterListItemProps {
  chapter: Chapter;
  seriesSlug: string;
  onDeleteClick: (chapter: Chapter) => void;
  onDownloadClick: (chapter: Chapter) => void;
}

/**
 * ChapterListItem - displays a single chapter with action buttons
 */
export function ChapterListItem({
  chapter,
  seriesSlug,
  onDeleteClick,
  onDownloadClick,
}: ChapterListItemProps) {
  return (
    <div className="bg-white rounded-lg shadow-lg p-6 flex items-center justify-between gap-4">
      <Link
        to={`/r/${seriesSlug}/${chapter.slug}/1`}
        className="flex items-baseline gap-3 flex-1 hover:opacity-70 transition-opacity"
      >
        <span className="text-sm font-semibold text-blue-600 bg-blue-100 px-3 py-1 rounded">
          Ch. {chapter.chapterNumber}
        </span>
        <h3 className="text-xl font-bold text-gray-800" title={chapter.title}>
          {chapter.title.length > 50 ? `${chapter.title.substring(0, 100)}...` : chapter.title}
        </h3>
      </Link>
      <div className="flex gap-2">
        <Link
          to={`/r/${seriesSlug}/${chapter.slug}`}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold transition-colors flex items-center gap-2"
        >
          <i className="fas fa-images"></i>
          <span>Gallery</span>
        </Link>
        <Link
          to={`/a/chapters/${chapter.slug}/edit`}
          className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold transition-colors flex items-center gap-2"
        >
          <i className="fas fa-edit"></i>
          <span>Edit</span>
        </Link>
        <button
          onClick={() => onDownloadClick(chapter)}
          className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-semibold transition-colors flex items-center gap-2"
          title="Download chapter as tar.gz archive"
        >
          <i className="fas fa-download"></i>
          <span>Download</span>
        </button>
        <button
          onClick={() => onDeleteClick(chapter)}
          className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold transition-colors flex items-center gap-2"
        >
          <i className="fas fa-trash"></i>
          <span>Delete</span>
        </button>
      </div>
    </div>
  );
}
