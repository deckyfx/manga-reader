import { create } from "zustand";
import {
  FabricImage,
  Path,
  Textbox,
  type Canvas,
  type FabricObject,
} from "fabric";
import { api } from "../lib/api";
import { catchError, catchErrorSync } from "../../lib/error-handler";
import type { Chapter, Page, Series, PageData } from "../../db/schema";
import type { StudioTool } from "../components/studio/types";
import { ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT } from "../components/studio/types";
import type {
  ExtendedEllipse,
  ExtendedPolygon,
  ExtendedRect,
  ExtendedTextbox,
  FontStyle,
  FontWeight,
  TextPatchData,
} from "../types/fabric-extensions";
import {
  type Region,
  type BoundingBox,
  getRegionBounds,
  getRegionPolygonPoints,
} from "../../lib/region-types";

/**
 * Studio state interface
 */
interface StudioState {
  // Tool state
  tool: StudioTool;
  brushSize: number;

  // Zoom state
  zoom: number;
  minZoom: number;
  maxZoom: number;

  // Image state
  imageLoaded: boolean;
  imageSrc: string;

  // Fabric canvas reference
  fabricCanvas: Canvas | null;

  // History state (stores references to Fabric objects)
  canvasHistory: FabricObject[];
  redoStack: FabricObject[];

  // Chapter and series data
  seriesData: Series | null;
  chapterData: Chapter | null;
  pages: Page[];
  currentPageIndex: number;
  isLoadingChapter: boolean;

  // Page data (mask data from database)
  pageDataId: number | undefined;
  currentPageData: PageData | null;

  // Polygon tool state
  polygonPoints: { x: number; y: number }[];
  setPolygonPoints: (points: { x: number; y: number }[]) => void;

  // Inpaint state
  isInpainting: boolean;

  // OCR state
  isProcessingOCR: boolean;

  // Text Object Popover state
  selectedTextbox: ExtendedTextbox | null;
  setSelectedTextbox: (textbox: ExtendedTextbox | null) => void;
  popoverAnchor: { x: number; y: number } | null;
  setPopoverAnchor: (anchor: { x: number; y: number } | null) => void;

  // Tool actions
  setTool: (tool: StudioTool) => void;
  setBrushSize: (size: number) => void;

  // Zoom actions
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;

  // Image actions
  setImageLoaded: (loaded: boolean) => void;
  setImageSrc: (src: string) => void;

  // Canvas actions
  setFabricCanvas: (canvas: Canvas | null) => void;

  // History actions
  saveHistory: (obj: FabricObject) => void;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
  hasUnsavedChanges: () => boolean;
  hasMaskData: () => boolean;

  // Chapter data actions
  loadChapterData: (
    chapterSlug: string,
    initialPageSlug?: string,
  ) => Promise<void>;
  loadPageData: (chapterSlug: string, pageSlug: string) => Promise<void>;
  setCurrentPageIndex: (index: number) => void;

  // Inpaint actions
  exportMask: () => Promise<Blob>;
  inpaintPage: () => Promise<void>;

  // Export text patch
  exportTextPatch: (textbox: ExtendedTextbox) => string | null;

  // Create text object from region
  createTextObjectFromRegion: (regionObject: FabricObject) => void;

  // Merge & Save
  mergeAndSave: () => Promise<void>;

  // Utility
  reset: () => void;
}

/**
 * Studio Zustand store
 */
