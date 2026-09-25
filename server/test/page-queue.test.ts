/**
 * The queue everything CPU-bound goes through, and the per-page lock that keeps two edits from interleaving.
 *
 * These are the guarantees the pipeline rests on instead of a transaction: a stage runs alone, a page's mutations
 * run in order, and a failure gets out of the way rather than jamming the thing that failed. None of that is
 * visible in a route test — a race passes a hundred runs and then doesn't — so it is pinned here, by starting work
 * together and recording the order it actually happened in.
 */
import { describe, expect, test } from "bun:test";
import {
  currentWork,
  hasPendingLock,
  runExclusive,
  runExclusiveResult,
  withChapterLock,
  withPageLock,
  withWorkspaceLock,
} from "@/queue/page-queue";

/** Yields to the event loop `times` over, so anything that *could* interleave has every chance to. */
async function breathe(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** A task that records when it starts and ends, with a pause in the middle for something else to cut in. */
function recorder(log: string[], name: string, pauses = 3) {
  return async (): Promise<string> => {
    log.push(`${name} in`);
    await breathe(pauses);
    log.push(`${name} out`);
    return name;
  };
}

describe("the one-at-a-time queue", () => {
  test("tasks started together still run one after another", async () => {
    const log: string[] = [];
    await Promise.all([
      runExclusive(async () => { await recorder(log, "a")(); }),
      runExclusive(async () => { await recorder(log, "b")(); }),
      runExclusive(async () => { await recorder(log, "c")(); }),
    ]);
    expect(log).toEqual(["a in", "a out", "b in", "b out", "c in", "c out"]);
  });

  test("a task that throws doesn't break the chain behind it", async () => {
    const log: string[] = [];
    const failed = runExclusive(async () => {
      log.push("bad in");
      throw new Error("this stage went wrong");
    });
    const after = runExclusive(async () => { await recorder(log, "next")(); });

    // runExclusive swallows the error by design — callers that need it use runExclusiveResult
    await expect(failed).resolves.toBeUndefined();
    await after;
    expect(log).toEqual(["bad in", "next in", "next out"]);
  });

  test("runExclusiveResult gives back the value, or the error, including one thrown before the first await", async () => {
    await expect(runExclusiveResult(async () => 42)).resolves.toBe(42);

    const asyncFailure = runExclusiveResult(async () => { throw new Error("mid-flight"); });
    await expect(asyncFailure).rejects.toThrow("mid-flight");

    // A synchronous throw never makes a promise of its own; the queue has to catch it just the same.
    const syncFailure = runExclusiveResult(() => { throw new Error("before any await"); });
    await expect(syncFailure).rejects.toThrow("before any await");

    // …and the queue is still usable afterwards.
    await expect(runExclusiveResult(async () => "still here")).resolves.toBe("still here");
  });

  test("a failed task still lets the next one start", async () => {
    const log: string[] = [];
    await runExclusiveResult(async () => { throw new Error("no"); }).catch(() => {});
    await runExclusiveResult(recorder(log, "after"));
    expect(log).toEqual(["after in", "after out"]);
  });
});

describe("what the queue says it is doing", () => {
  test("labelled work names itself while it runs, and nothing claims the queue when it is idle", async () => {
    expect(currentWork()).toBeNull();

    const seen: (string | null)[] = [];
    await runExclusive(async () => {
      seen.push(currentWork());
      await breathe();
    }, "clean · page 7");

    expect(seen).toEqual(["clean · page 7"]);
    expect(currentWork()).toBeNull();
  });

  test("unlabelled work reads as busy rather than as nothing", async () => {
    // Collected rather than assigned: TypeScript cannot see the write inside the closure, and narrows it to null.
    const seen: (string | null)[] = [];
    await runExclusive(async () => { seen.push(currentWork()); });
    expect(seen).toEqual(["page work"]);
  });

  /**
   * This one is here because it was got wrong once: the result was settled from inside the task, so a caller could
   * carry on while the queue still counted the task as running, and a watcher was shown work that had finished.
   */
  test("by the time a caller has its result, the queue no longer claims to be working", async () => {
    await runExclusiveResult(async () => "done", "render · page 3");
    expect(currentWork()).toBeNull();
  });
});

describe("the per-page lock", () => {
  test("two edits to the same page do not interleave", async () => {
    const log: string[] = [];
    const page = crypto.randomUUID();
    await Promise.all([
      withPageLock(page, recorder(log, "edit")),
      withPageLock(page, recorder(log, "re-run")),
    ]);
    expect(log).toEqual(["edit in", "edit out", "re-run in", "re-run out"]);
  });

  test("different pages don't wait on each other", async () => {
    const log: string[] = [];
    await Promise.all([
      withPageLock(crypto.randomUUID(), recorder(log, "one")),
      withPageLock(crypto.randomUUID(), recorder(log, "two")),
    ]);
    // Interleaved, which is the point: one page's work must not hold up another's.
    expect(log).toEqual(["one in", "two in", "one out", "two out"]);
  });

  test("the lock passes on the task's value, and its failure", async () => {
    const page = crypto.randomUUID();
    await expect(withPageLock(page, async () => ({ blocks: 9 }))).resolves.toEqual({ blocks: 9 });
    await expect(withPageLock(page, async () => { throw new Error("edit refused"); })).rejects.toThrow("edit refused");
  });

  test("a failure releases the page instead of jamming it", async () => {
    const page = crypto.randomUUID();
    const log: string[] = [];

    const failing = withPageLock(page, async () => {
      log.push("failing in");
      await breathe();
      throw new Error("rolled back");
    });
    const following = withPageLock(page, recorder(log, "after"));

    await expect(failing).rejects.toThrow("rolled back");
    await following;
    expect(log).toEqual(["failing in", "after in", "after out"]);
  });

  test("a page holds its place while it works, and gives it up afterwards", async () => {
    const page = crypto.randomUUID();
    expect(hasPendingLock(page)).toBe(false);

    const working = withPageLock(page, async () => {
      expect(hasPendingLock(page)).toBe(true);
      await breathe();
      return "first";
    });
    expect(hasPendingLock(page)).toBe(true);
    await working;

    // The entry goes in a callback on the settled chain, so it is gone a turn later rather than immediately. A
    // server that never let go would keep one of these for every page it had ever touched.
    await breathe(2);
    expect(hasPendingLock(page)).toBe(false);
  });

  test("a page that has finished its work holds nothing up next time", async () => {
    const page = crypto.randomUUID();
    await withPageLock(page, async () => "first");
    await breathe(2);

    const order: string[] = [];
    const second = withPageLock(page, async () => { order.push("second"); });
    void Promise.resolve().then(() => order.push("bystander"));
    await second;
    expect(order[0]).toBe("second");
  });
});

describe("locks that are not pages", () => {
  test("a workspace and a chapter of the same number don't block each other", async () => {
    const log: string[] = [];
    await Promise.all([
      withWorkspaceLock(4, recorder(log, "workspace")),
      withChapterLock(4, recorder(log, "chapter")),
    ]);
    expect(log).toEqual(["workspace in", "chapter in", "workspace out", "chapter out"]);
  });

  test("the same workspace serialises, as a page does", async () => {
    const log: string[] = [];
    await Promise.all([
      withWorkspaceLock(11, recorder(log, "upload")),
      withWorkspaceLock(11, recorder(log, "retry")),
    ]);
    expect(log).toEqual(["upload in", "upload out", "retry in", "retry out"]);
  });

  test("a workspace key cannot collide with a page whose id looks like one", async () => {
    const log: string[] = [];
    // Page ids are UUIDv7 and never contain a colon, which is what keeps these apart.
    await Promise.all([
      withWorkspaceLock(2, recorder(log, "workspace")),
      withPageLock("workspace", recorder(log, "page")),
    ]);
    expect(log).toEqual(["workspace in", "page in", "workspace out", "page out"]);
  });
});
