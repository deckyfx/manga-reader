import { useState } from "react";
import { RectangleOverlay } from "./RectangleOverlay";
import { ViewOnlyCaptionBubble } from "./ViewOnlyCaptionBubble";
import { EditableCaptionBubble } from "./EditableCaptionBubble";

interface CaptionRectangleProps {
  id: string;
  captionId?: number;
  captionSlug?: string;
  pageId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  capturedImage: string;
  rawText?: string;
  translatedText?: string;
  imagePath: string;
  editMode: boolean;
  isActive: boolean;
  onActivate: () => void;
  onDiscard: () => void;
  onUpdate: () => void;
  onClose: () => void;
}

/**
 * CaptionRectangle Component
 *
 * Container component that composes caption UI elements
 * - Manages its own hover state
 * - Shows ViewOnlyCaptionBubble on hover in view mode
 * - Shows EditableCaptionBubble when active in edit mode
 * - Uses RectangleOverlay for visual region marking
 */
export function CaptionRectangle({
  id,
  captionId,
  captionSlug,
  pageId,
  x,
  y,
  width,
  height,
  capturedImage,
  rawText,
  translatedText,
  imagePath,
  editMode,
  isActive,
  onActivate,
  onDiscard,
  onUpdate,
  onClose,
}: CaptionRectangleProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div key={id}>
      {/* Rectangle overlay - visible in both modes */}
      <RectangleOverlay
        x={x}
        y={y}
        width={width}
        height={height}
        editMode={editMode}
        onClick={() => editMode && onActivate()}
        onMouseEnter={() => !editMode && setIsHovered(true)}
        onMouseLeave={() => !editMode && setIsHovered(false)}
      />

      {/* Edit mode: Full editing interface */}
      {editMode && isActive && (
        <EditableCaptionBubble
          existingCaptionId={captionId}
          existingCaptionSlug={captionSlug}
          existingRawText={rawText}
          existingTranslatedText={translatedText}
          pageId={pageId}
          capturedImage={capturedImage}
          imagePath={imagePath}
          x={x + width + 10}
          y={y}
          rectX={x}
          rectY={y}
          rectWidth={width}
          rectHeight={height}
          onDiscard={onDiscard}
          onUpdate={onUpdate}
          onClose={onClose}
        />
      )}

      {/* View mode: Hover preview with captured image and text */}
      {!editMode && isHovered && (
        <ViewOnlyCaptionBubble
          capturedImage={capturedImage}
          rawText={rawText}
          translatedText={translatedText}
          x={x + width + 10}
          y={y}
          width={width}
          height={height}
        />
      )}
    </div>
  );
}
