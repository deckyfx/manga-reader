import { type ReactNode } from "react";
import { Link } from "react-router";
import { pageFileUrl, type StudioPageSummary } from "../api";
import { pageStatus, StatusBadge } from "./StatusBadge";

/** What a page is called in the Studio: its name, else the file name of its source, else the tail of its id. */
export function pageLabel(page: StudioPageSummary): string {
  if (page.name) return page.name;
  if (page.source === "upload" || page.source === "import") return page.id.slice(-8);
  try {
    const file = new URL(page.source).pathname.split("/").filter(Boolean).pop();
    if (file) return decodeURIComponent(file);
  } catch {
    // Not a URL (an extension source string): fall through to the id
  }
  return page.id.slice(-8);
}

interface StudioPageCardProps {
  page: StudioPageSummary;
  /** Second line under the name; the page's size and where it lives, unless the caller knows better. */
  caption?: ReactNode;
  /** Buttons shown in the corner on hover (file, discard, …). */
  actions?: ReactNode;
  /** Selection mode: a click picks the page instead of opening it. */
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

/** One page in a Studio grid: its latest image, how far it got, and what it is called. */
export function StudioPageCard({ page, caption, actions, selecting = false, selected = false, onToggleSelect }: StudioPageCardProps) {
  return (
    <div className="group relative">
      <Link
        to={`/studio/pages/${page.id}`}
        // While picking pages, the whole card picks instead of opening
        onClick={(e) => {
          if (!selecting) return;
          e.preventDefault();
          onToggleSelect?.();
        }}
        aria-pressed={selecting ? selected : undefined}
        className={`flex flex-col overflow-hidden rounded-xl border bg-gray-900 transition-colors ${
          selected ? "border-indigo-500 ring-2 ring-indigo-500/40" : "border-gray-800 hover:border-indigo-500"
        }`}
      >
        <div className="aspect-2/3 overflow-hidden bg-gray-950">
          <img
            src={pageFileUrl(page.id, page.has_result ? "result.png" : "original.png", `${page.updated_at}-${page.revision}`)}
            alt=""
            loading="lazy"
            className="h-full w-full object-contain"
          />
        </div>
        <div className="flex items-center justify-between gap-2 px-3 pt-2">
          <StatusBadge status={pageStatus(page)} />
          {page.finalized ? (
            <span
              className="rounded-full bg-emerald-900/50 px-2 py-0.5 text-xs font-medium text-emerald-300"
              title={page.raw_kept ? "Finalized — the original is kept, so it can be redone" : "Finalized without its original — read-only"}
            >
              final
            </span>
          ) : page.has_edits ? (
            <span
              className="rounded-full bg-amber-900/60 px-2 py-0.5 text-xs font-medium text-amber-300"
              title={page.published ? "Burned since the last publish — readers still see the published version" : "Not published yet"}
            >
              {page.published ? "edited" : "unpublished"}
            </span>
          ) : page.published ? (
            <span className="text-xs text-gray-500" title={`Published as revision ${page.revision}`}>rev {page.revision}</span>
          ) : null}
        </div>
        <div className="truncate px-3 pt-1 text-xs text-gray-300" title={page.source}>{pageLabel(page)}</div>
        <div className="truncate px-3 pb-2 text-[11px] text-gray-500" title={page.location ? page.location.chapter_title : undefined}>
          {caption ?? (page.location
            ? `${page.location.chapter_title} · page ${page.location.index}/${page.location.total}`
            : `${page.width}×${page.height} · draft`)}
        </div>
      </Link>

      {selecting && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border-2 text-[11px] font-bold ${
            selected ? "border-indigo-500 bg-indigo-600 text-white" : "border-gray-400 bg-gray-950/70"
          }`}
        >
          {selected ? "✓" : ""}
        </span>
      )}
      {actions && !selecting && (
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}
