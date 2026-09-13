/** Page work (full runs and Studio re-renders) runs one task at a time: every stage is CPU-bound and shares the same models. */
let pageQueue: Promise<void> = Promise.resolve();

/** Appends a task that runs after the previous one settles, whether it succeeded or not. */
export function runExclusive(task: () => Promise<void>): void {
  pageQueue = pageQueue.then(task, task);
}

/** Tail of each page's lock chain; removed once the page has no pending work. */
const pageLocks = new Map<string, Promise<void>>();

/**
 * Runs `task` after every earlier task for the same page settles, so multi-step page mutations (edit, re-run,
 * publish, rollback) never interleave. Tasks for different pages don't wait on each other.
 */
export function withPageLock<T>(pageId: string, task: () => Promise<T>): Promise<T> {
  const previous = pageLocks.get(pageId) ?? Promise.resolve();
  const result = previous.then(task, task);
  const settled = result.then(() => {}, () => {});
  pageLocks.set(pageId, settled);
  void settled.then(() => {
    if (pageLocks.get(pageId) === settled) pageLocks.delete(pageId);
  });
  return result;
}

/** Like `runExclusive`, but resolves with the task's result (or rejects with its error). */
export function runExclusiveResult<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    runExclusive(() => task().then(resolve, reject));
  });
}
