import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { StudioToolPanel } from "../../components/studio/StudioToolPanel";
import { StudioCanvas } from "../../components/studio/StudioCanvas";
import { StudioSidebar } from "../../components/studio/StudioSidebar";
import { useCanvasZoom } from "../../hooks/useCanvasZoom";
import { useSnackbar } from "../../hooks/useSnackbar";
import { api } from "../../lib/api";
import { catchError } from "../../../lib/error-handler";
import { getRegionBounds, getRegionPolygonPoints } from "../../../lib/region-types";
import type { DrawingToolType } from "../../hooks/useDrawingTool";

interface Point {
  x: number;
  y: number;
}

interface CaptionRect {
  id: string;
  captionId?: number;
  captionSlug?: string;
  shape: "rectangle" | "polygon" | "oval";
  x: number;
  y: number;
  width: number;
  height: number;
  polygonPoints?: Point[];
  capturedImage?: string;
  rawText?: string;
  translatedText?: string;
  patchImagePath?: string;
  patchGeneratedAt?: Date;
}

interface PageInfo {
  id: number;
  slug?: string | null;
  orderNum: number;
  originalImage: string;
}

/**
 * StudioPage — Full-page canvas editor with 3-column layout.
 *
 * Route: /studio/:chapterSlug#pageSlug
 *
 * Loads chapter data + all pages. Manages captions state, drawing tool,
 * zoom, and page navigation. All actions auto-save to DB.
 */
