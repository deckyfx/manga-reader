import React, { useRef } from "react";

interface PageData {
  id: number;
  slug?: string | null;
  originalImage: string;
  createdAt: Date;
}

interface MangaPageV2ReadModeProps {
  page: PageData;
  imageSrc: string;
  onPrevious?: () => void;
  onNext?: () => void;
}

/**
 * MangaPageV2ReadMode — Dead-simple read mode.
 *
 * Just an `<img>` tag. Left half click → previous, right half → next.
 * No overlays, no coordinate math, no patch positioning.
 */
export function MangaPageV2ReadMode({
  page,
  imageSrc,
  onPrevious,
  onNext,
}: MangaPageV2ReadModeProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;

    if (clickX < rect.width / 2) {
      onPrevious?.();
    } else {
      onNext?.();
    }
  };

  return (
    <div
      ref={containerRef}
      className="inline-block cursor-pointer select-none"
      onClick={handleClick}
    >
      <img
        src={imageSrc}
        alt={`Manga page ${page.id}`}
        className="max-w-full h-auto rounded-lg shadow-lg"
        draggable={false}
      />
    </div>
  );
}
