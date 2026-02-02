interface ViewOnlyCaptionBubbleProps {
  capturedImage: string;
  rawText?: string;
  translatedText?: string;
  x: number;
  y: number;
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
}: ViewOnlyCaptionBubbleProps) {
  return (
    <div
      className="absolute bg-white rounded-lg shadow-2xl border-2 border-blue-500 p-3 z-10 pointer-events-none"
      style={{
        left: x,
        top: y,
        maxWidth: 400,
      }}
    >
      <div className="flex gap-3">
        {/* Captured Image Preview */}
        <div className="flex-shrink-0">
          <img
            src={capturedImage}
            alt="Captured region"
            className="rounded border border-gray-200 max-h-32 w-auto"
          />
        </div>

        {/* Text Content */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Original Text */}
          {rawText && (
            <div>
              <div className="text-xs text-gray-500 mb-1">Original:</div>
              <div className="text-sm text-gray-800 line-clamp-3">
                {rawText}
              </div>
            </div>
          )}

          {/* Translated Text */}
          {translatedText && (
            <div>
              <div className="text-xs text-gray-500 mb-1">Translation:</div>
              <div className="text-sm text-blue-700 font-medium line-clamp-3">
                {translatedText}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
