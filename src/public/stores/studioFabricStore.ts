import { create } from "zustand";
import type { Canvas, FabricObject } from "fabric";
import { api } from "../lib/api";
import type { Chapter, Page, Series, PageData } from "../../db/schema";
import type { StudioTool } from "../components/studio2/types";
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_DEFAULT,
} from "../components/studio2/types";

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
  loadChapterData: (chapterSlug: string, initialPageSlug?: string) => Promise<void>;
  loadPageData: (chapterSlug: string, pageSlug: string) => Promise<void>;
  setCurrentPageIndex: (index: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  goToPage: (pageSlug: string) => void;

  // Inpaint actions
  exportMask: () => Promise<Blob>;
  inpaintPage: () => Promise<void>;

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
      if (obj.type === "path") {
        const path = obj as any; // Fabric.Path type
        const pathData = path.path;

        // Use brush size from object or default
        ctx.lineWidth = (path.strokeWidth || get().brushSize) * Math.max(scaleX, scaleY);

        ctx.beginPath();
        for (const cmd of pathData) {
          const [type, ...coords] = cmd;
          const scaledCoords = coords.map((c: number, i: number) =>
            i % 2 === 0 ? c * scaleX : c * scaleY
          );

          if (type === "M") {
            ctx.moveTo(scaledCoords[0], scaledCoords[1]);
          } else if (type === "Q") {
            ctx.quadraticCurveTo(
              scaledCoords[0],
              scaledCoords[1],
              scaledCoords[2],
              scaledCoords[3]
            );
          } else if (type === "L") {
            ctx.lineTo(scaledCoords[0], scaledCoords[1]);
          }
        }
        ctx.stroke();
      }
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
      alert(`Inpainting failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      set({ isInpainting: false });
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
    }),
}));