export function StudioPage() {
  const { chapterSlug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { showSnackbar, SnackbarComponent } = useSnackbar();
  const containerRef = useRef<HTMLDivElement>(null);

  // Chapter / series metadata
  const [chapterTitle, setChapterTitle] = useState("");
  const [seriesSlug, setSeriesSlug] = useState("");

  // Pages
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  // Image source (cache-busted for reloads after merge)
  const [imageSrc, setImageSrc] = useState("");

  // Captions
  const [captions, setCaptions] = useState<CaptionRect[]>([]);
  const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(
    null,
  );

  // Tools
  const [drawingTool, setDrawingTool] = useState<DrawingToolType>("none");
  const [isPatching, setIsPatching] = useState(false);

  // Zoom
  const { zoom, zoomIn, zoomOut, fitToContainer } = useCanvasZoom();

  // Current page shorthand
  const currentPage: PageInfo | undefined = pages[currentPageIndex];

  // ─── Load chapter + pages on mount ──────────────────
  useEffect(() => {
    if (!chapterSlug) return;
    loadChapterData();
  }, [chapterSlug]);

  const loadChapterData = async () => {
    setLoading(true);

    // Load chapter metadata
    const [chapterError, chapterResult] = await catchError(
      api.api.chapters({ slug: chapterSlug! }).get(),
    );
    if (chapterError || !chapterResult.data?.success || !chapterResult.data.chapter) {
      showSnackbar("Failed to load chapter", "error");
      setLoading(false);
      return;
    }

    const chapter = chapterResult.data.chapter;
    setChapterTitle(chapter.title);

    // Derive series slug from chapter's seriesId
    const derivedSeriesSlug = `s${String(chapter.seriesId).padStart(5, "0")}`;
    setSeriesSlug(derivedSeriesSlug);

    // Load all pages for the chapter
    const [pagesError, pagesResult] = await catchError(
      api.api.chapters({ slug: chapterSlug! }).pages.get(),
    );
    if (pagesError || !pagesResult.data?.success || !pagesResult.data.pages) {
      showSnackbar("Failed to load pages", "error");
      setLoading(false);
      return;
    }

    const allPages = pagesResult.data.pages as PageInfo[];
    setPages(allPages);

    // Resolve initial page from location hash
    const hashSlug = location.hash.replace("#", "");
    let startIndex = 0;
    if (hashSlug) {
      const idx = allPages.findIndex((p) => p.slug === hashSlug);
      if (idx !== -1) startIndex = idx;
    }

    setCurrentPageIndex(startIndex);
    const startPage = allPages[startIndex];
    if (startPage) {
      setImageSrc(`${startPage.originalImage}?t=${Date.now()}`);
    }

    setLoading(false);
  };

  // ─── Load captions when page changes ───────────────
  useEffect(() => {
    if (!currentPage) return;
    loadCaptions(currentPage.id);
    // Update image source
    const baseUrl = currentPage.originalImage.split("?")[0];
    setImageSrc(`${baseUrl}?t=${Date.now()}`);
  }, [currentPageIndex, pages]);

  const loadCaptions = async (pageId: number, preserveSelection = false) => {
    const [error, result] = await catchError(
      api.api.studio.captions.get({ query: { pageId } }),
    );
    if (error || !result.data?.success) {
      setCaptions([]);
      return;
    }

    const loaded = result.data.captions.map((c) => {
      const bounds = getRegionBounds(c.region);
      return {
        id: `caption-${c.id}`,
        captionId: c.id,
        captionSlug: c.slug ?? undefined,
        shape: c.region.shape,
        ...bounds,
        polygonPoints: getRegionPolygonPoints(c.region),
        capturedImage: c.capturedImage ?? undefined,
        rawText: c.rawText ?? undefined,
        translatedText: c.translatedText ?? undefined,
        patchImagePath: c.patchImagePath ?? undefined,
        patchGeneratedAt: c.patchGeneratedAt
          ? new Date(c.patchGeneratedAt as unknown as string)
          : undefined,
      };
    });
    setCaptions(loaded);
    if (!preserveSelection) {
      setSelectedCaptionId(null);
    }
  };

  // ─── Caption callbacks ─────────────────────────────
  const handleCaptionCreated = useCallback((caption: CaptionRect) => {
    setCaptions((prev) => [...prev, caption]);
    setSelectedCaptionId(caption.id);
  }, []);

  const handleSelectCaption = useCallback((id: string | null) => {
    setSelectedCaptionId(id);
  }, []);

  const handleDeleteCaption = useCallback((id: string) => {
    setCaptions((prev) => prev.filter((c) => c.id !== id));
    setSelectedCaptionId(null);
    showSnackbar("Region deleted", "success");
  }, []);

  const handleCaptionUpdated = useCallback(() => {
    // Reload captions from DB to get fresh data, keep current selection
    if (currentPage) {
      loadCaptions(currentPage.id, true);
    }
  }, [currentPage]);

  // ─── Merge Down ────────────────────────────────────
  const hasPatchesAvailable = captions.some((c) => c.patchImagePath);

  const handleMerge = async () => {
    if (!currentPage?.slug) return;
    setIsPatching(true);

    const [error, result] = await catchError(
      api.api.studio.merge.patch({ pageSlug: currentPage.slug }),
    );

    setIsPatching(false);

    if (error || !result.data?.success) {
      showSnackbar("Merge failed", "error");
      return;
    }

    showSnackbar(result.data.message || "Patches merged", "success");

    // Reload image + clear captions
    const baseUrl = currentPage.originalImage.split("?")[0];
    setImageSrc(`${baseUrl}?t=${Date.now()}`);
    setCaptions([]);
    setSelectedCaptionId(null);
  };

  // ─── Fit to container ──────────────────────────────
  const handleFit = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    // We need the natural image size — approximate from first page if available
    const img = new Image();
    img.onload = () => {
      fitToContainer(rect.width, rect.height, img.naturalWidth, img.naturalHeight);
    };
    if (imageSrc) {
      img.src = imageSrc;
    }
  }, [imageSrc, fitToContainer]);

  // ─── Page jumping ──────────────────────────────────
  const handlePageJump = useCallback(
    (index: number) => {
      if (index < 0 || index >= pages.length) return;
      setCurrentPageIndex(index);
      setSelectedCaptionId(null);
      const page = pages[index];
      if (page?.slug) {
        window.location.hash = page.slug;
      }
    },
    [pages],
  );

  // ─── Notification wrapper ──────────────────────────
  const handleNotification = useCallback(
    (msg: string, type: "success" | "error" | "info") => {
      showSnackbar(msg, type);
    },
    [showSnackbar],
  );

  // ─── Exit handler ─────────────────────────────────
  const handleExit = () => {
    if (seriesSlug && chapterSlug && currentPage) {
      navigate(`/r/${seriesSlug}/${chapterSlug}/${currentPage.orderNum}`);
    } else {
      navigate(-1);
    }
  };

  // ─── Selected caption object ───────────────────────
  const selectedCaption =
    selectedCaptionId !== null
      ? captions.find((c) => c.id === selectedCaptionId) ?? null
      : null;

  // ─── Loading state ─────────────────────────────────
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-900">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white" />
          <p className="text-white text-lg">Loading Studio...</p>
        </div>
      </div>
    );
  }

  if (!currentPage) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-900">
        <p className="text-white text-lg">No pages found.</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {SnackbarComponent}

      {/* ─── Header ─── */}
      <div className="h-12 bg-gray-900 text-white flex items-center px-4 gap-4 flex-shrink-0">
        <span className="font-bold text-lg">Studio</span>
        <span className="text-gray-400">—</span>
        <span className="text-gray-300 truncate flex-1">{chapterTitle}</span>
        <span className="text-gray-400 text-sm">
          Page {currentPage.orderNum} / {pages.length}
        </span>
        <button
          onClick={handleExit}
          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold rounded transition-colors"
        >
          Exit
        </button>
      </div>

      {/* ─── 3-Column Layout ─── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Tool Panel */}
        <StudioToolPanel
          drawingTool={drawingTool}
          onDrawingToolChange={setDrawingTool}
          zoom={zoom}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onFit={handleFit}
          selectedCaption={selectedCaption}
          hasPatchesAvailable={hasPatchesAvailable}
          isPatching={isPatching}
          onMerge={handleMerge}
          onDeleteCaption={handleDeleteCaption}
          onCaptionUpdated={handleCaptionUpdated}
          onNotification={handleNotification}
        />

        {/* Center: Canvas */}
        <div ref={containerRef} className="flex-1 flex overflow-hidden">
          <StudioCanvas
            pageId={currentPage.id}
            imageSrc={imageSrc}
            captions={captions}
            selectedCaptionId={selectedCaptionId}
            drawingTool={drawingTool}
            zoom={zoom}
            onCaptionCreated={handleCaptionCreated}
            onSelectCaption={handleSelectCaption}
            onNotification={handleNotification}
          />
        </div>

        {/* Right: Sidebar */}
        <StudioSidebar
          captions={captions}
          selectedCaptionId={selectedCaptionId}
          onSelectCaption={(id) => handleSelectCaption(id)}
          pages={pages}
          currentPageIndex={currentPageIndex}
          onPageJump={handlePageJump}
        />
      </div>
    </div>
  );
}
