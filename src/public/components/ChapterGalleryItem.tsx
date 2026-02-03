import { useState } from "react";
import { Link } from "react-router-dom";

/**
 * Page data interface
 */
interface PageData {
  id: number;
  chapterId: number;
  originalImage: string;
  orderNum: number;
  slug: string | null;
}

/**
 * ChapterGalleryItem props
 */
interface ChapterGalleryItemProps {
  page: PageData;
  seriesSlug: string;
  chapterSlug: string;
  isDragging: boolean;
  onDragStart: (page: PageData, e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (page: PageData, e: React.DragEvent) => void;
  onDeleteClick: (page: PageData, e: React.MouseEvent) => void;
}

/**
 * ChapterGalleryItem - displays a single page thumbnail with drag-and-drop and delete
 * Each item manages its own hover and visual states
 */
export function ChapterGalleryItem({
  page,
  seriesSlug,
  chapterSlug,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDeleteClick,
}: ChapterGalleryItemProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(page, e)}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(page, e)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`bg-white rounded-lg shadow-lg overflow-hidden transition-all cursor-move relative ${
        isDragging ? "opacity-50 scale-95" : "hover:shadow-2xl"
      }`}
    >
      <Link to={`/r/${seriesSlug}/${chapterSlug}/${page.orderNum}`} className="block">
        <img
          src={page.originalImage}
          alt={`Page ${page.orderNum}`}
          className="w-full h-auto pointer-events-none"
        />
        <div className="p-3 text-center">
          <p className="text-sm font-semibold text-gray-700">
            Page {page.orderNum}
          </p>
        </div>
      </Link>
      <button
        onClick={(e) => onDeleteClick(page, e)}
        className={`absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold shadow-lg transition-all z-10 ${
          isHovered ? "opacity-100 scale-100" : "opacity-0 scale-90"
        }`}
        title="Delete page"
      >
        ×
      </button>
    </div>
  );
}
