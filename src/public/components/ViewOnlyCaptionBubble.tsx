interface ViewOnlyCaptionBubbleProps {
  capturedImage: string;
  rawText?: string;
  translatedText?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * ViewOnlyCaptionBubble Component
 *
 * Read-only popover showing captured image and persisted text
 * - Displays on hover in view mode
 * - Shows extracted text and translation
 * - No editing functionality
 * - Lightweight preview component
 */
export function ViewOnlyCaptionBubble({
  capturedImage,
  rawText,
  translatedText,
  x,
  y,
  width,
  height,
}: ViewOnlyCaptionBubbleProps) {
  // Determine layout direction based on rectangle aspect ratio
  // If width > height, image is horizontal/wide -> display vertically (image on top)
  // If height > width, image is vertical/tall -> display horizontally (image on left)
  const isWideImage = width > height;

  // Calculate if popup would overflow right edge
  // Consider both rectangle position and its width
  const popupWidth = 450;
  const popupGap = 20;
  const windowWidth = typeof window !== "undefined" ? window.innerWidth : 1920;
  const windowHeight =
    typeof window !== "undefined" ? window.innerHeight : 1080;
  const rightEdgeOfRect = x + width;
  const wouldOverflowRight =
    rightEdgeOfRect + popupGap + popupWidth > windowWidth;

  // Calculate if popup would overflow bottom edge
  const estimatedPopupHeight = 400;
  const wouldOverflowBottom = y + estimatedPopupHeight > windowHeight;

  // Adjust Y position if would overflow bottom - move up by 300px
  const adjustedY = wouldOverflowBottom ? y - 100 : y;

  // Position popup: if would overflow right, position to the left of rectangle with gap
  const popupStyle = wouldOverflowRight
    ? {
        left: x - popupWidth - popupGap,
        top: adjustedY,
        width: popupWidth,
        maxWidth: "90vw",
      }
    : {
        left: x,
        top: adjustedY,
        width: popupWidth,
        maxWidth: "90vw",
      };

  return (
    <div
      className="absolute bg-white rounded-lg shadow-2xl border-2 border-blue-500 p-3 z-10 pointer-events-none"
      style={popupStyle}
    >
      <div className={`flex gap-3 ${isWideImage ? "flex-col" : "flex-row"}`}>
        {/* Captured Image Preview */}
        <div className="flex-shrink-0">
          <img
            src={capturedImage}
            alt="Captured region"
            className={`rounded border border-gray-200 ${
              isWideImage ? "max-w-full h-auto" : "max-h-32 w-auto"
            }`}
          />
        </div>

        {/* Text Content */}
        <div className="flex-1 space-y-2 overflow-hidden">
          {/* Original Text */}
          {rawText && (
            <div>
              <div className="text-xs text-gray-500 mb-1">Original:</div>
              <div className="text-sm text-gray-800 break-words whitespace-pre-wrap">
                {rawText}
              </div>
            </div>
          )}

          {/* Translated Text */}
          {translatedText && (
            <div>
              <div className="text-xs text-gray-500 mb-1">Translation:</div>
              <div className="text-sm text-blue-700 font-medium break-words whitespace-pre-wrap">
                {translatedText}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
