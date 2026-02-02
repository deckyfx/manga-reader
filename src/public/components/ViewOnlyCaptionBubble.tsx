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

  return (
    <div
      className="absolute bg-white rounded-lg shadow-2xl border-2 border-blue-500 p-3 z-10 pointer-events-none"
      style={{
        left: x,
        top: y,
        maxWidth: 400,
      }}
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
        <div className="flex-1 min-w-0 space-y-2">
          {/* Original Text */}
          {rawText && (
            <div>
              <div className="text-xs text-gray-500 mb-1">Original:</div>
              <div
                className="text-sm text-gray-800 line-clamp-3"
                style={{ minWidth: 300 }}
              >
                {rawText}
              </div>
            </div>
          )}

          {/* Translated Text */}
          {translatedText && (
            <div>
              <div className="text-xs text-gray-500 mb-1">Translation:</div>
              <div
                className="text-sm text-blue-700 font-medium line-clamp-3"
                style={{ minWidth: 300 }}
              >
                {translatedText}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
