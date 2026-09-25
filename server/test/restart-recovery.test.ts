/**
 * What the server tidies up about the last one, before it starts listening.
 *
 * Jobs live in memory, so a page left "queued" or "running" by a process that is gone will never move again — and
 * a page deletion that stopped half way leaves a folder parked beside a row that may or may not still exist. Both
 * are handled at boot (src/index.ts), which means a mistake here is only visible in the one situation nobody tests
 * by hand: the start after a crash.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { PAGE_JOBS_DIR, pageDir, PageStore } from "@/stores/page-store";
import { call, png, signedIn } from "./harness";

/** A chapter with one page filed into it, folder and all, as an import leaves it. */
async function uploadedPage(cookie: string): Promise<string> {
  const series = await call<{ series: { id: number } }>(
    "POST", "/manage/api/series", { title: `Recovery ${crypto.randomUUID()}` }, { cookie },
  );
  const chapter = await call<{ unsorted: { id: number }[] }>(
    "POST", "/manage/api/chapters", { series_id: series.body.series.id, title: "Chapter 1" }, { cookie },
  );
  const chapterId = chapter.body.unsorted[0]!.id;

  const form = new FormData();
  form.append("files", new File([await png()], "1.png", { type: "image/png" }));
  await call("POST", `/manage/api/chapters/${chapterId}/pages`, form, { cookie });

  const pages = await PageStore.listByChapter(chapterId);
  return pages[0]!.id;
}

/** Moves a page's folder aside the way DELETE /studio/api/pages/:id does, and says where it went. */
async function park(pageId: string, at = Date.now()): Promise<string> {
  const parked = join(PAGE_JOBS_DIR, `${pageId}.deleting-${at}`);
  await rename(pageDir(pageId), parked);
  return parked;
}

describe("pages the last shutdown interrupted", () => {
  test("queued and running become an error that says what happened", async () => {
    const cookie = (await signedIn("contributor")).cookie;
    const queued = await uploadedPage(cookie);
    const running = await uploadedPage(cookie);
    await PageStore.update(queued, { status: "queued" });
    await PageStore.update(running, { status: "running" });

    await PageStore.failInterrupted();

    for (const id of [queued, running]) {
      const page = await PageStore.findById(id);
      expect(page?.status).toBe("error");
      // Whoever opens the page next needs to know it is theirs to restart, not something still in progress.
      expect(page?.errorMessage).toContain("Interrupted by a server restart");
    }
  });

  test("work that had finished, or already failed, is left exactly as it was", async () => {
    const cookie = (await signedIn("contributor")).cookie;
    const done = await uploadedPage(cookie);
    const failed = await uploadedPage(cookie);
    await PageStore.update(done, { status: "done" });
    await PageStore.update(failed, { status: "error", errorMessage: "OCR model not ready" });

    await PageStore.failInterrupted();

    expect((await PageStore.findById(done))?.status).toBe("done");
    const stillFailed = await PageStore.findById(failed);
    expect(stillFailed?.status).toBe("error");
    // Not overwritten with the restart message: the original reason is the useful one.
    expect(stillFailed?.errorMessage).toBe("OCR model not ready");
  });

  test("it counts what it changed, and a second pass finds nothing left to do", async () => {
    const cookie = (await signedIn("contributor")).cookie;
    await PageStore.failInterrupted(); // whatever other tests left behind, so this run starts from a known place

    const ids = [await uploadedPage(cookie), await uploadedPage(cookie)];
    for (const id of ids) await PageStore.update(id, { status: "running" });

    expect(await PageStore.failInterrupted()).toBe(2);
    expect(await PageStore.failInterrupted()).toBe(0);
  });
});

