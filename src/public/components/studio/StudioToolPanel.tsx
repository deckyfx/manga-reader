import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../../lib/api";
import { catchError } from "../../../lib/error-handler";
import { AutoSaveTextArea } from "./AutoSaveTextArea";
import type { DrawingToolType } from "../../hooks/useDrawingTool";

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

interface StudioToolPanelProps {
  drawingTool: DrawingToolType;
  onDrawingToolChange: (tool: DrawingToolType) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  selectedCaption: CaptionRect | null;
  hasPatchesAvailable: boolean;
  isPatching: boolean;
  onMerge: () => void;
  onDeleteCaption: (id: string) => void;
  onCaptionUpdated: () => void;
  onNotification: (msg: string, type: "success" | "error" | "info") => void;
  showOverlay: boolean;
  onToggleOverlay: (show: boolean) => void;
}

/**
 * StudioToolPanel — Left column of the Studio layout.
 *
 * Top: Drawing tools + zoom controls + merge button.
 * Bottom: Selected region editor (text, patch config, actions).
 */
export function StudioToolPanel({
  drawingTool,
  onDrawingToolChange,
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
  selectedCaption,
  hasPatchesAvailable,
  isPatching,
  onMerge,
  onDeleteCaption,
  onCaptionUpdated,
  onNotification,
  showOverlay,
  onToggleOverlay,
}: StudioToolPanelProps) {
  return (
    <div className="w-64 bg-gray-50 border-r border-gray-200 flex flex-col overflow-y-auto">
      {/* ─── Main Tools ─── */}
      <div className="p-3 space-y-3 border-b border-gray-200">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
          Tools
        </h3>

        {/* Merge Down */}
        <button
          onClick={onMerge}
          disabled={!hasPatchesAvailable || isPatching}
          className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded transition-colors flex items-center gap-2"
        >
          {isPatching ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              <span>Merging...</span>
            </>
          ) : (
            <>
              <i className="fas fa-layer-group" />
              <span>Merge Down</span>
            </>
          )}
        </button>

        {/* Show Overlay Toggle */}
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={showOverlay}
            onChange={(e) => onToggleOverlay(e.target.checked)}
            className="w-4 h-4"
          />
          <span>Show Overlay</span>
        </label>

        {/* Drawing Tool Selector */}
        <DrawingToolSelector
          drawingTool={drawingTool}
          onDrawingToolChange={onDrawingToolChange}
        />

        {/* Zoom Controls */}
        <div className="space-y-1">
          <h4 className="text-xs font-bold text-gray-500 uppercase">Zoom</h4>
          <div className="flex items-center gap-2">
            <button
              onClick={onZoomOut}
              className="px-2 py-1 bg-gray-200 hover:bg-gray-300 rounded text-sm font-bold"
            >
              −
            </button>
            <span className="flex-1 text-center text-sm font-mono">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={onZoomIn}
              className="px-2 py-1 bg-gray-200 hover:bg-gray-300 rounded text-sm font-bold"
            >
              +
            </button>
          </div>
          <button
            onClick={onFit}
            className="w-full px-3 py-1 bg-gray-200 hover:bg-gray-300 text-sm rounded transition-colors"
          >
            Fit
          </button>
        </div>
      </div>

      {/* ─── Region Tool (selected caption editor) ─── */}
      {selectedCaption && (
        <RegionEditor
          caption={selectedCaption}
          onDeleteCaption={onDeleteCaption}
          onCaptionUpdated={onCaptionUpdated}
          onNotification={onNotification}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// DrawingToolSelector — collapsible single-button tool picker
// ────────────────────────────────────────────────────────────

const TOOL_OPTIONS: {
  type: DrawingToolType;
  label: string;
  icon: string;
}[] = [
  { type: "rectangle", label: "Rectangle", icon: "fa-square" },
  { type: "oval", label: "Oval", icon: "fa-circle" },
  { type: "polygon", label: "Polygon", icon: "fa-draw-polygon" },
];

interface DrawingToolSelectorProps {
  drawingTool: DrawingToolType;
  onDrawingToolChange: (tool: DrawingToolType) => void;
}

function DrawingToolSelector({
  drawingTool,
  onDrawingToolChange,
}: DrawingToolSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isActive = drawingTool !== "none";
  const activeTool = TOOL_OPTIONS.find((o) => o.type === drawingTool);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  const handleMainClick = useCallback(() => {
    if (isActive) {
      // Deselect current tool
      onDrawingToolChange("none");
      setIsOpen(false);
    } else {
      // Toggle dropdown
      setIsOpen((prev) => !prev);
    }
  }, [isActive, onDrawingToolChange]);

  const handleSelect = useCallback(
    (type: DrawingToolType) => {
      if (drawingTool === type) {
        // Re-clicking same tool deselects
        onDrawingToolChange("none");
      } else {
        onDrawingToolChange(type);
      }
      setIsOpen(false);
    },
    [drawingTool, onDrawingToolChange],
  );

  return (
    <div ref={containerRef} className="relative">
      {/* Main button */}
      <button
        onClick={handleMainClick}
        className={`w-full px-3 py-2 text-sm font-semibold rounded transition-colors flex items-center gap-2 ${
          isActive
            ? "bg-blue-500 text-white shadow-md"
            : "bg-gray-200 text-gray-700 hover:bg-gray-300"
        }`}
      >
        <i
          className={`fas ${isActive ? activeTool!.icon : "fa-mouse-pointer"}`}
        />
        <span className="flex-1 text-left">
          {isActive ? activeTool!.label : "Selection Tool"}
        </span>
        {isActive ? (
          <i className="fas fa-times text-xs opacity-70" />
        ) : (
          <i
            className={`fas fa-chevron-down text-xs opacity-70 transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="mt-1 bg-white border border-gray-200 rounded shadow-lg overflow-hidden">
          {TOOL_OPTIONS.map((opt) => (
            <button
              key={opt.type}
              onClick={() => handleSelect(opt.type)}
              className={`w-full px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                drawingTool === opt.type
                  ? "bg-blue-50 text-blue-700 font-semibold"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <i className={`fas ${opt.icon} w-4 text-center`} />
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// RegionEditor — absorbs EditableCaptionBubble + PatchEditorPanel
// ────────────────────────────────────────────────────────────

interface RegionEditorProps {
  caption: CaptionRect;
  onDeleteCaption: (id: string) => void;
  onCaptionUpdated: () => void;
  onNotification: (msg: string, type: "success" | "error" | "info") => void;
}

function RegionEditor({
  caption,
  onDeleteCaption,
  onCaptionUpdated,
  onNotification,
}: RegionEditorProps) {
  const slug = caption.captionSlug;

  // Keep refs to current text values so save callbacks always read latest
  const rawTextRef = useRef(caption.rawText ?? "");
  const translatedTextRef = useRef(caption.translatedText ?? "");

  const [patchImagePath, setPatchImagePath] = useState(
    caption.patchImagePath,
  );

  // Patch editor state
  const [fontSize, setFontSize] = useState(12);
  const [fontType, setFontType] = useState<"regular" | "bold" | "italic">(
    "regular",
  );
  const [textColor, setTextColor] = useState("#000000");
  const [strokeColor, setStrokeColor] = useState("#FFFFFF");
  const [strokeWidth, setStrokeWidth] = useState(0);
  const [useStroke, setUseStroke] = useState(false);
  const [showPatchConfig, setShowPatchConfig] = useState(false);
  const [cleanerThreshold, setCleanerThreshold] = useState(200);
  const [alphaBackground, setAlphaBackground] = useState(false);

  const [isRetranslating, setIsRetranslating] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDeletingPatch, setIsDeletingPatch] = useState(false);

  // Sync patch path when caption changes
  useEffect(() => {
    setPatchImagePath(caption.patchImagePath);
    rawTextRef.current = caption.rawText ?? "";
    translatedTextRef.current = caption.translatedText ?? "";
  }, [caption.id, caption.patchImagePath, caption.rawText, caption.translatedText]);

  // ─── Save callbacks for AutoSaveTextArea ─────────
  const handleSaveRawText = async (text: string): Promise<boolean> => {
    if (!slug) return false;
    const [error] = await catchError(
      api.api.studio.captions({ slug }).put({
        rawText: text,
        translatedText: translatedTextRef.current || undefined,
      }),
    );
    if (error) {
      console.error("Auto-save rawText failed:", error);
      return false;
    }
    return true;
  };

  const handleSaveTranslatedText = async (text: string): Promise<boolean> => {
    if (!slug) return false;
    const [error] = await catchError(
      api.api.studio.captions({ slug }).put({
        rawText: rawTextRef.current,
        translatedText: text || undefined,
      }),
    );
    if (error) {
      console.error("Auto-save translatedText failed:", error);
      return false;
    }
    return true;
  };

  // ─── Actions ──────────────────────────────────
  const handleReExtract = async () => {
    if (!slug) return;
    setIsExtracting(true);
    const [error, result] = await catchError(
      api.api.studio.extract.post({ captionSlug: slug }),
    );
    setIsExtracting(false);
    if (error || !result.data?.success) {
      onNotification("Re-extract failed", "error");
      return;
    }
    onCaptionUpdated();
    onNotification("Text re-extracted", "success");
  };

  const handleRetranslate = async () => {
    if (!slug) return;
    setIsRetranslating(true);
    const [error, result] = await catchError(
      api.api.studio.captions({ slug }).translate.post(),
    );
    setIsRetranslating(false);
    if (error || !result.data?.success) {
      onNotification("Retranslation failed", "error");
      return;
    }
    onCaptionUpdated();
  };

  const handleGeneratePatch = async () => {
    if (!slug) return;
    const textLines = translatedTextRef.current
      .split("\n")
      .filter((l) => l.trim());
    if (textLines.length === 0) {
      onNotification("No text to render", "error");
      return;
    }

    setIsGenerating(true);
    const [error, result] = await catchError(
      api.api.studio.captions({ slug }).patch.post({
        lines: textLines,
        fontSize,
        fontType,
        textColor,
        strokeColor: useStroke ? strokeColor : null,
        strokeWidth: useStroke ? strokeWidth : 0,
        cleanerThreshold,
        alphaBackground,
      }),
    );
    setIsGenerating(false);
    if (error || !result.data?.success) {
      onNotification("Patch generation failed", "error");
      return;
    }
    if (result.data.patchUrl) {
      setPatchImagePath(`${result.data.patchUrl}?t=${Date.now()}`);
      onCaptionUpdated();
      onNotification("Patch generated", "success");
    }
  };

  const handleDeletePatch = async () => {
    if (!slug) return;
    setIsDeletingPatch(true);
    const [error, result] = await catchError(
      api.api.studio.captions({ slug }).patch.delete(),
    );
    setIsDeletingPatch(false);
    if (error || !result.data?.success) {
      onNotification("Failed to delete patch", "error");
      return;
    }
    setPatchImagePath(undefined);
    onCaptionUpdated();
    onNotification("Patch deleted", "success");
  };

  const handleDeleteRegion = async () => {
    if (!slug) return;
    const [error] = await catchError(
      api.api.studio.captions({ slug }).delete(),
    );
    if (error) {
      onNotification("Failed to delete region", "error");
      return;
    }
    onDeleteCaption(caption.id);
  };

  return (
    <div className="flex-1 p-3 space-y-3 overflow-y-auto">
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
        Selected Region
      </h3>

      {/* Thumbnail */}
      {caption.capturedImage && (
        <img
          src={caption.capturedImage}
          alt="Region"
          className="w-full rounded border border-gray-200"
          style={{ maxHeight: 120, objectFit: "contain" }}
        />
      )}

      {/* Extracted Text */}
      <AutoSaveTextArea
        captionId={caption.id}
        label="Original:"
        value={caption.rawText ?? ""}
        onSave={handleSaveRawText}
        onLocalChange={(text) => { rawTextRef.current = text; }}
        action={{
          label: "Re-Extract",
          isLoading: isExtracting,
          onClick: handleReExtract,
        }}
      />

      {/* Translation */}
      <AutoSaveTextArea
        captionId={caption.id}
        label="Translation:"
        value={caption.translatedText ?? ""}
        onSave={handleSaveTranslatedText}
        onLocalChange={(text) => { translatedTextRef.current = text; }}
        textareaClassName="w-full px-2 py-1 text-sm border border-gray-300 rounded text-blue-700 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
        action={{
          label: "Retranslate",
          isLoading: isRetranslating,
          onClick: handleRetranslate,
          className: "text-xs px-2 py-0.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded transition-colors",
        }}
      />

      {/* Patch Config (collapsible) */}
      <div className="border border-gray-300 rounded overflow-hidden">
        <button
          onClick={() => setShowPatchConfig(!showPatchConfig)}
          className="w-full px-3 py-1.5 bg-gray-100 hover:bg-gray-200 transition-colors flex items-center justify-between text-xs font-semibold text-gray-700"
        >
          <span>Text Config</span>
          <i
            className={`fas fa-chevron-${showPatchConfig ? "up" : "down"} text-gray-500`}
          />
        </button>
        {showPatchConfig && (
          <div className="p-2 space-y-2 bg-gray-50 text-xs">
            {/* Font Size */}
            <div className="flex items-center gap-2">
              <label className="w-14 font-semibold text-gray-600">Size:</label>
              <input
                type="range"
                min="5"
                max="30"
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="flex-1"
              />
              <span className="w-8 text-center font-mono">{fontSize}</span>
            </div>

            {/* Font Type */}
            <div className="flex items-center gap-2">
              <label className="w-14 font-semibold text-gray-600">Font:</label>
              <select
                value={fontType}
                onChange={(e) =>
                  setFontType(
                    e.target.value as "regular" | "bold" | "italic",
                  )
                }
                className="flex-1 px-2 py-1 border border-gray-300 rounded"
              >
                <option value="regular">Regular</option>
                <option value="bold">Bold</option>
                <option value="italic">Italic</option>
              </select>
            </div>

            {/* Text Color */}
            <div className="flex items-center gap-2">
              <label className="w-14 font-semibold text-gray-600">Text:</label>
              <input
                type="color"
                value={textColor}
                onChange={(e) => setTextColor(e.target.value)}
                className="w-8 h-6 border border-gray-300 rounded cursor-pointer"
              />
              <input
                type="text"
                value={textColor}
                onChange={(e) => setTextColor(e.target.value)}
                className="flex-1 px-2 py-1 border border-gray-300 rounded font-mono"
              />
            </div>

            {/* Stroke */}
            <div className="flex items-center gap-2">
              <label className="w-14 font-semibold text-gray-600 flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={useStroke}
                  onChange={(e) => setUseStroke(e.target.checked)}
                />
                Stroke
              </label>
              <input
                type="color"
                value={strokeColor}
                onChange={(e) => setStrokeColor(e.target.value)}
                disabled={!useStroke}
                className="w-8 h-6 border border-gray-300 rounded disabled:opacity-50 cursor-pointer"
              />
              <input
                type="text"
                value={strokeColor}
                onChange={(e) => setStrokeColor(e.target.value)}
                disabled={!useStroke}
                className="flex-1 px-2 py-1 border border-gray-300 rounded font-mono disabled:opacity-50"
              />
            </div>

            {useStroke && (
              <div className="flex items-center gap-2">
                <label className="w-14 font-semibold text-gray-600">
                  Width:
                </label>
                <input
                  type="range"
                  min="0"
                  max="10"
                  value={strokeWidth}
                  onChange={(e) => setStrokeWidth(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="w-8 text-center font-mono">{strokeWidth}</span>
              </div>
            )}

            {/* Cleaner Threshold */}
            <div className="flex items-center gap-2">
              <label className="w-14 font-semibold text-gray-600" title="Lower = more aggressive text removal">
                Clean:
              </label>
              <input
                type="range"
                min="50"
                max="240"
                value={cleanerThreshold}
                onChange={(e) => setCleanerThreshold(Number(e.target.value))}
                disabled={alphaBackground}
                className="flex-1 disabled:opacity-50"
              />
              <span className="w-10 text-center font-mono text-xs">{cleanerThreshold}</span>
            </div>
            <p className="text-xs text-gray-500 italic">
              200=default, lower=aggressive, higher=conservative
            </p>

            {/* Alpha Background */}
            <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
              <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={alphaBackground}
                  onChange={(e) => setAlphaBackground(e.target.checked)}
                  className="w-4 h-4"
                />
                <span>Alpha Background</span>
              </label>
            </div>
            <p className="text-xs text-gray-500 italic">
              Transparent background, text only (skip cleaning)
            </p>
          </div>
        )}
      </div>

      {/* Generate Patch */}
      <button
        onClick={handleGeneratePatch}
        disabled={isGenerating || !slug}
        className="w-full px-3 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded transition-colors flex items-center justify-center gap-2"
      >
        {isGenerating ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
            <span>Generating...</span>
          </>
        ) : (
          <>
            <i className="fas fa-magic" />
            <span>{patchImagePath ? "Regenerate Patch" : "Generate Patch"}</span>
          </>
        )}
      </button>

      {/* Patch Preview */}
      {patchImagePath && (
        <div>
          <label className="text-xs font-semibold text-gray-700 mb-1 block">
            Patch Preview:
          </label>
          <img
            src={patchImagePath}
            alt="Patch"
            className="w-full rounded border border-gray-200"
            style={{ maxHeight: 120, objectFit: "contain" }}
          />
        </div>
      )}

      {/* Delete Patch */}
      {patchImagePath && (
        <button
          onClick={handleDeletePatch}
          disabled={isDeletingPatch}
          className="w-full px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white text-sm font-semibold rounded transition-colors flex items-center justify-center gap-2"
        >
          <i className="fas fa-eraser" />
          <span>{isDeletingPatch ? "Deleting..." : "Delete Patch"}</span>
        </button>
      )}

      {/* Delete Region */}
      <button
        onClick={handleDeleteRegion}
        className="w-full px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded transition-colors flex items-center justify-center gap-2"
      >
        <i className="fas fa-trash" />
        <span>Delete Region</span>
      </button>
    </div>
  );
}
