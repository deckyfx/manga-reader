import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Maximize, Minimize, MoveHorizontal, MoveVertical, Scan } from "lucide-react";
import { getChapter, readPageImageUrl, type ReadPage } from "../api";
import { clearProgress, saveProgress } from "../lib/read-progress";

type FitMode = "height" | "width" | "original";

const FIT_KEY = "read-fit-mode";

function readFitMode(): FitMode {
  try {
    const saved = localStorage.getItem(FIT_KEY);
    return saved === "width" || saved === "original" ? saved : "height";
  } catch {
    return "height";
  }
}

const FIT_CLASS: Record<FitMode, string> = {
  height: "max-h-full max-w-full object-contain",
  width: "w-full h-auto object-contain",
  original: "max-w-none",
};

/**
 * The reader: one page at a time, right to left by default (the volume decides). Click the sides or use the arrow
 * keys to turn pages; neighbouring pages are preloaded, and the chapter's last page steps into the next chapter.
 */
export function ReaderPage() {
  const { id = "", n = "1" } = useParams();
  const chapterId = Number(id);
  // A fractional or junk `n` from the URL would index the page array with a fraction and read as "page missing"
  const requested = Number(n);
  const pageNumber = Number.isInteger(requested) && requested >= 1 ? requested : 1;
  const navigate = useNavigate();

  const chapterQ = useQuery({ queryKey: ["chapter", chapterId], queryFn: () => getChapter(chapterId), enabled: Number.isFinite(chapterId) });

  const [fit, setFitState] = useState<FitMode>(readFitMode);
  const setFit = (mode: FitMode) => {
    setFitState(mode);
    try {
      localStorage.setItem(FIT_KEY, mode);
    } catch {
      // Not persisted; the choice still applies for this visit
    }
  };
  const [immersive, setImmersive] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);

  const pages = chapterQ.data?.pages ?? [];
  const rtl = (chapterQ.data?.series.reading_direction ?? "rtl") === "rtl";
  const page: ReadPage | undefined = pages[pageNumber - 1];
  // Chapters of the series in order, so the ends of this one step into its neighbours (skipping empty ones)
  const chapters = useMemo(
    () => [...(chapterQ.data?.siblings ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
    [chapterQ.data],
  );
  const chapterIndex = chapters.findIndex((c) => c.id === chapterId);
  const nextChapter = chapterIndex >= 0 ? chapters.slice(chapterIndex + 1).find((c) => c.pages > 0) : undefined;
  const previousChapter = chapterIndex > 0 ? [...chapters.slice(0, chapterIndex)].reverse().find((c) => c.pages > 0) : undefined;

  useEffect(() => {
    if (!page) return;
    // The last page means the chapter is finished: forget it, so the next visit starts at the beginning
    if (pageNumber === pages.length) clearProgress(chapterId);
    else saveProgress(chapterId, pageNumber);
  }, [chapterId, pageNumber, page, pages.length]);

  // Neighbouring pages are fetched ahead, so turning the page is instant
  useEffect(() => {
    for (const neighbour of [pages[pageNumber], pages[pageNumber - 2]]) {
      if (!neighbour) continue;
      const img = new Image();
      img.src = readPageImageUrl(neighbour.id, `${neighbour.revision}-${neighbour.updated_at}`);
    }
  }, [pages, pageNumber]);

  const goToPage = useCallback((target: number) => {
    navigate(`/read/chapters/${chapterId}/pages/${target}`, { replace: true });
  }, [chapterId, navigate]);

  /** Next in reading order: the following page, or the first page of the next chapter. */
  const next = useCallback(() => {
    if (pageNumber < pages.length) goToPage(pageNumber + 1);
    else if (nextChapter) navigate(`/read/chapters/${nextChapter.id}/pages/1`);  // a new chapter starts at its first page
  }, [pageNumber, pages.length, goToPage, nextChapter, navigate]);

  const previous = useCallback(() => {
    if (pageNumber > 1) goToPage(pageNumber - 1);
    else if (previousChapter) navigate(`/read/chapters/${previousChapter.id}/pages/${previousChapter.pages}`);
  }, [pageNumber, goToPage, previousChapter, navigate]);

  // Arrow keys follow the reading direction; space pages forward, Home / End jump to the ends
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const forward = rtl ? "ArrowLeft" : "ArrowRight";
      const backward = rtl ? "ArrowRight" : "ArrowLeft";
      if (e.key === forward || e.key === "ArrowDown" || e.key === "PageDown" || (e.key === " " && !e.shiftKey)) {
        e.preventDefault();
        next();
      } else if (e.key === backward || e.key === "ArrowUp" || e.key === "PageUp" || (e.key === " " && e.shiftKey)) {
        e.preventDefault();
        previous();
      } else if (e.key === "Home") goToPage(1);
      else if (e.key === "End" && pages.length > 0) goToPage(pages.length);
      else if (e.key === "f") void toggleImmersive();
      else if (e.key === "Escape" && document.fullscreenElement) void document.exitFullscreen();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, previous, goToPage, pages.length, rtl]);

  useEffect(() => {
    const onChange = () => setImmersive(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleImmersive = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await frameRef.current?.requestFullscreen();
    } catch {
      // Fullscreen can be refused (permissions, iframe): reading still works in the page
    }
  };

  if (chapterQ.isLoading) return <Loader2 className="m-4 animate-spin text-gray-500" />;
  if (!chapterQ.data) return <p className="m-4 text-sm text-red-400">{chapterQ.error?.message ?? "Chapter not found"}</p>;
  if (pages.length === 0) {
    return (
      <div className="p-4 space-y-3">
        <Link to={`/read/series/${chapterQ.data?.series.id ?? ""}`} className="text-sm text-indigo-300 hover:text-indigo-200">← Back to the series</Link>
        <p className="text-sm text-gray-500">This chapter has no pages yet.</p>
      </div>
    );
  }
  if (!page) {
    return (
      <div className="p-4 space-y-3">
        <Link to={`/read/series/${chapterQ.data?.series.id ?? ""}`} className="text-sm text-indigo-300 hover:text-indigo-200">← Back to the series</Link>
        <p className="text-sm text-gray-500">Page {pageNumber} doesn't exist; this chapter has {pages.length}.</p>
      </div>
    );
  }

  const fitButton = (mode: FitMode, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => setFit(mode)}
      aria-pressed={fit === mode}
      title={label}
      aria-label={label}
      className={`p-1.5 rounded-md ${fit === mode ? "bg-gray-700 text-white" : "text-gray-400 hover:bg-gray-800"}`}
    >
      {icon}
    </button>
  );

  return (
    <div ref={frameRef} className="flex flex-col h-full bg-gray-950">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-gray-800">
        <Link to={`/read/series/${chapterQ.data.series.id}`} className="text-gray-400 hover:text-white" title="Back to the series">
          <ArrowLeft size={18} />
        </Link>
        <span className="text-sm font-medium truncate">{chapterQ.data.chapter.title}</span>
        <span className="text-xs text-gray-500 tabular-nums">
          {pageNumber} / {pages.length}
        </span>
        <span className="text-xs text-gray-600" title={rtl ? "Right to left (manga)" : "Left to right"}>{rtl ? "RTL" : "LTR"}</span>

        <div className="ml-auto flex items-center gap-1">
          {fitButton("height", <MoveVertical size={15} />, "Fit height")}
          {fitButton("width", <MoveHorizontal size={15} />, "Fit width")}
          {fitButton("original", <Scan size={15} />, "Original size")}
          <button onClick={() => void toggleImmersive()} title="Fullscreen (F)" aria-label="Fullscreen" className="p-1.5 rounded-md text-gray-400 hover:bg-gray-800">
            {immersive ? <Minimize size={15} /> : <Maximize size={15} />}
          </button>
        </div>
      </div>

      <div className={`flex-1 min-h-0 relative ${fit === "original" ? "overflow-auto" : "overflow-hidden"}`}>
        <div className={`min-h-full flex items-center justify-center ${fit === "original" ? "" : "h-full"}`}>
          <img
            key={page.id}
            src={readPageImageUrl(page.id, `${page.revision}-${page.updated_at}`)}
            alt={page.name ?? `Page ${pageNumber}`}
            className={FIT_CLASS[fit]}
          />
        </div>

        {/* Click targets: the side that turns forward depends on the reading direction */}
        <button
          onClick={rtl ? next : previous}
          aria-label={rtl ? "Next page" : "Previous page"}
          className="absolute inset-y-0 left-0 w-1/3 flex items-center justify-start pl-2 opacity-0 hover:opacity-100 transition-opacity"
        >
          <ChevronLeft size={28} className="text-white/70 drop-shadow" />
        </button>
        <button
          onClick={rtl ? previous : next}
          aria-label={rtl ? "Previous page" : "Next page"}
          className="absolute inset-y-0 right-0 w-1/3 flex items-center justify-end pr-2 opacity-0 hover:opacity-100 transition-opacity"
        >
          <ChevronRight size={28} className="text-white/70 drop-shadow" />
        </button>
      </div>

      <div className="flex items-center gap-3 px-4 py-2 border-t border-gray-800 text-xs text-gray-500">
        <button onClick={previous} disabled={pageNumber === 1 && !previousChapter} className="px-2 py-1 rounded-md hover:bg-gray-800 disabled:opacity-40">
          {pageNumber === 1 && previousChapter ? `← ${previousChapter.title}` : "← Previous"}
        </button>
        <input
          type="number"
          min={1}
          max={pages.length}
          value={pageNumber}
          onChange={(e) => {
            const target = Number(e.target.value);
            if (target >= 1 && target <= pages.length) goToPage(target);
          }}
          aria-label="Go to page"
          className="w-16 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-center text-gray-200 tabular-nums"
        />
        <span>{page.has_result ? "translated" : "original"}</span>
        <button
          onClick={next}
          disabled={pageNumber === pages.length && !nextChapter}
          className="ml-auto px-2 py-1 rounded-md hover:bg-gray-800 disabled:opacity-40"
        >
          {pageNumber === pages.length && nextChapter ? `${nextChapter.title} →` : "Next →"}
        </button>
      </div>
    </div>
  );
}
