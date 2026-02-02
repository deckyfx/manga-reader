import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { dataUrlToFile } from "../lib/imageUtils";

interface CaptionBubbleProps {
  capturedImage: string;
  x: number;
  y: number;
  onSave: (text: string) => void;
  onDiscard: () => void;
}

type ProcessState = "uploading" | "processing" | "success" | "error";

/**
 * CaptionBubble Component
 *
 * Manages OCR processing for a single caption region
 * - Shows captured image preview
 * - Handles API upload
 * - Displays processing state
 * - Shows Save/Discard buttons
 */
export function CaptionBubble({
  capturedImage,
  x,
  y,
  onSave,
  onDiscard,
}: CaptionBubbleProps) {
  const [state, setState] = useState<ProcessState>("uploading");
  const [text, setText] = useState<string>("");
  const [translatedText, setTranslatedText] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    uploadImage();
  }, []);

  /**
   * Upload image to OCR API
   */
  const uploadImage = async () => {
    try {
      setState("uploading");

      // Convert data URL to File using utility function
      const file = await dataUrlToFile(capturedImage, "capture.png");

      // Upload to API (waits up to 5 seconds for OCR result)
      setState("processing");

      const result = await api.api.ocr.post({ image: file });

      console.log("[CaptionBubble] API Response:", result.data);

      if (result.data?.success) {
        // Check if we got the text immediately
        if (result.data.text) {
          // Got result within 5 seconds!
          console.log("[CaptionBubble] Received OCR text:", result.data.text);
          console.log("[CaptionBubble] Translated text:", result.data.translatedText);
          setState("success");
          setText(result.data.text);
          setTranslatedText(result.data.translatedText || "");
        } else {
          // Still processing (timeout)
          console.log("[CaptionBubble] No text in response, still processing");
          setState("success");
          setText("Processing... Check server console for results.");
          setTranslatedText("");
        }
      } else {
        console.error("[CaptionBubble] API error:", result.data);
        setState("error");
        setError(result.data?.error || "Upload failed");
      }
    } catch (err) {
      console.error("Upload error:", err);
      setState("error");
      setError(err instanceof Error ? err.message : "Failed to upload");
    }
  };

  return (
    <div
      className="absolute bg-white rounded-lg shadow-2xl border-2 border-gray-300 p-3 z-10"
      style={{
        left: x,
        top: y,
        maxWidth: 500,
      }}
    >
      <div className="flex gap-3">
        {/* Captured Image Preview - Left Side */}
        <div className="flex-shrink-0">
          <img
            src={capturedImage}
            alt="Captured region"
            className="rounded border border-gray-200"
            style={{
              maxHeight: 150,
              width: "auto",
              height: "auto",
            }}
          />
        </div>

        {/* Info Panel - Right Side */}
        <div className="flex-1 flex flex-col min-w-0">
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

          {/* Success State */}
          {state === "success" && (
            <>
              <div className="text-sm text-gray-700 mb-3 max-h-32 overflow-y-auto bg-gray-50 rounded p-2 flex-1">
                {/* Original Japanese Text */}
                <div className="mb-2">
                  <div className="text-xs text-gray-500 mb-1">Original:</div>
                  <pre className="whitespace-pre-wrap font-sans">{text}</pre>
                </div>

                {/* Translated English Text */}
                {translatedText && (
                  <div className="pt-2 border-t border-gray-300">
                    <div className="text-xs text-gray-500 mb-1">Translation:</div>
                    <pre className="whitespace-pre-wrap font-sans text-blue-700">
                      {translatedText}
                    </pre>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onSave(text)}
                  className="flex-1 px-3 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-semibold rounded transition-colors"
                >
                  ✓ Save
                </button>
                <button
                  onClick={onDiscard}
                  className="flex-1 px-3 py-2 bg-gray-500 hover:bg-gray-600 text-white text-sm font-semibold rounded transition-colors"
                >
                  ✕ Discard
                </button>
              </div>
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
                className="w-full px-3 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded transition-colors"
              >
                ✕ Discard
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
