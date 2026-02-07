import React from "react";

interface Point {
  x: number;
  y: number;
}

interface CaptionRect {
  id: string;
  captionId?: number;
  captionSlug?: string;
  shape: "rectangle" | "polygon" | "oval";
  x: number;
  y: number;
  width: number;
  height: number;
  polygonPoints?: Point[];
  capturedImage?: string;
  rawText?: string;
  translatedText?: string;
  patchImagePath?: string;
  patchGeneratedAt?: Date;
}

interface PageInfo {
  id: number;
  slug?: string | null;
  orderNum: number;
  originalImage: string;
}

interface StudioSidebarProps {
  captions: CaptionRect[];
  selectedCaptionId: string | null;
  onSelectCaption: (id: string) => void;
  pages: PageInfo[];
  currentPageIndex: number;
  onPageJump: (index: number) => void;
}

/**
 * StudioSidebar — Right column of the Studio layout.
 *
 * Top: Region list with thumbnails and status indicators.
 * Bottom: Page jump thumbnail grid.
 */
export function StudioSidebar({
  captions,
  selectedCaptionId,
  onSelectCaption,
  pages,
  currentPageIndex,
  onPageJump,
}: StudioSidebarProps) {
  return (
    <div className="w-64 bg-gray-50 border-l border-gray-200 flex flex-col overflow-hidden">
      {/* ─── Region List ─── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 border-b border-gray-200">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
          Regions ({captions.length})
        </h3>

        {captions.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No regions yet</p>
        ) : (
          captions.map((c) => {
            const isSelected = c.id === selectedCaptionId;
            const status = c.patchImagePath
              ? "green"
              : c.translatedText
                ? "yellow"
                : "red";

            return (
              <button
                key={c.id}
                onClick={() => onSelectCaption(c.id)}
                className={`w-full flex items-center gap-2 p-1.5 rounded transition-colors text-left ${
                  isSelected
                    ? "bg-blue-100 border border-blue-400"
                    : "bg-white border border-gray-200 hover:bg-gray-100"
                }`}
              >
                {/* Thumbnail */}
                {c.capturedImage ? (
                  <img
                    src={c.capturedImage}
                    alt="Region"
                    className="w-10 h-10 rounded border border-gray-200 object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded bg-gray-200 flex-shrink-0" />
                )}

                {/* Text preview + status */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-700 truncate">
                    {c.rawText || "No text"}
                  </p>
                  <p className="text-xs text-blue-600 truncate">
                    {c.translatedText || "—"}
                  </p>
                </div>

                {/* Status indicator */}
                <span
                  className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    status === "green"
                      ? "bg-green-500"
                      : status === "yellow"
                        ? "bg-yellow-500"
                        : "bg-red-400"
                  }`}
                  title={
                    status === "green"
                      ? "Has patch"
                      : status === "yellow"
                        ? "Translated"
                        : "Raw text only"
                  }
                />
              </button>
            );
          })
        )}
      </div>

      {/* ─── Page Jump Grid ─── */}
      <div className="p-3 overflow-y-auto" style={{ maxHeight: "40%" }}>
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
          Pages ({pages.length})
        </h3>

        <div className="grid grid-cols-3 gap-1.5">
          {pages.map((page, index) => {
            const isCurrent = index === currentPageIndex;
            return (
              <button
                key={page.id}
                onClick={() => onPageJump(index)}
                className={`relative rounded overflow-hidden border-2 transition-colors ${
                  isCurrent
                    ? "border-blue-500 ring-1 ring-blue-400"
                    : "border-gray-200 hover:border-gray-400"
                }`}
                title={`Page ${page.orderNum}`}
              >
                <img
                  src={page.originalImage}
                  alt={`Page ${page.orderNum}`}
                  className="w-full aspect-[3/4] object-cover"
                  loading="lazy"
                />
                <span
                  className={`absolute bottom-0 inset-x-0 text-center text-xs py-0.5 font-semibold ${
                    isCurrent
                      ? "bg-blue-500 text-white"
                      : "bg-black/50 text-white"
                  }`}
                >
                  {page.orderNum}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
