import React, { useState, useRef } from "react";
import html2canvas from "html2canvas";
import { DraggableResizable } from "./DraggableResizable";
import { displayedToNaturalRect } from "../lib/imageUtils";
import { api } from "../../lib/api";

/**
 * OCRSelector Component
 *
 * Allows users to select a region on an image and extract text using Tesseract OCR.
 * Features:
 * - Draggable and resizable selection box (custom implementation)
 * - Visual selection overlay
 * - Client-side OCR processing
 * - Display extracted text with copy functionality
 */
export function OCRSelector({ imageUrl }: { imageUrl: string }) {
  const [showSelector, setShowSelector] = useState(false);
  const [selectionSize, setSelectionSize] = useState({ width: 200, height: 100 });
  const [selectionPosition, setSelectionPosition] = useState({ x: 50, y: 50 });
  const [ocrResult, setOcrResult] = useState<string>("");
  const [ocrMetadata, setOcrMetadata] = useState<{
    confidence?: number;
    words?: number;
    savedAs?: string;
    path?: string;
    engine?: string;
    processingTime?: number;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // OCR Configuration
  const [ocrLanguage, setOcrLanguage] = useState<string>("jpn");
  const [ocrOrientation, setOcrOrientation] = useState<string>("vertical");
  const [ocrEngine, setOcrEngine] = useState<string>("tesseract-cli");
  const [ocrPreset, setOcrPreset] = useState<string>("japaneseVertical");

  /**
   * Capture the selected region and display preview
   */
  const captureRegion = async () => {
    if (!imageRef.current || !containerRef.current) return;

    try {
      // Get displayed image dimensions using getBoundingClientRect()
      const imgRect = imageRef.current.getBoundingClientRect();
      const displayedWidth = imgRect.width;
      const displayedHeight = imgRect.height;

      // Capture the image element as canvas (at actual natural resolution)
      const canvas = await html2canvas(imageRef.current, {
        useCORS: true,
        allowTaint: true,
      });

      // Use CANVAS dimensions as the true natural size (not imageRef.naturalWidth!)
      // html2canvas captures at the actual image resolution
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;

      // Calculate scale factors between displayed and canvas dimensions
      const scaleX = canvasWidth / displayedWidth;
      const scaleY = canvasHeight / displayedHeight;

      console.log("Image dimensions:", {
        displayed: { width: displayedWidth, height: displayedHeight },
        canvas: { width: canvasWidth, height: canvasHeight },
        scaleFactors: { x: scaleX, y: scaleY },
      });

      // Convert displayed selection coordinates to canvas coordinates
      const displayedRect = {
        x: selectionPosition.x,
        y: selectionPosition.y,
        width: selectionSize.width,
        height: selectionSize.height,
      };

      // Scale coordinates manually using canvas dimensions
      const naturalRect = {
        x: displayedRect.x * scaleX,
        y: displayedRect.y * scaleY,
        width: displayedRect.width * scaleX,
        height: displayedRect.height * scaleY,
      };

      console.log("Displayed selection:", displayedRect);
      console.log("Canvas (scaled) coordinates:", naturalRect);

      // Create a new canvas for the cropped region
      const croppedCanvas = document.createElement("canvas");
      const ctx = croppedCanvas.getContext("2d");
      if (!ctx) return;

      // Set cropped canvas size to match scaled dimensions
      croppedCanvas.width = naturalRect.width;
      croppedCanvas.height = naturalRect.height;

      // Draw the cropped region using natural coordinates
      ctx.drawImage(
        canvas,
        naturalRect.x,
        naturalRect.y,
        naturalRect.width,
        naturalRect.height,
        0,
        0,
        naturalRect.width,
        naturalRect.height
      );

      // Convert to data URL for preview
      const dataUrl = croppedCanvas.toDataURL("image/png");
      setCapturedImage(dataUrl);
      setShowSelector(false);
    } catch (error) {
      console.error("Capture Error:", error);
      alert("Error capturing image. Please try again.");
    }
  };

  /**
   * Run OCR on captured image using server-side processing
   */
  const runOCR = async () => {
    if (!capturedImage) return;

    setIsProcessing(true);
    setProgress(0);

    try {
      // Convert data URL to blob
      const response = await fetch(capturedImage);
      const blob = await response.blob();

      // Create a File object from the blob for the API
      const file = new File([blob], "capture.png", { type: "image/png" });

      // Simulate progress during upload
      setProgress(30);

      // Send to server-side OCR endpoint with configuration
      const result = await api.api.ocr.post({
        image: file,
        language: ocrLanguage,
        orientation: ocrOrientation,
        engine: ocrEngine,
        preset: ocrPreset,
      });

      setProgress(100);

      if (result.data?.success) {
        setOcrResult(result.data.text);
        setOcrMetadata({
          confidence: result.data.confidence,
          words: result.data.words,
          savedAs: result.data.savedAs,
          path: result.data.path,
          engine: result.data.engine,
          processingTime: result.data.processingTime,
        });
        console.log("OCR Success:", {
          confidence: result.data.confidence,
          words: result.data.words,
          savedAs: result.data.savedAs,
        });
      } else {
        setOcrResult(
          `Error: ${result.data?.error || "OCR processing failed"}`
        );
        setOcrMetadata(null);
      }
    } catch (error) {
      console.error("OCR Error:", error);
      setOcrResult("Error processing image. Please try again.");
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  };

  /**
   * Handle size change from DraggableResizable
   */
  const handleSizeChange = (width: number, height: number) => {
    setSelectionSize({ width, height });
  };

  /**
   * Handle position change from DraggableResizable
   */
  const handlePositionChange = (x: number, y: number) => {
    setSelectionPosition({ x, y });
  };

  return (
    <div className="space-y-4">
      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-800 mb-2">
          📝 <strong>How to use:</strong>
        </p>
        <ol className="text-sm text-blue-800 space-y-1 ml-4">
          <li>1. Configure OCR settings below</li>
          <li>2. Click "Enable Selection" to show the selection box</li>
          <li>3. Drag the box to move it, resize from corners/edges</li>
          <li>4. Click "Capture Region" to preview</li>
          <li>5. Click "Run OCR" to extract text</li>
        </ol>
      </div>

      {/* OCR Configuration */}
      <div className="bg-white rounded-lg shadow-lg p-4">
        <h3 className="text-md font-semibold text-gray-800 mb-3">
          ⚙️ OCR Configuration
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Preset Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Preset
            </label>
            <select
              value={ocrPreset}
              onChange={(e) => {
                const preset = e.target.value;
                setOcrPreset(preset);
                // Auto-set language and orientation based on preset
                if (preset === "japaneseVertical") {
                  setOcrLanguage("jpn_vert");
                  setOcrOrientation("vertical");
                } else if (preset === "japaneseHorizontal") {
                  setOcrLanguage("jpn");
                  setOcrOrientation("horizontal");
                } else if (preset === "englishHorizontal") {
                  setOcrLanguage("eng");
                  setOcrOrientation("horizontal");
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="japaneseVertical">📖 Japanese Vertical (Manga)</option>
              <option value="japaneseHorizontal">🇯🇵 Japanese Horizontal</option>
              <option value="englishHorizontal">🇬🇧 English Horizontal</option>
              <option value="custom">⚙️ Custom</option>
            </select>
          </div>

          {/* Language */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Language
            </label>
            <select
              value={ocrLanguage}
              onChange={(e) => setOcrLanguage(e.target.value)}
              disabled={ocrPreset !== "custom"}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
            >
              <option value="jpn_vert">Japanese Vertical</option>
              <option value="jpn">Japanese Horizontal</option>
              <option value="eng">English</option>
              <option value="chi_sim">Chinese Simplified</option>
              <option value="chi_tra">Chinese Traditional</option>
              <option value="kor">Korean</option>
            </select>
          </div>

          {/* Orientation */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Text Orientation
            </label>
            <select
              value={ocrOrientation}
              onChange={(e) => setOcrOrientation(e.target.value)}
              disabled={ocrPreset !== "custom"}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
            >
              <option value="vertical">⬇️ Vertical (Top to Bottom)</option>
              <option value="horizontal">➡️ Horizontal (Left to Right)</option>
              <option value="auto">🔄 Auto Detect</option>
            </select>
          </div>

          {/* Engine */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              OCR Engine
            </label>
            <select
              value={ocrEngine}
              onChange={(e) => setOcrEngine(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="tesseract-cli">🚀 Tesseract CLI (Fast)</option>
              <option value="tesseract-js">📦 Tesseract.js (Slow)</option>
              <option value="python">🐍 Python (Custom)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Control buttons */}
      <div className="flex gap-3">
        <button
          onClick={() => setShowSelector(!showSelector)}
          className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
            showSelector
              ? "bg-red-500 hover:bg-red-600 text-white"
              : "bg-blue-500 hover:bg-blue-600 text-white"
          }`}
        >
          {showSelector ? "Hide Selection" : "Enable Selection"}
        </button>

        {showSelector && (
          <button
            onClick={captureRegion}
            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold transition-colors"
          >
            📸 Capture Region
          </button>
        )}

        {capturedImage && !isProcessing && (
          <button
            onClick={runOCR}
            disabled={isProcessing}
            className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            🔍 Run OCR
          </button>
        )}
      </div>

      {/* Image with selection overlay */}
      <div ref={containerRef} className="relative inline-block">
        <img
          ref={imageRef}
          src={imageUrl}
          alt="Comic page for OCR"
          className="max-w-full h-auto rounded-lg shadow-lg"
          crossOrigin="anonymous"
        />

        {/* Custom Draggable and Resizable selection box */}
        {showSelector && (
          <DraggableResizable
            initialX={selectionPosition.x}
            initialY={selectionPosition.y}
            initialWidth={selectionSize.width}
            initialHeight={selectionSize.height}
            minWidth={50}
            minHeight={50}
            onPositionChange={handlePositionChange}
            onSizeChange={handleSizeChange}
          >
            <div className="w-full h-full border-2 border-blue-500 bg-blue-200 bg-opacity-30 flex items-center justify-center cursor-move">
              <span className="text-blue-700 font-semibold bg-white bg-opacity-75 px-2 py-1 rounded text-sm pointer-events-none">
                Drag to move • Resize from corners/edges
              </span>
            </div>
          </DraggableResizable>
        )}
      </div>

      {/* Captured Image Preview */}
      {capturedImage && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-gray-800">
              📸 Captured Region
            </h3>
            <button
              onClick={() => {
                setCapturedImage(null);
                setOcrResult("");
                setOcrMetadata(null);
                setShowSelector(true);
              }}
              className="text-sm bg-gray-500 hover:bg-gray-600 text-white px-3 py-1 rounded transition-colors"
            >
              ↻ Recapture
            </button>
          </div>
          <div className="bg-gray-100 p-4 rounded flex items-center justify-center">
            <img
              src={capturedImage}
              alt="Captured region"
              className="max-w-full h-auto border-2 border-gray-300 rounded"
            />
          </div>
          <p className="text-sm text-gray-600 mt-2">
            Image size: {selectionSize.width} × {selectionSize.height} pixels
          </p>
        </div>
      )}

      {/* Processing indicator */}
      {isProcessing && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-700 mb-1">
                Processing OCR... {progress}%
              </p>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* OCR Result */}
      {ocrResult && !isProcessing && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-800">
                📄 Extracted Text
              </h3>
              {ocrMetadata && (
                <div className="text-sm text-gray-600 mt-1 space-y-1">
                  <p>
                    {ocrMetadata.confidence ? `Confidence: ${ocrMetadata.confidence?.toFixed(1)}%` : ""}
                    {ocrMetadata.confidence && ocrMetadata.words ? " • " : ""}
                    Words: {ocrMetadata.words}
                    {ocrMetadata.engine && ` • Engine: ${ocrMetadata.engine}`}
                    {ocrMetadata.processingTime && ` • ${ocrMetadata.processingTime}ms`}
                  </p>
                  {ocrMetadata.savedAs && (
                    <p className="text-xs">
                      💾 Saved as:{" "}
                      <code className="bg-gray-100 px-1 rounded">
                        {ocrMetadata.savedAs}
                      </code>
                      {ocrMetadata.path && (
                        <>
                          {" "}•{" "}
                          <a
                            href={ocrMetadata.path}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            View
                          </a>
                        </>
                      )}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(ocrResult);
                  alert("Text copied to clipboard!");
                }}
                className="text-sm bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded transition-colors"
              >
                📋 Copy
              </button>
              <button
                onClick={() => {
                  setOcrResult("");
                  setOcrMetadata(null);
                }}
                className="text-sm bg-gray-500 hover:bg-gray-600 text-white px-3 py-1 rounded transition-colors"
              >
                ✕ Clear
              </button>
            </div>
          </div>
          <div className="bg-gray-50 rounded p-4 max-h-64 overflow-y-auto">
            <pre className="whitespace-pre-wrap font-mono text-sm text-gray-700">
              {ocrResult}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
