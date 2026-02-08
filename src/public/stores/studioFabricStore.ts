import { create } from "zustand";
import {
  FabricImage,
  Path,
  Textbox,
  type Canvas,
  type FabricObject,
} from "fabric";
import { api } from "../lib/api";
import type { Chapter, Page, Series, PageData } from "../../db/schema";
import type { StudioTool } from "../components/studio2/types";
import { ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT } from "../components/studio2/types";
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
  canUndo: () => boolean;
  canRedo: () => boolean;
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
  nextPage: () => void;
  prevPage: () => void;
  goToPage: (pageSlug: string) => void;

  // Inpaint actions
  exportMask: () => Promise<Blob>;
  inpaintPage: () => Promise<void>;

  // OCR + Text Patch actions
  cropRegion: (region: Region) => Promise<string | null>;
  createTextPatch: (config: {
    text: string;
    bounds: BoundingBox;
    captionSlug?: string;
    fontFamily?: string;
    fontWeight?: FontWeight;
    fontStyle?: FontStyle;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
  }) => void;
  exportTextPatch: (textbox: ExtendedTextbox) => string | null;
  savePatch: (captionSlug: string, textbox: ExtendedTextbox) => Promise<void>;
  syncTextOverlays: () => void;

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

  canUndo: () => {
    const { canvasHistory } = get();
    return canvasHistory.length > 0;
  },

  canRedo: () => {
    const { redoStack } = get();
    return redoStack.length > 0;
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

    try {
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
    } catch (error) {
      console.error("Failed to load studio data:", error);
      set({ isLoadingChapter: false });
    }
  },

  loadPageData: async (chapterSlug, pageSlug) => {
    try {
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
    } catch (error) {
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

  nextPage: () => {
    const { currentPageIndex, pages } = get();
    if (currentPageIndex < pages.length - 1) {
      get().setCurrentPageIndex(currentPageIndex + 1);
    }
  },

  prevPage: () => {
    const { currentPageIndex } = get();
    if (currentPageIndex > 0) {
      get().setCurrentPageIndex(currentPageIndex - 1);
    }
  },

  goToPage: (pageSlug) => {
    const { pages } = get();
    const index = pages.findIndex((p) => p.slug === pageSlug);
    if (index !== -1) {
      get().setCurrentPageIndex(index);
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

    try {
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

      // Force reload
      setTimeout(() => {
        set({ imageLoaded: true });
      }, 100);
    } catch (error) {
      console.error("❌ Inpaint error:", error);
      alert(
        `Inpainting failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      set({ isInpainting: false });
    }
  },

  // OCR + Text Patch actions
  cropRegion: async (region) => {
    const canvas = get().fabricCanvas;
    if (!canvas) return null;

    const bounds = getRegionBounds(region);

    // Get background image from canvas objects (not backgroundImage property)
    const objects = canvas.getObjects();
    const bgImage = objects.find((o) => o.type === "image");
    if (!bgImage || !(bgImage instanceof FabricImage)) return null;

    const img = bgImage;
    if (!img._element) return null;

    // Create off-screen canvas at region size
    const offCanvas = document.createElement("canvas");
    offCanvas.width = bounds.width;
    offCanvas.height = bounds.height;
    const ctx = offCanvas.getContext("2d");
    if (!ctx) return null;

    // Handle different region shapes
    if (region.shape === "rectangle") {
      // Simple crop
      ctx.drawImage(
        img._element,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height,
      );
    } else if (region.shape === "oval") {
      // Elliptical clipping
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(
        bounds.width / 2,
        bounds.height / 2,
        bounds.width / 2,
        bounds.height / 2,
        0,
        0,
        2 * Math.PI,
      );
      ctx.clip();
      ctx.drawImage(
        img._element,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height,
      );
      ctx.restore();
    } else if (region.shape === "polygon") {
      // Polygon clipping
      const points = getRegionPolygonPoints(region);
      if (!points) return null;

      const localPoints = points.map((p) => ({
        x: p.x - bounds.x,
        y: p.y - bounds.y,
      }));

      ctx.save();
      ctx.beginPath();
      if (localPoints.length > 0) {
        const first = localPoints[0];
        if (first) {
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i < localPoints.length; i++) {
            const pt = localPoints[i];
            if (pt) {
              ctx.lineTo(pt.x, pt.y);
            }
          }
          ctx.closePath();
        }
      }
      ctx.clip();
      ctx.drawImage(
        img._element,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height,
      );
      ctx.restore();
    }

    return offCanvas.toDataURL("image/png");
  },

  createTextPatch: (config) => {
    const canvas = get().fabricCanvas;
    if (!canvas) return;

    const {
      text,
      bounds,
      captionSlug,
      fontFamily = "Anime Ace",
      fontWeight = "normal",
      fontStyle = "normal",
      fill = "#000000",
      stroke = "#FFFFFF",
      strokeWidth = 0,
    } = config;

    const canvasWidth = canvas.getWidth();
    const canvasHeight = canvas.getHeight();

    const fontSize = bounds.height * 0.8;
    const fontSizeRatio = fontSize / canvasWidth;

    const textbox = new Textbox(text, {
      left: bounds.x,
      top: bounds.y,
      width: bounds.width,
      fontSize,
      fontFamily,
      fontWeight,
      fontStyle,
      fill,
      stroke,
      strokeWidth,
      textAlign: "center",
      selectable: true,
      evented: true,
    }) as ExtendedTextbox;

    // Assign unique ID
    textbox.id = `textbox-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Store caption slug and ratio-based positioning data
    const patchData: TextPatchData = {
      type: "text-patch",
      captionSlug,
      leftRatio: bounds.x / canvasWidth,
      topRatio: bounds.y / canvasHeight,
      widthRatio: bounds.width / canvasWidth,
      fontSizeRatio,
    };
    textbox.data = patchData;

    canvas.add(textbox);
    canvas.setActiveObject(textbox);
    canvas.renderAll();

    // Save to history
    get().saveHistory(textbox);
  },

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

  savePatch: async (captionSlug, textbox) => {
    const canvas = get().fabricCanvas;
    if (!canvas) return;

    const patchImage = get().exportTextPatch(textbox);
    if (!patchImage) return;

    const canvasWidth = canvas.getWidth();
    const canvasHeight = canvas.getHeight();
    const data = textbox.data;

    const patchData = {
      text: textbox.text || "",
      leftRatio: data?.leftRatio ?? (textbox.left || 0) / canvasWidth,
      topRatio: data?.topRatio ?? (textbox.top || 0) / canvasHeight,
      widthRatio: data?.widthRatio ?? (textbox.width || 100) / canvasWidth,
      fontSizeRatio:
        data?.fontSizeRatio ?? (textbox.fontSize || 16) / canvasWidth,
      fontFamily: textbox.fontFamily || "Arial",
      fontWeight: String(textbox.fontWeight || "normal"),
      fontStyle: String(textbox.fontStyle || "normal"),
      fill: (textbox.fill as string) || "#000000",
      stroke: textbox.stroke as string | undefined,
      strokeWidth: textbox.strokeWidth,
    };

    const response = await api.api.studio.patches.save.post({
      captionSlug,
      patchImage,
      patchData,
    });

    if (!response.data || !response.data.success) {
      throw new Error(response.data?.error || "Failed to save patch");
    }
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

  syncTextOverlays: () => {
    const canvas = get().fabricCanvas;
    if (!canvas) return;

    const objects = canvas.getObjects();

    // Find all existing textboxes with mask IDs to avoid duplicates
    const existingTextboxes = new Set<string>();
    for (const obj of objects) {
      if (obj.type !== "textbox") {
        continue;
      }
      const textbox = obj as ExtendedTextbox;
      const maskId = textbox.data?.maskId;
      if (maskId) {
        existingTextboxes.add(maskId);
      }
    }

    // Find all mask objects with translated text
    for (const obj of objects) {
      if (
        obj.type !== "rect" &&
        obj.type !== "ellipse" &&
        obj.type !== "polygon"
      ) {
        continue;
      }
      const mask = obj as ExtendedRect | ExtendedEllipse | ExtendedPolygon;
      const maskId = mask.id;
      const translatedText = mask.data?.translatedText;

      // Skip if no translated text or textbox already exists
      if (!translatedText || !maskId || existingTextboxes.has(maskId)) {
        continue;
      }

      // Get mask bounds
      const bounds = obj.getBoundingRect();

      // Use custom font size if provided, otherwise calculate using PanelPachi's algorithm
      let fontSize: number;
      if (mask.data?.customFontSize) {
        fontSize = mask.data.customFontSize;
      } else {
        // fontSize = min(max(10, width * 0.05), min(width * 0.2, height * 0.2))
        const minSize = 10;
        const basedOnWidth = bounds.width * 0.05;
        const maxByWidth = bounds.width * 0.2;
        const maxByHeight = bounds.height * 0.2;
        fontSize = Math.min(
          Math.max(minSize, basedOnWidth),
          Math.min(maxByWidth, maxByHeight),
        );
      }

      // Create textbox with proper defaults
      const textbox = new Textbox(translatedText, {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        fontSize,
        fontFamily: "Anime Ace",
        fontWeight: "normal",
        fontStyle: "normal",
        fill: "#000000",
        stroke: "#FFFFFF", // White stroke (when enabled)
        strokeWidth: 0, // No stroke by default
        textAlign: "center",
        originX: "left",
        originY: "top",
        selectable: true,
        hasControls: true,
        evented: true,
        splitByGrapheme: true, // Better text wrapping
        lockScalingY: false, // Allow vertical scaling
        lockScalingFlip: false, // Allow flipping
      }) as ExtendedTextbox;

      // Assign unique ID
      textbox.id = `textbox-${maskId}`;

      // Store mask ID reference and ratio-based positioning
      const canvasWidth = canvas.getWidth();
      const canvasHeight = canvas.getHeight();
      const patchData: TextPatchData = {
        type: "text-patch",
        captionSlug: mask.data?.captionSlug,
        maskId, // Link to parent mask
        originalText: mask.data?.originalText, // Preserve original text even after mask removed
        leftRatio: bounds.left / canvasWidth,
        topRatio: bounds.top / canvasHeight,
        widthRatio: bounds.width / canvasWidth,
        fontSizeRatio: fontSize / canvasWidth,
      };
      textbox.data = patchData;

      // Add to canvas
      canvas.add(textbox);

      // Add to existing textboxes set
      existingTextboxes.add(maskId);
    }

    canvas.renderAll();
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
