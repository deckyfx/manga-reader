/**
 * The batch runner's follow mode: a run over a workspace that is still being imported into keeps picking up the pages
 * that land while it works, and still ends.
 *
 * No models are loaded in a test, so every page is refused at once ("not ready") and counted as failed. That is
 * exactly what makes these tests sharp: a failed page is the one a following run must not try again forever.
 */
import { describe, expect, test } from "bun:test";
import type { Page } from "@/db/schema";
import { batchRun, startBatchRun } from "@/services/page-batch";

/** A page as far as the runner cares: an id and a source. */
const page = (id: string) => ({ id, source: "test" }) as Page;

async function finished(key: string) {
  for (let i = 0; i < 200; i++) {
    const state = batchRun(key);
    if (state && !state.running) return state;
    await Bun.sleep(5);
  }
  throw new Error("the run never finished");
}

describe("a following run", () => {
  test("picks up pages that arrive while it runs, and ends once none are new", async () => {
    // The workspace grows between looks: A at the start, then B lands while A is being run
    const snapshots = [[page("a")], [page("a"), page("b")], [page("a"), page("b")]];
    let looks = 0;
    const loadPages = () => Promise.resolve(snapshots[Math.min(looks++, snapshots.length - 1)]!);

    const key = `follow:${crypto.randomUUID()}`;
    await startBatchRun(key, loadPages, { cleanSfx: false, publish: false, follow: true });
    const state = await finished(key);

    expect(state.total).toBe(2);
    // Both tried once — A is not tried again although it failed, which is what keeps this from looping
    expect(state.failed).toBe(2);
  });

  test("without follow, a run is exactly the pages it started with", async () => {
    const snapshots = [[page("a")], [page("a"), page("b")]];
    let looks = 0;
    const loadPages = () => Promise.resolve(snapshots[Math.min(looks++, snapshots.length - 1)]!);

    const key = `once:${crypto.randomUUID()}`;
    await startBatchRun(key, loadPages, { cleanSfx: false, publish: false });
    const state = await finished(key);

    expect(state.total).toBe(1);
    expect(looks).toBe(1);
  });
});
