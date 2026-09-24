import { childLogger } from "@/lib/logger";
import { describeUsage, startProbe, usageFields } from "@/lib/resource-probe";

const log = childLogger("page-queue");

/** Tail of the page work queue; always settles successfully so a failed task never breaks the chain. */
let pageQueue: Promise<void> = Promise.resolve();

/** What the queue is running, while it runs it. Only labelled work says what it is; the rest reads as busy. */
let running: string | null = null;

/** What the server is working on at this moment, or null when the queue is idle. */
export function currentWork(): string | null {
  return running;
}

/**
 * Page work (full runs and Studio re-runs) runs one task at a time: every stage is CPU-bound and shares the
 * same models. The task starts after the previous one settles; if it fails, the error is logged here (callers
 * that need the outcome use `runExclusiveResult`).
 */
export function runExclusive(task: () => Promise<void>, label?: string): Promise<void> {
  pageQueue = pageQueue
    .then(async () => {
      // Measured here, where the task actually starts: the time a task spent waiting its turn is not work it did
      const probe = label === undefined ? null : startProbe();
      running = label ?? "page work";
      try {
        await task();
      } finally {
        running = null;
        if (probe && label !== undefined) {
          const usage = probe.stop();
          log.info({ work: label, ...usageFields(usage) }, `${label} · ${describeUsage(usage)}`);
        }
      }
    })
    .catch((err: unknown) => log.error({ err }, "Page queue task failed"));
  return pageQueue;
}

/** Like `runExclusive`, but resolves with the task's result, or rejects with its error (including a synchronous throw). */
export function runExclusiveResult<T>(task: () => Promise<T>, label?: string): Promise<T> {
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  // Settled after the queue's own bookkeeping, not inside the task: resolving from in there let the caller carry
  // on while this task still counted as the work in progress, so a watcher saw work that had already finished
  const finished = runExclusive(async () => {
    try {
      outcome = { ok: true, value: await task() };
    } catch (error) {
      outcome = { ok: false, error };
    }
  }, label);
  return finished.then(() => (outcome.ok ? outcome.value : Promise.reject(outcome.error)));
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

/**
 * `withPageLock` for a chapter, for steps that read then write a chapter's Studio workspace. Page ids never contain
 * a colon, so the keys can't collide.
 */
export function withChapterLock<T>(chapterId: number, task: () => Promise<T>): Promise<T> {
  return withPageLock(`chapter:${chapterId}`, task);
}
