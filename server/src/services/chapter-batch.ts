/**
 * Translating a whole chapter: the generic page runner (services/page-batch.ts) over the chapter's pages in reading
 * order, skipping finished pages unless forced, publishing each page that succeeds so the run ends with a chapter
 * readers can read. Progress is polled through GET /manage/api/chapters/:id/run.
 */
import { batchRun, pagesNeedingRun, startBatchRun, type BatchRunState } from "@/services/page-batch";
import { PageStore } from "@/stores/page-store";
import type { Page } from "@/db/schema";

export { needsRun } from "@/services/page-batch";

export interface ChapterRunState extends BatchRunState {
  chapterId: number;
}

const keyFor = (chapterId: number): string => `chapter:${chapterId}`;

/** The pages a run would process, in reading order. */
export async function pagesToRun(chapterId: number, force: boolean): Promise<Page[]> {
  return pagesNeedingRun(await PageStore.listByChapter(chapterId), force);
}

export const chapterRun = (chapterId: number): ChapterRunState | null => {
  const state = batchRun(keyFor(chapterId));
  return state ? { ...state, chapterId } : null;
};

/**
 * Starts a chapter run in the background. Returns the initial state, or null when one is already running (the caller
 * answers 409).
 */
export async function startChapterRun(chapterId: number, options: { force: boolean; cleanSfx: boolean }): Promise<ChapterRunState | null> {
  const state = await startBatchRun(keyFor(chapterId), () => pagesToRun(chapterId, options.force), {
    cleanSfx: options.cleanSfx,
    publish: true,
  });
  return state ? { ...state, chapterId } : null;
};
