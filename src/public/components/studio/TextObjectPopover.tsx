import { useState, useEffect, useRef } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useStudioStore } from "../../stores/studioFabricStore";
import type { ExtendedTextbox } from "../../types/fabric-extensions";

/**
 * TextObjectPopover - Floating draggable popover for text object styling controls
 *
 * Features:
 * - Appears when clicking a text object on canvas
 * - Draggable via header (doesn't obstruct view)
 * - Edit text style (font family, size, bold, italic, colors, stroke)
 * - Close button
 * - Controlled via Zustand store
 */
export function TextObjectPopover() {
  const fabricCanvas = useStudioStore((s) => s.fabricCanvas);
  const selectedTextbox = useStudioStore((s) => s.selectedTextbox);
  const setSelectedTextbox = useStudioStore((s) => s.setSelectedTextbox);
  const popoverAnchor = useStudioStore((s) => s.popoverAnchor);

  // Textbox styling state
  const [fontFamily, setFontFamily] = useState("Anime Ace");
  const [fontSize, setFontSize] = useState(16);
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [textColor, setTextColor] = useState("#000000");
  const [strokeWidth, setStrokeWidth] = useState(0);
  const [strokeColor, setStrokeColor] = useState("#FFFFFF");

  // Drag state
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const popoverRef = useRef<HTMLDivElement>(null);

  const fontFamilies = ["Anime Ace", "Nunito", "ToonTime"];

  const isOpen = selectedTextbox !== null;

  /**
   * Initialize position when popover opens
   */
  useEffect(() => {
    if (isOpen && popoverAnchor) {
      setPosition({ x: popoverAnchor.x, y: popoverAnchor.y });
    }
  }, [isOpen, popoverAnchor]);

  /**
   * Load textbox styling when selection changes
   */
  useEffect(() => {
    if (selectedTextbox) {
      setFontFamily(selectedTextbox.fontFamily || "Anime Ace");
      setFontSize(selectedTextbox.fontSize || 16);
      setIsBold(selectedTextbox.fontWeight === "bold");
      setIsItalic(selectedTextbox.fontStyle === "italic");
      setTextColor((selectedTextbox.fill as string) || "#000000");
      setStrokeWidth(selectedTextbox.strokeWidth || 0);
      setStrokeColor((selectedTextbox.stroke as string) || "#FFFFFF");
    }
  }, [selectedTextbox]);

  /**
   * Handle mouse down on header to start dragging
   */
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!popoverRef.current) return;

    const rect = popoverRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setIsDragging(true);
  };

  /**
   * Handle mouse move for dragging
   */
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset]);

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
   * Close popover
   */
  const handleClose = () => {
    setSelectedTextbox(null);
  };

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="fixed bg-gray-800 border border-gray-700 rounded-lg shadow-xl w-80 z-50"
      style={{
        left: position.x,
        top: position.y,
        cursor: isDragging ? "grabbing" : "default",
      }}
    >
      {/* Header with drag handle and close button */}
      <div
        className="flex items-center justify-between mb-3 pb-2 border-b border-gray-700 px-4 pt-4 cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          {/* Drag handle icon */}
          <svg
            className="w-4 h-4 text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 8h16M4 16h16"
            />
          </svg>
          <h3 className="text-white text-sm font-semibold">
            Text Object Controls
          </h3>
        </div>
        <button
          onClick={handleClose}
          onMouseDown={(e) => e.stopPropagation()}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Textbox Style Editor */}
      <div className="flex flex-col gap-3 px-4 pb-4">
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
      </div>
    </div>
  );
}
