import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { catchError } from "../../lib/error-handler";

interface PatchEditorPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  capturedImage: string;
  translatedText: string;
  captionSlug: string | null;
  onPatchGenerated: (patchUrl: string) => void;
  currentPatchUrl?: string;
}

/**
 * PatchEditorPanel Component
 *
 * Collapsible panel for customizing and generating translation patches
 * - Text lines editor (add/remove/reorder)
 * - Font controls (size, type)
 * - Color pickers (text, stroke)
 * - Stroke width control
 * - Live patch generation
 */
export function PatchEditorPanel({
  isOpen,
  onToggle,
  capturedImage,
  translatedText,
  captionSlug,
  onPatchGenerated,
  currentPatchUrl,
}: PatchEditorPanelProps) {
  const [fontSize, setFontSize] = useState(25);
  const [fontType, setFontType] = useState<"regular" | "bold" | "italic">("regular");
  const [textColor, setTextColor] = useState("#000000");
  const [strokeColor, setStrokeColor] = useState("#FFFFFF");
  const [strokeWidth, setStrokeWidth] = useState(0);
  const [useStroke, setUseStroke] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");

  // Get text lines from translatedText (split by newlines)
  const textLines = translatedText
    ? translatedText.split("\n").filter(line => line.trim())
    : [];

  /**
   * Generate patch with current settings
   */
  const handleGeneratePatch = async () => {
    if (!captionSlug) {
      setError("Caption not saved yet");
      return;
    }

    if (textLines.length === 0 || textLines.every(line => !line.trim())) {
      setError("At least one line of text is required");
      return;
    }

    setIsGenerating(true);
    setError("");

    // Filter out empty lines
    const nonEmptyLines = textLines.filter(line => line.trim());

    const [err, result] = await catchError(
      api.api.captions({ slug: captionSlug })["generate-patch"].post({
        lines: nonEmptyLines,
        fontSize,
        fontType,
        textColor,
        strokeColor: useStroke ? strokeColor : null,
        strokeWidth: useStroke ? strokeWidth : 0,
      })
    );

    if (err) {
      console.error("Patch generation error:", err);
      setError(err instanceof Error ? err.message : "Failed to generate patch");
      setIsGenerating(false);
      return;
    }

    if (result.data?.success && result.data.patchUrl) {
      console.log("[PatchEditorPanel] Patch generated:", result.data.patchUrl);
      onPatchGenerated(result.data.patchUrl);
    } else {
      setError(result.data?.error || "Failed to generate patch");
    }

    setIsGenerating(false);
  };

  return (
    <div className="mt-3 border border-gray-300 rounded-lg overflow-hidden">
      {/* Collapsible Header */}
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 bg-gray-100 hover:bg-gray-200 transition-colors flex items-center justify-between cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <i className="fas fa-paint-brush text-gray-600"></i>
          <span className="font-semibold text-gray-700">Patch Editor</span>
          {currentPatchUrl && (
            <span className="text-xs text-green-600">(Generated)</span>
          )}
        </div>
        <i className={`fas fa-chevron-${isOpen ? "up" : "down"} text-gray-500`}></i>
      </button>

      {/* Collapsible Content */}
      {isOpen && (
        <div className="p-3 space-y-3 bg-gray-50">
          {/* Text Lines Preview - Hidden but data still available */}
          <div className="hidden">
            <label className="text-xs font-semibold text-gray-700 mb-2 block">
              Text Lines (from translation):
            </label>
            {textLines.length === 0 ? (
              <div className="text-xs text-gray-500 italic py-2 px-3 bg-gray-100 rounded">
                No text to render. Add translation above.
              </div>
            ) : (
              <div className="text-xs text-gray-700 py-2 px-3 bg-gray-100 rounded space-y-1">
                {textLines.map((line, index) => (
                  <div key={index}>
                    <span className="text-gray-500">Line {index + 1}:</span> {line}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Font Controls */}
          <div className="grid grid-cols-2 gap-3">
            {/* Font Size */}
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                Font Size:
              </label>
              <div className="flex gap-2 items-center">
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="flex-1"
                />
                <input
                  type="number"
                  min="10"
                  max="100"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Font Type */}
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                Font Type:
              </label>
              <select
                value={fontType}
                onChange={(e) => setFontType(e.target.value as "regular" | "bold" | "italic")}
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="regular">Regular</option>
                <option value="bold">Bold</option>
                <option value="italic">Italic</option>
              </select>
            </div>
          </div>

          {/* Color Controls */}
          <div className="grid grid-cols-2 gap-3">
            {/* Text Color */}
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                Text Color:
              </label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  className="w-12 h-8 border border-gray-300 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  placeholder="#FFFFFF"
                />
              </div>
            </div>

            {/* Stroke Color */}
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={useStroke}
                  onChange={(e) => setUseStroke(e.target.checked)}
                  className="cursor-pointer"
                />
                <span>Stroke Color:</span>
              </label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={strokeColor}
                  onChange={(e) => setStrokeColor(e.target.value)}
                  disabled={!useStroke}
                  className="w-12 h-8 border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                />
                <input
                  type="text"
                  value={strokeColor}
                  onChange={(e) => setStrokeColor(e.target.value)}
                  disabled={!useStroke}
                  className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed font-mono"
                  placeholder="#000000"
                />
              </div>
            </div>
          </div>

          {/* Stroke Width */}
          {useStroke && (
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                Stroke Width:
              </label>
              <div className="flex gap-2 items-center">
                <input
                  type="range"
                  min="0"
                  max="10"
                  value={strokeWidth}
                  onChange={(e) => setStrokeWidth(Number(e.target.value))}
                  className="flex-1"
                />
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={strokeWidth}
                  onChange={(e) => setStrokeWidth(Number(e.target.value))}
                  className="w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
              ❌ {error}
            </div>
          )}

          {/* Generate Button */}
          <button
            onClick={handleGeneratePatch}
            disabled={isGenerating || textLines.length === 0 || !captionSlug}
            className="w-full px-3 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-sm font-semibold rounded transition-colors flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Generating...</span>
              </>
            ) : (
              <>
                <i className="fas fa-magic"></i>
                <span>{currentPatchUrl ? "Regenerate Patch" : "Generate Patch"}</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
