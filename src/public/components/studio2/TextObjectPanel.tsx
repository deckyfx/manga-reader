import { useState, useEffect } from "react";
import { useStudioStore } from "../../stores/studioFabricStore";
import type { ExtendedTextbox } from "../../types/fabric-extensions";
import type { TEvent, TPointerEvent, FabricObject } from "fabric";

type SelectionEvent = Partial<TEvent<TPointerEvent>> & {
  selected: FabricObject[];
};

/**
 * TextObjectPanel - Text object styling controls (textboxes only, not regions)
 *
 * Features:
 * - Edit text style (font family, size, bold, italic, colors, stroke)
 * - Only activates when a textbox is selected
 * - Does not control regions (regions have their own controls in RegionListPanel)
 */
export function TextObjectPanel() {
  const fabricCanvas = useStudioStore((s) => s.fabricCanvas);
  const savePatch = useStudioStore((s) => s.savePatch);

  // Textbox styling state
  const [selectedTextbox, setSelectedTextbox] =
    useState<ExtendedTextbox | null>(null);
  const [fontFamily, setFontFamily] = useState("Anime Ace");
  const [fontSize, setFontSize] = useState(16);
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [textColor, setTextColor] = useState("#000000");
  const [strokeWidth, setStrokeWidth] = useState(0);
  const [strokeColor, setStrokeColor] = useState("#FFFFFF");
  const [isSaving, setIsSaving] = useState(false);

  const fontFamilies = ["Anime Ace", "Nunito", "ToonTime"];

  /**
   * Listen to selection changes to update editor (textboxes only)
   */
  useEffect(() => {
    if (!fabricCanvas) return;

    const handleSelection = (e: SelectionEvent) => {
      const obj = e.selected?.[0];
      if (!obj) return;

      // Only handle textbox selection
      if (obj.type === "textbox") {
        const textbox = obj as ExtendedTextbox;
        if (textbox.data?.type === "text-patch") {
          setSelectedTextbox(textbox);

          // Load textbox styling
          setFontFamily(textbox.fontFamily || "Anime Ace");
          setFontSize(textbox.fontSize || 16);
          setIsBold(textbox.fontWeight === "bold");
          setIsItalic(textbox.fontStyle === "italic");
          setTextColor((textbox.fill as string) || "#000000");
          setStrokeWidth(textbox.strokeWidth || 0);
          setStrokeColor((textbox.stroke as string) || "#FFFFFF");
        }
      }
    };

    const handleClear = () => {
      setSelectedTextbox(null);
    };

    fabricCanvas.on("selection:created", handleSelection);
    fabricCanvas.on("selection:updated", handleSelection);
    fabricCanvas.on("selection:cleared", handleClear);

    return () => {
      fabricCanvas.off("selection:created", handleSelection);
      fabricCanvas.off("selection:updated", handleSelection);
      fabricCanvas.off("selection:cleared", handleClear);
    };
  }, [fabricCanvas]);

  /**
   * Apply styling changes to selected textbox
   */
  const applyTextboxChanges = () => {
    if (!selectedTextbox || !fabricCanvas) return;

    selectedTextbox.set({
      fontFamily,
      fontSize,
      fontWeight: isBold ? "bold" : "normal",
      fontStyle: isItalic ? "italic" : "normal",
      fill: textColor,
      strokeWidth,
      stroke: strokeWidth > 0 ? strokeColor : undefined,
    });

    fabricCanvas.renderAll();
  };

  /**
   * Save textbox patch to database
   */
  const handleSavePatch = async () => {
    if (!selectedTextbox) return;

    const captionSlug = selectedTextbox.data?.captionSlug;
    if (!captionSlug) {
      alert("No caption slug found. Cannot save patch.");
      return;
    }

    setIsSaving(true);

    try {
      await savePatch(captionSlug, selectedTextbox);
      alert("Patch saved successfully!");
    } catch (error) {
      console.error("Save error:", error);
      alert(
        `Failed to save patch: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="flex flex-col border-b border-gray-700"
      style={{ height: "40%" }}
    >
      <div className="p-3 border-b border-gray-700">
        <h3 className="text-white text-sm font-semibold">
          Text Object Controls
        </h3>
        {selectedTextbox && (
          <p className="text-gray-400 text-xs mt-1">Edit text styling</p>
        )}
      </div>

      <div className="flex-1 flex flex-col p-3 gap-2 overflow-y-auto">
        {/* Textbox Style Editor - shown when textbox is selected */}
        {selectedTextbox && (
          <>
            {/* Font Family */}
            <div className="flex flex-col gap-1">
              <label className="text-gray-300 text-xs font-medium">
                Font Family
              </label>
              <select
                value={fontFamily}
                onChange={(e) => {
                  setFontFamily(e.target.value);
                  setTimeout(applyTextboxChanges, 0);
                }}
                className="w-full px-2 py-1.5 text-sm bg-gray-700 text-white border border-gray-600 rounded focus:outline-none focus:border-blue-500"
              >
                {fontFamilies.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
            </div>

            {/* Font Size */}
            <div className="flex flex-col gap-1">
              <label className="text-gray-300 text-xs font-medium">
                Font Size
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={fontSize}
                  onChange={(e) => {
                    setFontSize(Number(e.target.value));
                    setTimeout(applyTextboxChanges, 0);
                  }}
                  className="flex-1"
                />
                <input
                  type="number"
                  min="10"
                  max="100"
                  value={fontSize}
                  onChange={(e) => {
                    setFontSize(Number(e.target.value));
                    setTimeout(applyTextboxChanges, 0);
                  }}
                  className="w-16 px-2 py-1 text-sm bg-gray-700 text-white border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Bold / Italic */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setIsBold(!isBold);
                  setTimeout(applyTextboxChanges, 0);
                }}
                className={`flex-1 px-3 py-2 rounded font-bold text-sm ${
                  isBold
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-300 border border-gray-600"
                }`}
              >
                B
              </button>
              <button
                onClick={() => {
                  setIsItalic(!isItalic);
                  setTimeout(applyTextboxChanges, 0);
                }}
                className={`flex-1 px-3 py-2 rounded italic text-sm ${
                  isItalic
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-300 border border-gray-600"
                }`}
              >
                I
              </button>
            </div>

            {/* Text Color */}
            <div className="flex flex-col gap-1">
              <label className="text-gray-300 text-xs font-medium">
                Text Color
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={textColor}
                  onChange={(e) => {
                    setTextColor(e.target.value);
                    setTimeout(applyTextboxChanges, 0);
                  }}
                  className="w-10 h-8 border border-gray-600 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  onBlur={applyTextboxChanges}
                  className="flex-1 px-2 py-1 text-xs bg-gray-700 text-white border border-gray-600 rounded focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
            </div>

            {/* Stroke Width */}
            <div className="flex flex-col gap-1">
              <label className="text-gray-300 text-xs font-medium">
                Stroke Width: {strokeWidth}px
              </label>
              <input
                type="range"
                min="0"
                max="10"
                value={strokeWidth}
                onChange={(e) => {
                  setStrokeWidth(Number(e.target.value));
                  setTimeout(applyTextboxChanges, 0);
                }}
                className="w-full"
              />
            </div>

            {/* Stroke Color (conditional) */}
            {strokeWidth > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-gray-300 text-xs font-medium">
                  Stroke Color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={strokeColor}
                    onChange={(e) => {
                      setStrokeColor(e.target.value);
                      setTimeout(applyTextboxChanges, 0);
                    }}
                    className="w-10 h-8 border border-gray-600 rounded cursor-pointer"
                  />
                  <input
                    type="text"
                    value={strokeColor}
                    onChange={(e) => setStrokeColor(e.target.value)}
                    onBlur={applyTextboxChanges}
                    className="flex-1 px-2 py-1 text-xs bg-gray-700 text-white border border-gray-600 rounded focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>
            )}

            {/* Save Patch Button */}
            <button
              onClick={handleSavePatch}
              disabled={isSaving}
              className={`px-3 py-1.5 rounded text-white text-sm font-medium ${
                isSaving
                  ? "bg-gray-600 cursor-not-allowed"
                  : "bg-green-600 hover:bg-green-700"
              }`}
            >
              {isSaving ? "Saving..." : "Save Patch"}
            </button>
          </>
        )}

        {/* Empty State */}
        {!selectedTextbox && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-gray-500 text-sm text-center">
              Select a text object to edit styling
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
