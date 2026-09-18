/**
 * Where a page sits in the library, for the Studio to show: the series and chapter it belongs to, and its place in the
 * chapter's reading order. The Studio and Manage work on the same rows, so this is what lets one show the other's half.
 */
import { ChapterStore, SeriesStore } from "@/stores/library-store";
import { PageStore } from "@/stores/page-store";
import type { Page } from "@/db/schema";

export interface PageLocation {
  series_id: number;
  series_title: string;
  chapter_id: number;
  chapter_title: string;
  chapter_number: string | null;
  /** 1-based position in the chapter's reading order. */
  index: number;
  total: number;
}

/** The location of every filed page in the list, keyed by page id; Inbox pages are simply absent. */
export async function pageLocations(pages: Page[]): Promise<Map<string, PageLocation>> {
  const chapterIds = [...new Set(pages.map((page) => page.chapterId).filter((id): id is number => id !== null))];
  const located = new Map<string, PageLocation>();

  for (const chapterId of chapterIds) {
    const chapter = await ChapterStore.findById(chapterId);
    if (!chapter) continue;
    const series = await SeriesStore.findById(chapter.seriesId);
    if (!series) continue;
    const ordered = await PageStore.listByChapter(chapterId);
    ordered.forEach((page, index) => {
      located.set(page.id, {
        series_id: series.id,
        series_title: series.title,
        chapter_id: chapter.id,
        chapter_title: chapter.title,
        chapter_number: chapter.number,
        index: index + 1,
        total: ordered.length,
      });
    });
  }

  return located;
}

/** The location of one page, or null when it is still in the Inbox. */
export async function pageLocation(page: Page): Promise<PageLocation | null> {
  if (page.chapterId === null) return null;
  return (await pageLocations([page])).get(page.id) ?? null;
}
