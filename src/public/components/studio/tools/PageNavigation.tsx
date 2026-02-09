import { useStudioStore } from "../../../stores/studioFabricStore";

/**
 * PageJumpGrid - Grid of page thumbnails for quick navigation
 *
 * Displays all pages as thumbnails in a 3-column grid.
 * Current page is highlighted with blue border.
 * Click to jump to any page.
 */
export function PageNavigation() {
  const pages = useStudioStore((state) => state.pages);
  const currentPageIndex = useStudioStore((state) => state.currentPageIndex);

  const handlePageJump = (index: number) => {
    const page = pages[index];
    if (page?.slug) {
      // Change hash to trigger navigation (and unsaved changes check)
      window.location.hash = page.slug;
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-3 flex-shrink-0">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
          Pages ({pages.length})
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <div className="grid grid-cols-3 gap-1.5">
          {pages.map((page, index) => {
            const isCurrent = index === currentPageIndex;
            return (
              <button
                key={page.id}
                onClick={() => handlePageJump(index)}
                className={`relative rounded overflow-hidden border-2 transition-colors ${
                  isCurrent
                    ? "border-blue-500 ring-1 ring-blue-400"
                    : "border-gray-600 hover:border-gray-400"
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
