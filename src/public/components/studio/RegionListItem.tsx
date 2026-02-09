import React from "react";
import type { FabricObject } from "fabric";
import type {
  ExtendedRect,
  ExtendedEllipse,
  ExtendedPolygon,
} from "../../types/fabric-extensions";
import type { Region } from "../../../lib/region-types";
import { useStudioStore } from "../../stores/studioFabricStore";

interface RegionItem {
  id: string;
  type: "rectangle" | "oval" | "polygon";
  region?: Region;
  fabricObject: FabricObject;
  preview?: string;
  originalText?: string;
  translatedText?: string;
}

type ExtendedFabricObject =
  | ExtendedRect
  | ExtendedEllipse
  | ExtendedPolygon;

interface RegionListItemProps {
  item: RegionItem;
  index: number;
  isSelected: boolean;
  isProcessing: boolean;
  onSelect: (item: RegionItem) => void;
  onDelete: (item: RegionItem) => void;
  onToggleClean: (item: RegionItem) => void;
  onRunOCR: (item: RegionItem) => void;
  onRunReTranslate: (item: RegionItem) => void;
  onUpdateText: (item: RegionItem, field: "originalText" | "translatedText", value: string) => void;
}

/**
 * RegionListItem - Individual region item in the list
 */
export function RegionListItem({
  item,
  index,
  isSelected,
  isProcessing,
  onSelect,
  onDelete,
  onToggleClean,
  onRunOCR,
  onRunReTranslate,
  onUpdateText,
}: RegionListItemProps) {
  const createTextObjectFromRegion = useStudioStore(
    (s) => s.createTextObjectFromRegion,
  );

  const hasText = item.originalText || item.translatedText;
  const extObj = item.fabricObject as ExtendedFabricObject;
  const cleanEnabled =
    extObj.data?.type === "mask" ? extObj.data.clean || false : false;

  return (
    <div
      key={item.id}
      className={`p-3 rounded-lg transition-colors ${
        isSelected
          ? "bg-blue-600/50"
          : "bg-gray-700 hover:bg-gray-650"
      }`}
    >
      {/* Header: Preview, Name, Delete */}
      <div className="flex items-center justify-between mb-2">
        <div
          className="flex items-center gap-3 flex-1 cursor-pointer"
          onClick={() => onSelect(item)}
        >
          {/* Preview image */}
          {item.preview && (
            <img
              src={item.preview}
              alt={`${item.type} preview`}
              className="w-12 h-12 object-contain bg-gray-600 rounded border border-gray-500"
            />
          )}

          <span className="text-white text-sm font-medium capitalize">
            {item.type} #{index + 1}
          </span>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item);
          }}
          className="text-red-400 hover:text-red-300 p-1.5 rounded hover:bg-red-900/20 transition-colors"
          title="Delete region"
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
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>

      {/* OCR Controls */}
      <div
        className="flex flex-col gap-2 mb-2"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Clean checkbox */}
        <label className="flex items-center gap-2 text-gray-300 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={cleanEnabled}
            onChange={() => onToggleClean(item)}
            className="w-3 h-3 rounded border-gray-600 accent-green-600 hover:accent-green-600 focus:accent-green-600"
          />
          <span>Clean (inpaint when OCR)</span>
        </label>

        {/* OCR and ReTranslate buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onRunOCR(item)}
            disabled={isProcessing}
            className={`px-2 py-1 rounded text-xs font-medium ${
              isProcessing
                ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                : "bg-green-600 hover:bg-green-700 text-white"
            }`}
          >
            {isProcessing ? "..." : "OCR"}
          </button>
          <button
            onClick={() => onRunReTranslate(item)}
            disabled={isProcessing || !item.originalText}
            className={`px-2 py-1 rounded text-xs font-medium ${
              isProcessing || !item.originalText
                ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                : "bg-purple-600 hover:bg-purple-700 text-white"
            }`}
          >
            {isProcessing ? "..." : "ReTranslate"}
          </button>
        </div>
      </div>

      {/* Text editing section - only show if has OCR data */}
      {hasText && (
        <div
          className="space-y-2"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Original Text */}
          <div>
            <label className="text-gray-300 text-xs font-medium block mb-1">
              Original
            </label>
            <input
              type="text"
              value={item.originalText || ""}
              onChange={(e) =>
                onUpdateText(item, "originalText", e.target.value)
              }
              placeholder="Original text..."
              className="w-full px-2 py-1.5 text-xs bg-gray-800 text-gray-300 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Translated Text */}
          <div>
            <label className="text-gray-300 text-xs font-medium block mb-1">
              Translated
            </label>
            <input
              type="text"
              value={item.translatedText || ""}
              onChange={(e) =>
                onUpdateText(item, "translatedText", e.target.value)
              }
              placeholder="Translated text..."
              className="w-full px-2 py-1.5 text-xs bg-gray-800 text-white border border-gray-600 rounded focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Create Text Object Button */}
          {item.translatedText && (
            <button
              onClick={() => createTextObjectFromRegion(item.fabricObject)}
              className="w-full px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-medium rounded"
            >
              Create Text Object
            </button>
          )}
        </div>
      )}
    </div>
  );
}
