import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { catchError } from "../../lib/error-handler";
import { PatchEditorPanel } from "./PatchEditorPanel";

interface EditableCaptionBubbleProps {
  existingCaptionId?: number;
  existingCaptionSlug?: string;
  existingRawText?: string;
  existingTranslatedText?: string;
  existingPatchImagePath?: string;
  pageId: number;
  capturedImage: string;
  imagePath: string;
  x: number;
  y: number;
  rectX: number;
  rectY: number;
  rectWidth: number;
  rectHeight: number;
  onDiscard: () => void;
  onUpdate: () => void;
  onClose: () => void;
}

type ProcessState = "uploading" | "processing" | "success" | "error";

/**
 * EditableCaptionBubble Component
 *
 * Full-featured editing interface for caption regions
 * - Shows captured image preview
 * - Handles API upload and immediate persistence
 * - Displays editable textareas for original and translated text
 * - Shows Update/Discard buttons
 */
export function EditableCaptionBubble({
  existingCaptionId,
  existingCaptionSlug,
  existingRawText,
  existingTranslatedText,
  existingPatchImagePath,
  pageId,
  capturedImage,
  imagePath,
  x,
  y,
  rectX,
  rectY,
  rectWidth,
  rectHeight,
  onDiscard,
  onUpdate,
  onClose,
}: EditableCaptionBubbleProps) {
  const [state, setState] = useState<ProcessState>(
    existingCaptionId ? "success" : "uploading",
  );
  const [captionId, setCaptionId] = useState<number | null>(
    existingCaptionId || null,
  );
  const [captionSlug, setCaptionSlug] = useState<string | null>(
    existingCaptionSlug || null,
  );
  const [rawText, setRawText] = useState<string>(existingRawText || "");
  const [translatedText, setTranslatedText] = useState<string>(
    existingTranslatedText || "",
  );
  const [patchImagePath, setPatchImagePath] = useState<string | undefined>(
    existingPatchImagePath,
  );
  const [originalRawText, setOriginalRawText] = useState<string>(
    existingRawText || "",
  );
  const [originalTranslatedText, setOriginalTranslatedText] = useState<string>(
    existingTranslatedText || "",
  );
  const [error, setError] = useState<string>("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isRetranslating, setIsRetranslating] = useState(false);
  const [isPatchEditorOpen, setIsPatchEditorOpen] = useState(false);

  // Track if caption has unsaved changes
  const isDirty =
    rawText !== originalRawText || translatedText !== originalTranslatedText;

  useEffect(() => {
    // Only run OCR for new captions (no existing ID)
    if (!existingCaptionId) {
      uploadImage();
    }
  }, [existingCaptionId]);

  /**
   * Upload image to OCR API and save to database immediately
   */
  const uploadImage = async () => {
    setState("uploading");
    setState("processing");

    // Use Eden Treaty for type-safe API call
    const [err, result] = await catchError(
      api.api.ocr.post({
        pageId,
        imagePath,
        x: rectX,
        y: rectY,
        width: rectWidth,
        height: rectHeight,
        capturedImage,
      }),
    );

    if (err) {
      console.error("Upload error:", err);
      setState("error");
      setError(err instanceof Error ? err.message : "Failed to upload");
      return;
    }

    console.log("[CaptionBubble] API Response:", result.data);

    if (result.data?.success) {
      if (result.data.rawText) {
        // Got result and saved to database!
        setState("success");
        setCaptionId(result.data.captionId);
        setCaptionSlug(result.data.captionSlug);
        setRawText(result.data.rawText);
        setTranslatedText(result.data.translatedText || "");
        // Store original values for dirty tracking
        setOriginalRawText(result.data.rawText);
        setOriginalTranslatedText(result.data.translatedText || "");
      } else {
        // Timeout
        setState("error");
        setError("OCR processing timed out");
      }
    } else {
      setState("error");
      setError(result.data?.error || "Upload failed");
    }
  };

  /**
   * Update caption in database
   */
  const handleUpdate = async () => {
    if (!captionSlug) return;

    setIsUpdating(true);

    const [err, result] = await catchError(
      api.api.captions({ slug: captionSlug }).put({
        rawText,
        translatedText: translatedText || undefined,
      }),
    );

    if (err) {
      console.error("Update error:", err);
      setError(err instanceof Error ? err.message : "Failed to update");
      setIsUpdating(false);
      return;
    }

    if (result.data?.success) {
      console.log("[EditableCaptionBubble] Caption updated successfully");
      // Reset dirty state - update original values
      setOriginalRawText(rawText);
      setOriginalTranslatedText(translatedText);
      // Reload all captions from database to refresh UI
      onUpdate();
    } else {
      setError("Failed to update caption");
    }

    setIsUpdating(false);
  };

  /**
   * Delete caption from database and remove from UI
   */
  const handleDelete = async () => {
    if (!captionSlug) {
      onDiscard();
      return;
    }

    const [err, result] = await catchError(
      api.api.captions({ slug: captionSlug }).delete(),
    );

    if (err) {
      console.error("Delete error:", err);
      setError(err instanceof Error ? err.message : "Failed to delete");
      return;
    }

    if (result.data?.success) {
      onDiscard();
    } else {
      setError("Failed to delete caption");
    }
  };

  /**
   * Retry translation for the caption
   */
  const handleRetryTranslate = async () => {
    if (!captionSlug) return;

    setIsRetranslating(true);
    setError("");

    const [err, result] = await catchError(
      api.api.captions({ slug: captionSlug })["retry-translate"].post(),
    );

    if (err) {
      console.error("Retry translate error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to retry translation",
      );
      setIsRetranslating(false);
      return;
    }

    if (result.data?.success && result.data.caption) {
      console.log("[EditableCaptionBubble] Translation retried successfully");
      // Update translated text with new result
      setTranslatedText(result.data.caption.translatedText || "");
      setOriginalTranslatedText(result.data.caption.translatedText || "");
    } else {
      setError("Failed to retry translation");
    }

    setIsRetranslating(false);
  };

  /**
   * Handle patch generation completion
   */
  const handlePatchGenerated = (patchUrl: string) => {
    // Add timestamp to force browser to refresh cached image
    const urlWithTimestamp = `${patchUrl}?t=${Date.now()}`;
    setPatchImagePath(urlWithTimestamp);
    // Don't close the popover - keep it open so user can regenerate if needed
  };

  // Determine layout direction based on rectangle aspect ratio
  // If width > height, image is horizontal/wide -> display vertically (image on top)
  // If height > width, image is vertical/tall -> display horizontally (image on left)
  const isWideImage = rectWidth > rectHeight;

  // Calculate if popup would overflow right edge
  // Consider both rectangle position and its width
  const popupWidth = 550;
  const popupGap = 20;
  const windowWidth = typeof window !== "undefined" ? window.innerWidth : 1920;
  const windowHeight =
    typeof window !== "undefined" ? window.innerHeight : 1080;
  const rightEdgeOfRect = x + rectWidth;
  const wouldOverflowRight =
    rightEdgeOfRect + popupGap + popupWidth > windowWidth;

  // Calculate if popup would overflow bottom edge
  // Estimate popup height (can vary, but use a reasonable max height)
  const estimatedPopupHeight = 600;
  const wouldOverflowBottom = y + estimatedPopupHeight > windowHeight;

  // Adjust Y position if would overflow bottom - move up by 100px
  const adjustedY = wouldOverflowBottom ? y - 300 : y;

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
      className="absolute bg-white rounded-lg shadow-2xl border-2 border-gray-300 p-3 z-10"
      style={popupStyle}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-gray-200 hover:bg-gray-300 text-gray-600 hover:text-gray-800 transition-colors cursor-pointer"
        title="Close without saving"
      >
        <i className="fas fa-times"></i>
      </button>

      <div className={`flex gap-3 ${isWideImage ? "flex-col" : "flex-row"}`}>
        {/* Captured Image Preview + Patch Preview - Left Side or Top */}
        <div className="flex-shrink-0 space-y-3">
          {/* Captured Image */}
          <div>
            <img
              src={capturedImage}
              alt="Captured region"
              className="rounded border border-gray-200"
              style={
                isWideImage
                  ? { maxHeight: 100, width: 200, height: "auto" }
                  : { maxHeight: 150, width: "auto", height: "auto" }
              }
            />
          </div>

          {/* Patch Preview */}
          {patchImagePath && (
            <div>
              <h4 className="text-xs font-semibold text-gray-700 mb-2">
                Patch Preview:
              </h4>
              <img
                src={patchImagePath}
                alt="Generated patch"
                className="rounded border border-gray-200 shadow-sm"
                style={
                  isWideImage
                    ? { maxHeight: 100, width: 200, height: "auto" }
                    : { maxHeight: 150, width: "auto", height: "auto" }
                }
              />
            </div>
          )}
        </div>

        {/* Info Panel - Right Side or Bottom */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Uploading State */}
          {state === "uploading" && (
            <div className="flex items-center gap-2 text-sm text-gray-600 py-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
              <span>Uploading...</span>
            </div>
          )}

          {/* Processing State */}
          {state === "processing" && (
            <div className="flex items-center gap-2 text-sm text-gray-600 py-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-500"></div>
              <span>Processing OCR...</span>
            </div>
          )}

          {/* Success State - Editable Textareas */}
          {state === "success" && (
            <>
              <div className="text-sm text-gray-700 mb-3 flex-1 space-y-2">
                {/* Original Japanese Text - Editable */}
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">
                    Original:
                  </label>
                  <textarea
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                  />
                </div>

                {/* Translated English Text - Editable */}
                <div>
                  <label className="text-xs text-gray-500 mb-1 flex items-center justify-between">
                    <span>Translation:</span>
                    <button
                      onClick={handleRetryTranslate}
                      disabled={isRetranslating}
                      className="text-xs px-2 py-1 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center gap-1"
                      title="Retranslate"
                    >
                      {isRetranslating ? (
                        <>
                          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                          <span>Translating...</span>
                        </>
                      ) : (
                        <>
                          <i className="fas fa-redo text-xs"></i>
                          <span>Retranslate</span>
                        </>
                      )}
                    </button>
                  </label>
                  <textarea
                    value={translatedText}
                    onChange={(e) => setTranslatedText(e.target.value)}
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded text-blue-700 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                    placeholder="Enter translation..."
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 mb-2">
                <button
                  onClick={handleUpdate}
                  disabled={!isDirty || isUpdating}
                  className="flex-1 px-3 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-sm font-semibold rounded transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  title={!isDirty ? "No changes to save" : "Save changes"}
                >
                  {isUpdating ? (
                    "Saving..."
                  ) : (
                    <>
                      <i className="fas fa-check"></i>
                      <span>Update</span>
                    </>
                  )}
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 px-3 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <i className="fas fa-trash"></i>
                  <span>Discard</span>
                </button>
              </div>

              {/* Patch Editor Panel */}
              <PatchEditorPanel
                isOpen={isPatchEditorOpen}
                onToggle={() => setIsPatchEditorOpen(!isPatchEditorOpen)}
                capturedImage={capturedImage}
                translatedText={translatedText}
                captionSlug={captionSlug}
                onPatchGenerated={handlePatchGenerated}
                currentPatchUrl={patchImagePath}
              />
            </>
          )}

          {/* Error State */}
          {state === "error" && (
            <>
              <div className="text-sm text-red-600 mb-2 p-2 bg-red-50 rounded flex-1">
                ❌ {error}
              </div>
              <button
                onClick={onDiscard}
                className="w-full px-3 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <i className="fas fa-times"></i>
                <span>Close</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
