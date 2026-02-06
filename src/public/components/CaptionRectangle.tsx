import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
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
  patchImagePath?: string;
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
  patchImagePath,
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
      {/* View mode: Patch image overlay (if available) */}
      {!editMode && patchImagePath && (
        <img
          src={patchImagePath}
          alt="Translation patch"
          className="absolute pointer-events-none rounded"
          style={{
            left: x,
            top: y,
            width: width,
            height: height,
            objectFit: "cover",
          }}
        />
      )}

      {/* Edit mode: Popover with positioned anchor */}
      {editMode ? (
        <Popover.Root open={isActive} modal={false}>
          {/* Anchor: Positioned span at rectangle location for Radix reference */}
          <Popover.Anchor asChild>
            <span
              className="absolute pointer-events-none"
              style={{ left: x, top: y, width, height }}
            />
          </Popover.Anchor>

          {/* Visual overlay: The clickable rectangle */}
          <RectangleOverlay
            x={x}
            y={y}
            width={width}
            height={height}
            editMode={editMode}
            onClick={() => {
              // Log rectangle information when clicked in edit mode
              console.log("📍 Rectangle clicked:", {
                rectangle: { x, y, width, height },
                scroll: { x: window.scrollX, y: window.scrollY },
                screen: {
                  width: window.innerWidth,
                  height: window.innerHeight,
                },
                viewport: {
                  width: document.documentElement.clientWidth,
                  height: document.documentElement.clientHeight,
                },
              });
              onActivate();
            }}
          />

          {/* Content: Auto-positioned editable bubble */}
          <Popover.Portal>
            <Popover.Content
              side="right"
              align="start"
              sideOffset={10}
              collisionPadding={20}
              className="z-50 popover-content"
              onOpenAutoFocus={(e) => e.preventDefault()}
              onInteractOutside={(e) => {
                // Prevent closing when clicking inside the popover
                e.preventDefault();
              }}
            >
              <EditableCaptionBubble
                existingCaptionId={captionId!}
                existingCaptionSlug={captionSlug!}
                existingRawText={rawText}
                existingTranslatedText={translatedText}
                existingPatchImagePath={patchImagePath}
                pageId={pageId}
                capturedImage={capturedImage}
                imagePath={imagePath}
                x={0}
                y={0}
                rectX={x}
                rectY={y}
                rectWidth={width}
                rectHeight={height}
                onDiscard={onDiscard}
                onUpdate={onUpdate}
                onClose={onClose}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : (
        /* View mode: Popover with hover trigger */
        <Popover.Root open={isHovered}>
          {/* Anchor: Positioned span at rectangle location for Radix reference */}
          <Popover.Anchor asChild>
            <span
              className="absolute pointer-events-none"
              style={{ left: x, top: y, width, height }}
            />
          </Popover.Anchor>

          {/* Visual overlay: The hoverable rectangle */}
          <RectangleOverlay
            x={x}
            y={y}
            width={width}
            height={height}
            editMode={editMode}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          />

          {/* Content: Auto-positioned hover preview */}
          <Popover.Portal>
            <Popover.Content
              side="right"
              align="start"
              sideOffset={10}
              collisionPadding={20}
              className="z-50"
              onOpenAutoFocus={(e) => e.preventDefault()}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
            >
              <ViewOnlyCaptionBubble
                capturedImage={capturedImage}
                rawText={rawText}
                translatedText={translatedText}
                x={0}
                y={0}
                width={width}
                height={height}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}