describe("folders left behind by a deletion that stopped half way", () => {
  test("a parked folder whose page is gone is removed, and counted", async () => {
    const cookie = (await signedIn("contributor")).cookie;
    const pageId = await uploadedPage(cookie);
    const parked = await park(pageId);
    await PageStore.deletePage(pageId);

    expect(await PageStore.sweepDeletedPageFolders()).toBe(1);
    expect(existsSync(parked)).toBe(false);
  });

  test("a parked folder whose page still exists is given back to it", async () => {
    const cookie = (await signedIn("contributor")).cookie;
    const pageId = await uploadedPage(cookie);
    const parked = await park(pageId);
    expect(existsSync(pageDir(pageId))).toBe(false);

    // The row survived, so the files are the page's: restored, and not counted as a removal.
    expect(await PageStore.sweepDeletedPageFolders()).toBe(0);
    expect(existsSync(parked)).toBe(false);
    expect(existsSync(join(pageDir(pageId), "original.png"))).toBe(true);
  });

  test("when the page already has a folder, both are left for somebody to look at", async () => {
    const cookie = (await signedIn("contributor")).cookie;
    const pageId = await uploadedPage(cookie);
    const parked = await park(pageId);
    // A second folder appeared for the same page — the one case where guessing would destroy something.
    await mkdir(pageDir(pageId), { recursive: true });
    await writeFile(join(pageDir(pageId), "original.png"), "the newer one");

    expect(await PageStore.sweepDeletedPageFolders()).toBe(0);
    expect(existsSync(parked)).toBe(true);
    expect(await Bun.file(join(pageDir(pageId), "original.png")).text()).toBe("the newer one");

    // Kept on purpose, so this test takes it away again: the sweep counts removals across the whole directory,
    // and one test's leftovers would become another's arithmetic.
    await rm(parked, { recursive: true, force: true });
  });

  /**
   * The empty case is the one the check earns its keep on: rename(2) will happily put a directory over an empty
   * one, so without the existsSync guard this parked folder would silently replace the page's own — and with a
   * *non-empty* folder there the rename fails by itself, which looks like correct behaviour from the outside.
   */
  test("…even when the folder the page already has is empty", async () => {
    const cookie = (await signedIn("contributor")).cookie;
    const pageId = await uploadedPage(cookie);
    const parked = await park(pageId);
    await mkdir(pageDir(pageId), { recursive: true });

    expect(await PageStore.sweepDeletedPageFolders()).toBe(0);
    expect(existsSync(parked)).toBe(true);
    expect(existsSync(join(pageDir(pageId), "original.png"))).toBe(false);

    await rm(parked, { recursive: true, force: true });
  });

  test("a folder that isn't parked is not touched", async () => {
    const cookie = (await signedIn("contributor")).cookie;
    const pageId = await uploadedPage(cookie);
    const decoy = join(PAGE_JOBS_DIR, "notes.deleting-tomorrow");
    await mkdir(decoy, { recursive: true });

    await PageStore.sweepDeletedPageFolders();

    expect(existsSync(decoy)).toBe(true);
    // …and a live page keeps its folder, which is the thing a greedy pattern would eat.
    expect(existsSync(pageDir(pageId))).toBe(true);

    await rm(decoy, { recursive: true, force: true });
  });

  test("every parked folder in one pass is handled by its own rule", async () => {
    const cookie = (await signedIn("contributor")).cookie;
    const orphan = await uploadedPage(cookie);
    const survivor = await uploadedPage(cookie);
    const contested = await uploadedPage(cookie);

    const orphanParked = await park(orphan);
    const survivorParked = await park(survivor);
    const contestedParked = await park(contested);
    await PageStore.deletePage(orphan);
    await mkdir(pageDir(contested), { recursive: true });

    expect(await PageStore.sweepDeletedPageFolders()).toBe(1);

    expect(existsSync(orphanParked)).toBe(false);                               // removed
    expect(existsSync(survivorParked)).toBe(false);                             // restored
    expect(existsSync(join(pageDir(survivor), "original.png"))).toBe(true);
    expect(existsSync(contestedParked)).toBe(true);                             // kept

    // Nothing else in the jobs directory was disturbed on the way past.
    const left = await readdir(PAGE_JOBS_DIR);
    expect(left).toContain(basename(contestedParked));

    await rm(contestedParked, { recursive: true, force: true });
  });
});
