import React, { useState, useEffect } from "react";
import { MangaPageV2ReadMode } from "./MangaPageV2ReadMode";

interface PageData {
  id: number;
  slug?: string | null;
  originalImage: string;
  createdAt: Date;
}

interface MangaPageV2Props {
  page: PageData;
  onPrevious?: () => void;
  onNext?: () => void;
  showNotification?: (message: string, type: "success" | "error" | "info") => void;
}

/**
 * MangaPageV2 — Read-only page display component.
 *
 * Renders the manga page image with click-to-navigate behavior.
 * Edit functionality has been moved to Studio (StudioPage).
 */
export function MangaPageV2({
  page,
  onPrevious,
  onNext,
}: MangaPageV2Props) {
  const [imageSrc, setImageSrc] = useState(`${page.originalImage}?t=${Date.now()}`);

  /** Update image source when page prop changes */
  useEffect(() => {
    const baseUrl = page.originalImage.split("?")[0];
    setImageSrc(`${baseUrl}?t=${Date.now()}`);
  }, [page.originalImage]);

  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        <MangaPageV2ReadMode
          page={page}
          imageSrc={imageSrc}
          onPrevious={onPrevious}
          onNext={onNext}
        />
      </div>
    </div>
  );
}
