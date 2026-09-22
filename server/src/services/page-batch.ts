/**
 * Running the pipeline over a list of pages, one at a time (it is CPU-bound and already serialised by the global
 * queue). A run is known by a key — `chapter:12`, `workspace:3` — so each chapter or workspace has at most one, and
 * its progress is polled while it lasts. Progress lives in memory: a restart cancels a run, like every page job.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { childLogger } from "@/lib/logger";
import { runStoredPage } from "@/services/page-jobs";
import { publishPage } from "@/services/page-publish";
import { withPageLock } from "@/queue/page-queue";
import { pageDir, PageStore } from "@/stores/page-store";
import type { Page } from "@/db/schema";

const log = childLogger("page-batch");

export interface BatchRunState {
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

const runs = new Map<string, BatchRunState>();

/**
 * Runs asked for while they were already going. A following run only ends when a look for new pages finds none — but
 * a page can land, and its start be refused, during that very look, after the look has already missed it. A refused
 * start leaves its key here, and the run doesn't end while one is waiting.
 */
const rescanRequested = new Set<string>();

/** Whether a page still needs the pipeline: never translated, failed, missing its result, or a stage went stale. */
export async function needsRun(page: Page): Promise<boolean> {
  // Finalized pages are finished on purpose; redoing one is a deliberate "Run again", never part of a batch
  if (page.finalizedAt !== null) return false;
  if (page.status !== "done") return true;
  if (!existsSync(join(pageDir(page.id), "result.png"))) return true;
  const stages = await PageStore.listStages(page.id);
  if (stages.length === 0) return true;
  return stages.some((stage) => stage.status !== "fresh");
}

/** Of these pages, the ones a run would process: they have an original, and (unless forced) need one. */
export async function pagesNeedingRun(pages: readonly Page[], force: boolean): Promise<Page[]> {
  const selected: Page[] = [];
  for (const page of pages) {
    if (!existsSync(join(pageDir(page.id), "original.png"))) continue;
    // Not even when forced: "run everything again" means the working pages, not the ones someone finished
    if (page.finalizedAt !== null) continue;
    if (force || (await needsRun(page))) selected.push(page);
  }
  return selected;
}

export const batchRun = (key: string): BatchRunState | null => runs.get(key) ?? null;

/**
 * Starts a run in the background. Returns its initial state, or null when one is already running under this key (the
 * caller answers 409). Pages run in the order `loadPages` returns; a failing page is counted and the run carries on.
 *
 * `publish` snapshots each translated page, which is what makes a chapter readable. A workspace's drafts are not
 * published by a run: they are published when they are filed, or explicitly.
 */
export async function startBatchRun(
  key: string,
  loadPages: () => Promise<Page[]>,
  options: {
    cleanSfx: boolean;
    publish: boolean;
    /**
     * Keep going while pages keep arriving: once the list is done, ask `loadPages` again and run whatever is new.
     * For a workspace being imported into, whose pages land one at a time while the run is already translating the
     * first ones — without it, every page uploaded after the run started would wait for a run of its own.
     */
    follow?: boolean;
  },
): Promise<BatchRunState | null> {
  if (runs.get(key)?.running) {
    // Refused, but noted: a following run takes it as "look again" (a run that doesn't follow ignores it)
    rescanRequested.add(key);
    return null;
  }

  // Registered before the first await: a second request now sees a running state and is refused
  const state: BatchRunState = {
    running: true,
    total: 0,
    done: 0,
    failed: 0,
    currentPageId: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };
  runs.set(key, state);

  let pages: Page[];
  try {
    pages = await loadPages();
  } catch (err) {
    state.running = false;
    state.finishedAt = new Date().toISOString();
    state.error = err instanceof Error ? err.message : String(err);
    return state;
  }
  state.total = pages.length;

  /** One page through the pipeline, counted into the run's state. */
  const runPage = async (page: Page): Promise<void> => {
    state.currentPageId = page.id;
    try {
      // Admission under the page's lock (the run itself queues behind it), so it can't land mid-publish
      const result = await withPageLock(page.id, () =>
        runStoredPage(page.id, { source: page.source, cleanSfx: options.cleanSfx, force: true }));
      if (!result.ok) {
        state.failed++;
        state.error = result.error;
        log.warn({ key, pageId: page.id, error: result.error }, "Run skipped a page");
        return;
      }
      await result.done;
      const after = await PageStore.findById(page.id);
      if (after?.status === "error") {
        state.failed++;
        state.error = after.errorMessage ?? "page failed";
      } else {
        // Readers are served published snapshots, so a translated page has to be published to become readable
        if (options.publish) await withPageLock(page.id, () => publishPage(page.id));
        state.done++;
      }
    } catch (err) {
      state.failed++;
      state.error = err instanceof Error ? err.message : String(err);
      log.error({ err, key, pageId: page.id }, "Run failed on a page");
    }
  };

  void (async () => {
    // Every page this run has tried, successful or not: a page that fails is not tried again by the same run, or a
    // following run would loop on it for as long as it keeps failing
    const attempted = new Set<string>();
    let batch = pages;
    // Carries on while there is work, or while a start was refused since the last look — see rescanRequested
    while (batch.length > 0 || (options.follow && rescanRequested.has(key))) {
      for (const page of batch) {
        attempted.add(page.id);
        await runPage(page);
      }
      if (!options.follow) break;
      // Taken before looking, so a request arriving during the look is still there afterwards and forces another
      rescanRequested.delete(key);
      try {
        batch = (await loadPages()).filter((page) => !attempted.has(page.id));
      } catch (err) {
        log.warn({ err, key }, "A following run couldn't look for new pages, and stopped");
        state.error = err instanceof Error ? err.message : String(err);
        break;
      }
      state.total += batch.length;
    }
    state.currentPageId = null;
    state.running = false;
    state.finishedAt = new Date().toISOString();
    // A request left over from a run that didn't follow means nothing to the next run
    rescanRequested.delete(key);
    log.info({ key, done: state.done, failed: state.failed }, "Run finished");
  })();

  return state;
}
