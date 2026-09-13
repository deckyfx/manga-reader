/** Page work (full runs and Studio re-renders) runs one task at a time: every stage is CPU-bound and shares the same models. */
let pageQueue: Promise<void> = Promise.resolve();

/** Appends a task that runs after the previous one settles, whether it succeeded or not. */
export function runExclusive(task: () => Promise<void>): void {
  pageQueue = pageQueue.then(task, task);
}

/** Like `runExclusive`, but resolves with the task's result (or rejects with its error). */
export function runExclusiveResult<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    runExclusive(() => task().then(resolve, reject));
  });
}
