import { childLogger } from "@/lib/logger";

const log = childLogger("page-queue");

/** Tail of the page work queue; always settles successfully so a failed task never breaks the chain. */
let pageQueue: Promise<void> = Promise.resolve();

/**
 * Page work (full runs and Studio re-runs) runs one task at a time: every stage is CPU-bound and shares the
 * same models. The task starts after the previous one settles; if it fails, the error is logged here (callers
 * that need the outcome use `runExclusiveResult`).
 */
export function runExclusive(task: () => Promise<void>): void {
  pageQueue = pageQueue
    .then(async () => {
      await task();
    })
    .catch((err: unknown) => log.error({ err }, "Page queue task failed"));
}

/** Like `runExclusive`, but resolves with the task's result, or rejects with its error (including a synchronous throw). */
export function runExclusiveResult<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    runExclusive(async () => {
      try {
        resolve(await task());
      } catch (err) {
        reject(err);
      }
    });
  });
}

/** Tail of each page's lock chain; removed once the page has no pending work. */
const pageLocks = new Map<string, Promise<void>>();

/**
 * Runs `task` after every earlier task for the same page settles, so multi-step page mutations (edit, re-run,
 * publish, rollback) never interleave. Tasks for different pages don't wait on each other.
 */
export function withPageLock<T>(pageId: string, task: () => Promise<T>): Promise<T> {
  const previous = pageLocks.get(pageId) ?? Promise.resolve();
  const result = previous.then(() => task());
  const settled = result.then(() => {}, () => {});
  pageLocks.set(pageId, settled);
  void settled.then(() => {
    if (pageLocks.get(pageId) === settled) pageLocks.delete(pageId);
  });
  return result;
}

/**
 * `withPageLock` for a workspace: appends to one workspace run one after another, so a retried upload batch sees the
 * pages the first attempt stored. Page ids never contain a colon, so the keys can't collide.
 */
export function withWorkspaceLock<T>(workspaceId: number, task: () => Promise<T>): Promise<T> {
  return withPageLock(`workspace:${workspaceId}`, task);
}
