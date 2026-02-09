import { useState } from "react";
import { useStudioStore } from "../../../stores/studioFabricStore";
import { api } from "../../../lib/api";
import { catchError } from "../../../../lib/error-handler";
import { Rect } from "fabric";
import type { ExtendedRect } from "../../../types/fabric-extensions";

/**
 * AutoDetectButton - Button to automatically detect text regions using YOLO
 *
 * Features:
 * - Sends current page image to YOLO model
 * - Receives bounding boxes for detected text regions
 * - Creates rectangle regions on canvas
 * - Saves to history
 */
export function AutoDetectButton() {
  const [isDetecting, setIsDetecting] = useState(false);
  const fabricCanvas = useStudioStore((s) => s.fabricCanvas);
  const saveHistory = useStudioStore((s) => s.saveHistory);

  const handleAutoDetect = async () => {
    if (!fabricCanvas || isDetecting) return;

    setIsDetecting(true);

    try {
      // Get background image (first object in canvas)
      const objects = fabricCanvas.getObjects();
      const bgImage = objects.find((o) => o.type === "image");

      if (!bgImage) {
        alert("No background image found");
        return;
      }

      // Create temporary canvas to extract image
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = fabricCanvas.width || 800;
      tempCanvas.height = fabricCanvas.height || 600;
      const ctx = tempCanvas.getContext("2d");

      if (!ctx) {
        alert("Failed to create canvas context");
        return;
      }

      // Draw only the background image
      const dataURL = fabricCanvas.toDataURL({
        format: "png",
        multiplier: 1,
      });

      // Load and draw image to temp canvas
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = dataURL;
      });

      ctx.drawImage(img, 0, 0);

      // Get base64 (remove data:image/png;base64, prefix)
      const base64 = tempCanvas.toDataURL("image/png").split(",")[1];

      if (!base64) {
        alert("Failed to extract image data");
        return;
      }

      // Call Studio API via Eden Treaty
      const response = await api.api.studio.predict.post({
        imageBase64: base64,
      });

      if (!response.data || !response.data.success) {
        const error = response.data?.error || "Unknown error";
        console.error("Prediction error:", error);
        alert(`Prediction failed: ${error}`);
        return;
      }

      const regions = response.data.regions;
      if (!regions || regions.length === 0) {
        alert("No text regions detected");
        return;
      }

      // Create rectangles for each detected region
      let createdCount = 0;
      for (const bbox of regions) {
        const rect = new Rect({
          left: bbox.x1,
          top: bbox.y1,
          width: bbox.x2 - bbox.x1,
          height: bbox.y2 - bbox.y1,
          fill: "rgba(236, 72, 153, 0.1)", // Pink with low opacity
          stroke: "rgba(236, 72, 153, 0.8)",
          strokeWidth: 2,
          strokeUniform: true, // Keep stroke width consistent when scaled
          selectable: true,
          hasControls: false, // Disable resize handles (like RectangleTool)
          hasBorders: false,  // Disable border (like RectangleTool)
          originX: "left",    // Explicitly set origin to top-left
          originY: "top",     // Explicitly set origin to top-left
        }) as ExtendedRect;

        // Add custom data
        rect.id = `rect-${Date.now()}-${createdCount}`;
        rect.data = {
          type: "mask",
          clean: false, // Default: no cleaning
        };

        fabricCanvas.add(rect);
        saveHistory(rect); // Save each rect to history
        createdCount++;
      }

      fabricCanvas.renderAll();

      alert(`Created ${createdCount} regions from ${regions.length} detections`);
    } catch (error) {
      console.error("Auto-detect error:", error);
      alert(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDetecting(false);
    }
  };

  return (
    <button
      onClick={handleAutoDetect}
      disabled={isDetecting || !fabricCanvas}
      className={`w-full px-3 py-2 rounded font-medium text-sm transition-colors ${
        isDetecting || !fabricCanvas
          ? "bg-gray-600 text-gray-400 cursor-not-allowed"
          : "bg-cyan-600 hover:bg-cyan-700 text-white"
      }`}
      title="Automatically detect text regions using AI"
    >
      {isDetecting ? (
        <>
          <span className="inline-block animate-spin mr-2">⚙</span>
          Detecting...
        </>
      ) : (
        <>
          <span className="mr-2">🤖</span>
          Auto Detect Regions
        </>
      )}
    </button>
  );
}
