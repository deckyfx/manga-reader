import { useRef, useEffect } from "react";
import { Canvas, FabricImage } from "fabric";
import { useStudioStore } from "../../stores/studioFabricStore";
import { StudioToolType } from "./types";
import {
  useBrushTool,
  useRectangleTool,
  useOvalTool,
  usePolygonTool,
  PolygonFinishButton,
} from "./tools";
import type { ExtendedTextbox } from "../../types/fabric-extensions";

/**
 * StudioCanvas - Main canvas area with Fabric.js (PanelPachi approach)
 *
 * Key difference: Image is INSIDE Fabric canvas, not a separate HTML element
 * Uses modular tool system for clean separation of concerns
 */
export function StudioCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);

  // Zustand store
  const imageSrc = useStudioStore((state) => state.imageSrc);
  const tool = useStudioStore((state) => state.tool);
  const zoom = useStudioStore((state) => state.zoom);
  const isLoadingChapter = useStudioStore((state) => state.isLoadingChapter);
  const fabricCanvas = useStudioStore((state) => state.fabricCanvas);
  const setFabricCanvas = useStudioStore((state) => state.setFabricCanvas);
  const saveHistory = useStudioStore((state) => state.saveHistory);
  const undo = useStudioStore((state) => state.undo);
  const redo = useStudioStore((state) => state.redo);
  const clearHistory = useStudioStore((state) => state.clearHistory);
  const currentPageData = useStudioStore((state) => state.currentPageData);
  const syncTextOverlays = useStudioStore((state) => state.syncTextOverlays);
  const setSelectedTextbox = useStudioStore(
    (state) => state.setSelectedTextbox,
  );
  const setPopoverAnchor = useStudioStore((state) => state.setPopoverAnchor);

  // Initialize Fabric canvas once on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // Preload fonts before creating canvas
    const preloadFonts = async () => {
      try {
        await document.fonts.ready;
        // Force load specific fonts
        await Promise.all([
          document.fonts.load('16px "Anime Ace"'),
          document.fonts.load('16px "Nunito"'),
          document.fonts.load('16px "ToonTime"'),
        ]);
      } catch (error) {
        console.warn("⚠️ Font loading error (non-critical):", error);
      }
    };

    preloadFonts();

    // Create canvas element imperatively (let Fabric.js fully own it)
    const canvasEl = document.createElement("canvas");
    container.appendChild(canvasEl);

    // Create Fabric canvas
    const canvas = new Canvas(canvasEl, {
      width: containerWidth,
      height: containerHeight,
      isDrawingMode: false,
      selection: true, // Enable click selection of objects
      backgroundColor: "#1f2937", // gray-800
      enableRetinaScaling: false, // Disable retina scaling to prevent coordinate issues
    });

    setFabricCanvas(canvas);

    // Handle selection color changes
    canvas.on("selection:created", (e) => {
      const obj = e.selected?.[0];
      if (
        obj &&
        (obj.type === "rect" ||
          obj.type === "ellipse" ||
          obj.type === "polygon")
      ) {
        obj.set({ fill: "rgba(59, 130, 246, 0.3)" }); // Blue color when selected
        canvas.renderAll();
      }
    });

    canvas.on("selection:updated", (e) => {
      // Deselect previous object - restore original color
      const deselected = e.deselected?.[0];
      if (
        deselected &&
        (deselected.type === "rect" ||
          deselected.type === "ellipse" ||
          deselected.type === "polygon")
      ) {
        deselected.set({ fill: "rgba(236, 72, 153, 0.1)" }); // Original pink color
      }

      // Select new object - change to blue
      const selected = e.selected?.[0];
      if (
        selected &&
        (selected.type === "rect" ||
          selected.type === "ellipse" ||
          selected.type === "polygon")
      ) {
        selected.set({ fill: "rgba(59, 130, 246, 0.3)" }); // Blue color
      }

      canvas.renderAll();
    });

    canvas.on("selection:cleared", (e) => {
      const deselected = e.deselected?.[0];
      if (
        deselected &&
        (deselected.type === "rect" ||
          deselected.type === "ellipse" ||
          deselected.type === "polygon")
      ) {
        deselected.set({ fill: "rgba(236, 72, 153, 0.1)" }); // Original pink color
        canvas.renderAll();
      }
    });

    // Handle textbox clicks to open popover
    canvas.on("mouse:down", (e) => {
      const target = e.target;
      if (!target || target.type !== "textbox") return;

      const textbox = target as ExtendedTextbox;

      // Only open popover for text-patch type textboxes
      if (textbox.data?.type !== "text-patch") return;

      // Calculate popover anchor position (top-right of textbox)
      const bounds = textbox.getBoundingRect();
      const canvasEl = canvas.getElement();
      const rect = canvasEl.getBoundingClientRect();

      const anchorX = rect.left + bounds.left + bounds.width;
      const anchorY = rect.top + bounds.top;

      // Set selected textbox and popover anchor
      setSelectedTextbox(textbox);
      setPopoverAnchor({ x: anchorX, y: anchorY });
    });

    return () => {
      try {
        // Dispose Fabric canvas first
        canvas.dispose();
        // Then remove the canvas element we created
        if (canvasEl.parentNode === container) {
          container.removeChild(canvasEl);
        }
      } catch (error) {
        // Ignore cleanup errors - DOM may already be cleaned up
        console.warn("Canvas disposal warning (safe to ignore):", error);
      }
      setFabricCanvas(null);
    };
  }, []); // Only run once on mount

  // Load image into Fabric canvas when imageSrc changes
  useEffect(() => {
    if (!fabricCanvas || !imageSrc || !containerRef.current) return;

    // Clear canvas and history
    fabricCanvas.clear();
    fabricCanvas.backgroundColor = "#1f2937";
    clearHistory();

    // Load image
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      const fabricImg = new FabricImage(img);

      // Resize canvas to match image dimensions (full size)
      fabricCanvas.setDimensions({
        width: img.width,
        height: img.height,
      });

      // Add image at natural size (no scaling)
      fabricImg.scale(1);
      fabricCanvas.add(fabricImg);
      fabricCanvas.centerObject(fabricImg);

      // Make image non-interactive and exclude from history
      fabricImg.selectable = false;
      fabricImg.evented = false;
      fabricImg.excludeFromExport = true; // Don't include in toJSON()

      // Load mask data if available (after image is loaded)
      if (currentPageData?.maskData) {
        try {
          const maskJSON = JSON.parse(currentPageData.maskData);
          await fabricCanvas.loadFromJSON(maskJSON);

          // Ensure background image stays at the back
          fabricCanvas.sendObjectToBack(fabricImg);

          // Create text overlays for regions with translated text
          syncTextOverlays();

          console.log("Mask data loaded after image");
        } catch (error) {
          console.error("Failed to load mask data:", error);
        }
      }

      fabricCanvas.renderAll();
    };

    img.onerror = (err) => {
      console.error("Failed to load image:", err);
    };

    img.src = imageSrc;
  }, [fabricCanvas, imageSrc, clearHistory, currentPageData]);

  // Activate tools using modular tool hooks
  useBrushTool(fabricCanvas, tool === StudioToolType.BRUSH, saveHistory);

  useRectangleTool(
    fabricCanvas,
    tool === StudioToolType.RECTANGLE,
    saveHistory,
  );

  useOvalTool(fabricCanvas, tool === StudioToolType.OVAL, saveHistory);

  usePolygonTool(fabricCanvas, tool === StudioToolType.POLYGON, saveHistory);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Z or Cmd+Z for undo
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      // Ctrl+Shift+Z or Cmd+Shift+Z for redo
      // Also Ctrl+Y or Cmd+Y for redo
      if (
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "z") ||
        ((e.ctrlKey || e.metaKey) && e.key === "y")
      ) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [undo, redo]);

  // Conditional rendering instead of early return (React Rules of Hooks)
  if (isLoadingChapter) {
    return (
      <div className="flex-1 overflow-auto bg-gray-800">
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-pink-500 mx-auto mb-4" />
            <p className="text-gray-400">Loading chapter...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-gray-800 relative flex items-start justify-center p-4">
      <div
        id="studio-canvas-container"
        ref={containerRef}
        className="inline-block"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: "center",
          transition: "transform 0.2s",
        }}
      />

      {/* Polygon finish button */}
      <PolygonFinishButton />
    </div>
  );
}