export const useStudioStore = create<StudioState>((set, get) => ({
  // Initial state
  tool: "none",
  brushSize: 20,
  zoom: ZOOM_DEFAULT,
  minZoom: ZOOM_MIN,
  maxZoom: ZOOM_MAX,
  imageLoaded: false,
  imageSrc: "",
  fabricCanvas: null,
  canvasHistory: [],
  redoStack: [],
  seriesData: null,
  chapterData: null,
  pages: [],
  currentPageIndex: 0,
  isLoadingChapter: false,
  polygonPoints: [],
  pageDataId: undefined,
  currentPageData: null,
  isInpainting: false,
  isProcessingOCR: false,
  selectedTextbox: null,
  popoverAnchor: null,

  // Tool actions
  setTool: (tool) => set({ tool }),

  setBrushSize: (size) => set({ brushSize: size }),

  // Zoom actions
  setZoom: (zoom) => {
    const { minZoom, maxZoom } = get();
    const clampedZoom = Math.max(minZoom, Math.min(maxZoom, zoom));
    set({ zoom: clampedZoom });
  },

  zoomIn: () => {
    const { zoom, maxZoom } = get();
    const newZoom = Math.min(zoom * 1.2, maxZoom);
    set({ zoom: newZoom });
  },

  zoomOut: () => {
    const { zoom, minZoom } = get();
    const newZoom = Math.max(zoom / 1.2, minZoom);
    set({ zoom: newZoom });
  },

  resetZoom: () => set({ zoom: 1 }),

  // Image actions
  setImageLoaded: (loaded) => set({ imageLoaded: loaded }),

  setImageSrc: (src) => set({ imageSrc: src }),

  // Canvas actions
  setFabricCanvas: (canvas) => set({ fabricCanvas: canvas }),

  // History actions (PanelPachi approach - store object references)
  saveHistory: (obj: FabricObject) => {
    const { canvasHistory, redoStack } = get();

    // Add object to history
    canvasHistory.push(obj);

    // Clear redo stack when new action is performed
    set({ canvasHistory, redoStack: [] });

    // Limit history size to 50
    if (canvasHistory.length > 50) {
      canvasHistory.shift();
      set({ canvasHistory });
    }
  },

  undo: () => {
    const { fabricCanvas, canvasHistory, redoStack } = get();
    if (!fabricCanvas || canvasHistory.length === 0) return;

    // Pop last object from history
    const obj = canvasHistory.pop();
    if (!obj) return;

    // Add to redo stack
    redoStack.push(obj);

    // Remove object from canvas
    fabricCanvas.remove(obj);
    fabricCanvas.renderAll();

    set({ canvasHistory, redoStack });
  },

  redo: () => {
    const { fabricCanvas, canvasHistory, redoStack } = get();
    if (!fabricCanvas || redoStack.length === 0) return;

    // Pop from redo stack
    const obj = redoStack.pop();
    if (!obj) return;

    // Add back to history and canvas
    canvasHistory.push(obj);
    fabricCanvas.add(obj);
    fabricCanvas.renderAll();

    set({ canvasHistory, redoStack });
  },

  clearHistory: () => {
    set({ canvasHistory: [], redoStack: [] });
  },

  hasUnsavedChanges: () => {
    const { canvasHistory } = get();
    return canvasHistory.length > 0;
  },

  hasMaskData: () => {
    const { currentPageData } = get();
    return currentPageData?.maskData != null;
  },

  // Chapter data actions
  loadChapterData: async (chapterSlug, initialPageSlug) => {
    set({ isLoadingChapter: true });

    const [error] = await catchError((async () => {
      // Fetch all studio data in one request
      const dataRes = await api.api.studio
        .data({ chapterSlug })
        .get({ query: { pageSlug: initialPageSlug } });

      if (!dataRes.data || !dataRes.data.success) {
        throw new Error(dataRes.data?.error || "Failed to load studio data");
      }

      const { series, chapter, pages, pageData } = dataRes.data;

      if (!series || !chapter) {
        throw new Error("Studio data incomplete");
      }

      // Find initial page index
      let initialPageIndex = 0;
      if (initialPageSlug && pages && pages.length > 0) {
        const foundIndex = pages.findIndex((p) => p.slug === initialPageSlug);
        if (foundIndex !== -1) {
          initialPageIndex = foundIndex;
        }
      }

      // Get the page to load
      const pageToLoad = pages?.[initialPageIndex];

      // Update store
      set({
        seriesData: series,
        chapterData: chapter,
        pages: pages || [],
        currentPageIndex: initialPageIndex,
        isLoadingChapter: false,
        pageDataId: pageData?.id,
        currentPageData: pageData || null,
      });

      // Load the correct page image
      if (pageToLoad) {
        set({ imageSrc: pageToLoad.originalImage });
      }

      // Note: Mask data is loaded in StudioCanvas after image loads
    })());

    if (error) {
      console.error("Failed to load studio data:", error);
      set({ isLoadingChapter: false });
    }
  },

  loadPageData: async (chapterSlug, pageSlug) => {
    const [error] = await catchError((async () => {
      // Fetch page data
      const dataRes = await api.api.studio
        .data({ chapterSlug })
        .get({ query: { pageSlug } });

      if (!dataRes.data || !dataRes.data.success) {
        throw new Error(dataRes.data?.error || "Failed to load page data");
      }

      const { pageData } = dataRes.data;

      // Update store - mask data will be loaded by StudioCanvas
      set({
        pageDataId: pageData?.id,
        currentPageData: pageData || null,
      });
    })());

    if (error) {
      console.error("Failed to reload page data:", error);
    }
  },

  setCurrentPageIndex: (index) => {
    const { pages } = get();
    if (index >= 0 && index < pages.length) {
      const page = pages[index];
      if (page) {
        set({
          currentPageIndex: index,
          imageSrc: page.originalImage,
          imageLoaded: false,
        });
      }
    }
  },

  // Polygon tool actions
  setPolygonPoints: (points) => set({ polygonPoints: points }),

  // Inpaint actions
  exportMask: async () => {
    const canvas = get().fabricCanvas;
    if (!canvas) throw new Error("Canvas not initialized");

    // Get canvas dimensions
    const canvasWidth = canvas.getWidth();
    const canvasHeight = canvas.getHeight();

    // Get the actual image dimensions from imageSrc
    const { imageSrc } = get();
    if (!imageSrc) throw new Error("No page image");

    // Load image to get natural dimensions
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = imageSrc;
    });

    // Create off-screen canvas at original image size
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = img.naturalWidth;
    maskCanvas.height = img.naturalHeight;
    const ctx = maskCanvas.getContext("2d")!;

    // Fill with black (preserve all)
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

    // Calculate scale factors from canvas to image
    const scaleX = maskCanvas.width / canvasWidth;
    const scaleY = maskCanvas.height / canvasHeight;

    // Draw brush paths as white
    ctx.strokeStyle = "white";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const objects = canvas.getObjects();
    for (const obj of objects) {
      if (!(obj instanceof Path)) {
        continue;
      }
      const path = obj;
      const pathData = path.path;

      // Use brush size from object or default
      ctx.lineWidth =
        (path.strokeWidth || get().brushSize) * Math.max(scaleX, scaleY);

      ctx.beginPath();
      for (const cmd of pathData) {
        const [type, ...coords] = cmd;
        const scaledCoords = coords.map((c: number, i: number) =>
          i % 2 === 0 ? c * scaleX : c * scaleY,
        );

        const [cpx, cpy, x, y] = scaledCoords;
        if (!cpx || !cpy || !x || !y) continue;

        if (type === "M") {
          ctx.moveTo(cpx, cpy);
        } else if (type === "Q") {
          ctx.quadraticCurveTo(cpx, cpy, x, y);
        } else if (type === "L") {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // Convert to blob
    return new Promise<Blob>((resolve, reject) => {
      maskCanvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to export mask"));
      }, "image/png");
    });
  },

  inpaintPage: async () => {
    const canvas = get().fabricCanvas;
    const { imageSrc, pages, currentPageIndex } = get();
    if (!canvas || !imageSrc) return;

    // Get current page
    const currentPage = pages[currentPageIndex];
    if (!currentPage) {
      alert("Current page not found");
      return;
    }

    set({ isInpainting: true });

    const [error] = await catchError((async () => {
      // Export mask
      const maskBlob = await get().exportMask();

      // Get page image blob
      const pageBlob = await fetch(imageSrc).then((r) => r.blob());

      // Convert blobs to base64
      const pageBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(pageBlob);
      });

      const maskBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(maskBlob);
      });

      // Call API via Eden Treaty (proxies to Unix socket)
      const response = await api.api.studio.inpaint.post({
        pageId: currentPage.id,
        pageImageBase64: pageBase64,
        maskImageBase64: maskBase64,
      });

      if (!response.data || !response.data.success) {
        throw new Error(response.data?.error || "Inpaint failed");
      }

      // Save non-brush objects (mask regions with data)
      const objects = canvas.getObjects();
      const regionsToPreserve = objects.filter(
        (obj) =>
          obj.type !== "path" && // Remove brush strokes
          obj.type !== "image" && // Remove old image (will be reloaded)
          (obj.type === "rect" ||
            obj.type === "ellipse" ||
            obj.type === "polygon" ||
            obj.type === "textbox"),
      );

      // Clear canvas
      canvas.clear();
      canvas.backgroundColor = "#1f2937";

      // Clear history and mask data
      get().clearHistory();
      set({ currentPageData: null });

      // Reload page image with cache-busting parameter
      const timestamp = Date.now();
      const newImageSrc = `${currentPage.originalImage}?t=${timestamp}`;
      set({ imageSrc: newImageSrc, imageLoaded: false });

      // Force reload and restore regions
      setTimeout(() => {
        set({ imageLoaded: true });

        // Re-add preserved regions after image loads
        setTimeout(() => {
          regionsToPreserve.forEach((obj) => canvas.add(obj));
          canvas.renderAll();
        }, 50);
      }, 100);
    })());

    if (error) {
      console.error("❌ Inpaint error:", error);
      alert(
        `Inpainting failed: ${error.message}`,
      );
    }

    set({ isInpainting: false });
  },

  // OCR + Text Patch actions

  exportTextPatch: (textbox) => {
    const canvas = get().fabricCanvas;
    if (!canvas) return null;

    const bounds = textbox.getBoundingRect();

    const offCanvas = document.createElement("canvas");
    offCanvas.width = bounds.width;
    offCanvas.height = bounds.height;
    const ctx = offCanvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, offCanvas.width, offCanvas.height);

    const originalLeft = textbox.left || 0;
    const originalTop = textbox.top || 0;

    textbox.set({ left: 0, top: 0 });
    textbox.render(ctx);
    textbox.set({ left: originalLeft, top: originalTop });

    return offCanvas.toDataURL("image/png");
  },

  /**
   * Sync text overlays for all mask regions with translatedText
   *
   * Creates Textbox objects on top of mask regions that have translated text.
   * Uses PanelPachi's approach: smart font sizing and text wrapping.
   */
  // Text Object Popover actions
  setSelectedTextbox: (textbox) => set({ selectedTextbox: textbox }),
  setPopoverAnchor: (anchor) => set({ popoverAnchor: anchor }),

  /**
   * Create text object from a region mask
   * Creates text overlay and removes the mask region
   */
  createTextObjectFromRegion: (regionObject) => {
    const canvas = get().fabricCanvas;
    if (!canvas) return;

    const mask = regionObject as ExtendedRect | ExtendedEllipse | ExtendedPolygon;
    const maskId = mask.id;
    const translatedText = mask.data?.translatedText;

    // Validate
    if (!mask.data || mask.data.type !== "mask" || !translatedText || !maskId) {
      return;
    }

    // Set default font size if not set
    if (!mask.data.customFontSize) {
      mask.data.customFontSize = 16;
    }

    // Get mask bounds
    const bounds = regionObject.getBoundingRect();

    // Calculate font size using PanelPachi's algorithm
    let fontSize: number;
    if (mask.data.customFontSize) {
      fontSize = mask.data.customFontSize;
    } else {
      const minSize = 10;
      const basedOnWidth = bounds.width * 0.05;
      const maxByWidth = bounds.width * 0.2;
      const maxByHeight = bounds.height * 0.2;
      fontSize = Math.min(
        Math.max(minSize, basedOnWidth),
        Math.min(maxByWidth, maxByHeight),
      );
    }

    // Create textbox
    const textbox = new Textbox(translatedText, {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      fontSize,
      fontFamily: "Anime Ace",
      fontWeight: "normal",
      fontStyle: "normal",
      fill: "#000000",
      stroke: "#FFFFFF",
      strokeWidth: 0,
      textAlign: "center",
      originX: "left",
      originY: "top",
      selectable: true,
      hasControls: true,
      evented: true,
      splitByGrapheme: true,
      lockScalingY: false,
      lockScalingFlip: false,
    }) as ExtendedTextbox;

    // Assign unique ID
    textbox.id = `textbox-${maskId}`;

    // Store patch data with ratios
    const canvasWidth = canvas.getWidth();
    const canvasHeight = canvas.getHeight();
    const patchData: TextPatchData = {
      type: "text-patch",
      captionSlug: mask.data.captionSlug,
      maskId,
      originalText: mask.data.originalText,
      leftRatio: bounds.left / canvasWidth,
      topRatio: bounds.top / canvasHeight,
      widthRatio: bounds.width / canvasWidth,
      fontSizeRatio: fontSize / canvasWidth,
    };
    textbox.data = patchData;

    // Add textbox and remove mask
    canvas.add(textbox);
    canvas.remove(regionObject);
    canvas.renderAll();
  },

  /**
   * Merge all textboxes onto image and save as new page image
   *
   * Workflow:
   * 1. Export canvas with all textboxes merged
   * 2. Upload to replace page's originalImage
   * 3. Remove all textboxes from canvas
   * 4. Reload page
   */
  mergeAndSave: async () => {
    const canvas = get().fabricCanvas;
    const pages = get().pages;
    const currentPageIndex = get().currentPageIndex;
    const currentPage = pages[currentPageIndex];

    if (!canvas || !currentPage) {
      throw new Error("Canvas or page not ready");
    }

    const [error] = await catchError((async () => {
      // Get background image
      const objects = canvas.getObjects();
      const bgImage = objects.find((o) => o.type === "image");
      if (!bgImage || !(bgImage instanceof FabricImage)) {
        throw new Error("Background image not found");
      }

      const img = bgImage._element || bgImage._originalElement;
      if (!img) {
        throw new Error("Image element not found");
      }

      const imageWidth =
        "naturalWidth" in img && typeof img.naturalWidth === "number"
          ? img.naturalWidth
          : img.width;
      const imageHeight =
        "naturalHeight" in img && typeof img.naturalHeight === "number"
          ? img.naturalHeight
          : img.height;

      // Create off-screen canvas for merging
      const offCanvas = document.createElement("canvas");
      offCanvas.width = imageWidth;
      offCanvas.height = imageHeight;
      const ctx = offCanvas.getContext("2d");
      if (!ctx) {
        throw new Error("Failed to get canvas context");
      }

      // Draw background image
      ctx.drawImage(img, 0, 0, imageWidth, imageHeight);

      // Find all textboxes and draw them onto the image
      for (const obj of objects) {
        if (obj.type !== "textbox") continue;
        const textbox = obj as ExtendedTextbox;

        // Get textbox properties
        const left = textbox.left || 0;
        const top = textbox.top || 0;
        const text = textbox.text || "";
        const fontSize = textbox.fontSize || 16;
        const fontFamily = textbox.fontFamily || "Anime Ace";
        const fontWeight = textbox.fontWeight || "normal";
        const fontStyle = textbox.fontStyle || "normal";
        const fill = (textbox.fill as string) || "#000000";
        const stroke = textbox.stroke as string | undefined;
        const strokeWidth = textbox.strokeWidth || 0;
        const width = textbox.width || 100;

        // Set font
        ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        // Split text into lines (Fabric wraps text, we need to do the same)
        const lines = text.split("\n");
        const lineHeight = fontSize * 1.16; // Fabric's default line height

        // Draw each line
        lines.forEach((line, index) => {
          const y = top + index * lineHeight;
          const x = left + width / 2; // Center horizontally

          // Draw stroke if enabled
          if (strokeWidth > 0 && stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = strokeWidth;
            ctx.strokeText(line, x, y);
          }

          // Draw fill
          ctx.fillStyle = fill;
          ctx.fillText(line, x, y);
        });
      }

      // Export merged image as base64
      const mergedImageBase64 = offCanvas.toDataURL("image/png");

      // Upload to server to replace page image
      const response = await api.api.studio
        .pages({ pageId: currentPage.id })
        ["merge-textboxes"].post({
          mergedImage: mergedImageBase64,
        });

      if (!response.data || !response.data.success) {
        throw new Error(response.data?.error || "Failed to save merged image");
      }

      // Get the new image path from response
      const newImagePath = response.data.imagePath;
      if (!newImagePath) {
        throw new Error("No image path returned from server");
      }

      // Add cache-busting timestamp to force browser reload
      const timestamp = Date.now();
      const imagePathWithCacheBuster = `${newImagePath}?t=${timestamp}`;

      // Update the page in the pages array with new image path
      const updatedPages = [...pages];
      updatedPages[currentPageIndex] = {
        ...currentPage,
        originalImage: imagePathWithCacheBuster,
      };

      set({ pages: updatedPages });

      // Remove all textboxes from canvas
      const textboxes = objects.filter((o) => o.type === "textbox");
      textboxes.forEach((tb) => canvas.remove(tb));

      // Clear history
      get().clearHistory();

      // Force image reload using setCurrentPageIndex
      // This will set imageSrc and imageLoaded: false, triggering proper reload
      get().setCurrentPageIndex(currentPageIndex);

      canvas.renderAll();
    })());

    if (error) {
      console.error("Merge and save failed:", error);
      throw error;
    }
  },

  // Utility
  reset: () =>
    set({
      tool: "none",
      brushSize: 20,
      zoom: ZOOM_DEFAULT,
      imageLoaded: false,
      imageSrc: "",
      fabricCanvas: null,
      canvasHistory: [],
      redoStack: [],
      seriesData: null,
      chapterData: null,
      pages: [],
      currentPageIndex: 0,
      isLoadingChapter: false,
      polygonPoints: [],
      isProcessingOCR: false,
    }),
}));
