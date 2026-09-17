/**
 * Translating a whole chapter: runs the pipeline over its pages one at a time (the pipeline is CPU-bound and already
 * serialised by the global queue), skipping pages that are finished unless the run is forced. Progress lives in memory
 * and is polled through GET /studio/api/chapters/:id/run; a server restart cancels a run, like every other page job.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { childLogger } from "@/lib/logger";
import { runStoredPage } from "@/services/page-jobs";
import { pageDir, PageStore } from "@/stores/page-store";
import type { Page } from "@/db/schema";

const log = childLogger("chapter-batch");

export interface ChapterRunState {
  chapterId: number;
  running: boolean;
  total: number;
  done: number;
  failed: number;
  /** Page being translated right now, if any. */
  currentPageId: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** Why the run stopped early, or the last page error. */
  error: string | null;
}

const runs = new Map<number, ChapterRunState>();

/** Whether a page still needs the pipeline: never translated, failed, missing its result, or a stage went stale. */
export async function needsRun(page: Page): Promise<boolean> {
  if (page.status !== "done") return true;
  if (!existsSync(join(pageDir(page.id), "result.png"))) return true;
  const stages = await PageStore.listStages(page.id);
  if (stages.length === 0) return true;
  return stages.some((stage) => stage.status !== "fresh");
}

/** The pages a run would process, in reading order. */
export async function pagesToRun(chapterId: number, force: boolean): Promise<Page[]> {
  const pages = await PageStore.listByChapter(chapterId);
  if (force) return pages.filter((page) => existsSync(join(pageDir(page.id), "original.png")));
  const selected: Page[] = [];
  for (const page of pages) {
    if (!existsSync(join(pageDir(page.id), "original.png"))) continue;
    if (await needsRun(page)) selected.push(page);
  }
  return selected;
}

export const chapterRun = (chapterId: number): ChapterRunState | null => runs.get(chapterId) ?? null;

/**
 * Starts a chapter run in the background. Returns the initial state, or null when one is already running (the caller
 * answers 409). Pages are translated in reading order; a failing page is counted and the run carries on.
 */
export async function startChapterRun(chapterId: number, options: { force: boolean; cleanSfx: boolean }): Promise<ChapterRunState | null> {
  const current = runs.get(chapterId);
  if (current?.running) return null;

  // Registered before the first await: a second request now sees a running state and is refused
  const state: ChapterRunState = {
    chapterId,
    running: true,
    total: 0,
    done: 0,
    failed: 0,
    currentPageId: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };
  runs.set(chapterId, state);

  let pages: Page[];
  try {
    pages = await pagesToRun(chapterId, options.force);
  } catch (err) {
    state.running = false;
    state.finishedAt = new Date().toISOString();
    state.error = err instanceof Error ? err.message : String(err);
    return state;
  }
  state.total = pages.length;

  void (async () => {
    for (const page of pages) {
      state.currentPageId = page.id;
      try {
        const result = await runStoredPage(page.id, { source: page.source, cleanSfx: options.cleanSfx, force: true });
        if (!result.ok) {
          state.failed++;
          state.error = result.error;
          log.warn({ chapterId, pageId: page.id, error: result.error }, "Chapter run skipped a page");
          continue;
        }
        await result.done;
        const after = await PageStore.findById(page.id);
        if (after?.status === "error") {
          state.failed++;
          state.error = after.errorMessage ?? "page failed";
        } else {
          state.done++;
        }
      } catch (err) {
        state.failed++;
        state.error = err instanceof Error ? err.message : String(err);
        log.error({ err, chapterId, pageId: page.id }, "Chapter run failed on a page");
      }
    }
    state.currentPageId = null;
    state.running = false;
    state.finishedAt = new Date().toISOString();
    log.info({ chapterId, done: state.done, failed: state.failed }, "Chapter run finished");
  })();

  return state;
}
