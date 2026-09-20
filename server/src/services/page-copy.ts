/**
 * Copying a page into a chapter. Filing an Inbox draft copies it by default: the chapter gets its own row, images,
 * stages and blocks, and the draft stays in the Studio to work from. Publish history is not copied — the copy starts
 * unpublished, so it becomes readable when it is published in its new home.
 */
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { childLogger } from "@/lib/logger";
import { pageDir, PageStore } from "@/stores/page-store";
import type { Page } from "@/db/schema";

const log = childLogger("page-copy");

/**
 * Copies a chapter page into a workspace as a draft: loose (no chapter), pointing back at the page it will replace
 * when it is published. The chapter keeps serving the original until then.
 */
export async function copyPageAsDraft(source: Page, workspaceId: number, sortOrder: number): Promise<Page> {
  const draft = await PageStore.createInWorkspace(source.imageHash, source.source, workspaceId, sortOrder, source.name, source.id);
  try {
    return await fillCopy(source, draft, null);
  } catch (err) {
    await PageStore.deletePage(draft.id).catch((cleanup: unknown) => log.error({ err: cleanup, pageId: draft.id }, "Couldn't remove a failed draft"));
    await rm(pageDir(draft.id), { recursive: true, force: true })
      .catch((cleanup: unknown) => log.error({ err: cleanup, pageId: draft.id }, "Couldn't remove a failed draft's folder"));
    throw err;
  }
}

/** Copies a page into a chapter, appended at the end of its reading order. */
export async function copyPageIntoChapter(source: Page, chapterId: number, name?: string | null): Promise<Page> {
  const sortOrder = (await PageStore.maxSortOrder(chapterId)) + 1;
  const copy = await PageStore.createInChapter(source.imageHash, source.source, chapterId, sortOrder, name ?? source.name);
  try {
    return await fillCopy(source, copy, chapterId);
  } catch (err) {
    // Half a page in a chapter is worse than none: take the row and anything already copied back out
    await PageStore.deletePage(copy.id).catch((cleanup: unknown) => log.error({ err: cleanup, pageId: copy.id }, "Couldn't remove a failed copy"));
    await rm(pageDir(copy.id), { recursive: true, force: true })
      .catch((cleanup: unknown) => log.error({ err: cleanup, pageId: copy.id }, "Couldn't remove a failed copy's folder"));
    throw err;
  }
}

/** Copies the source page's images, stages and blocks onto the freshly created row. */
async function fillCopy(source: Page, copy: Page, chapterId: number | null): Promise<Page> {
  await PageStore.update(copy.id, {
    width: source.width,
    height: source.height,
    status: source.status === "queued" || source.status === "running" ? "done" : source.status,
    cleanSfx: source.cleanSfx,
  });

  await copyPageImages(source.id, copy.id);

  await PageStore.copyStagesAndBlocks(source.id, copy.id);
  log.info({ from: source.id, to: copy.id, chapterId }, chapterId === null ? "Copied a page into the Studio as a draft" : "Copied a page into a chapter");
  return (await PageStore.findById(copy.id)) ?? copy;
}

/**
 * Copies a page's images onto another page, leaving the target's publish history alone — that lives in its own
 * folder, and it is what a chapter is rolled back to.
 */
export async function copyPageImages(fromId: string, toId: string): Promise<void> {
  const from = pageDir(fromId);
  const to = pageDir(toId);
  let files: string[] = [];
  try {
    files = await readdir(from);
  } catch (err) {
    // A page with no folder (nothing rendered yet) copies as an empty one; anything else is a real failure and
    // belongs to the caller's cleanup
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const pngs = files.filter((file) => file.endsWith(".png"));
  if (pngs.length > 0) await mkdir(to, { recursive: true });
  for (const file of pngs) {
    await cp(join(from, file), join(to, file), { recursive: false, force: true });
  }

  // Images the source no longer has (a mask the draft cleared, say) must not survive on the target, or a later run
  // would build on state that was deliberately removed. The history folder isn't touched: it isn't an image here.
  let existing: string[] = [];
  try {
    existing = await readdir(to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const kept = new Set(pngs);
  for (const file of existing) {
    if (file.endsWith(".png") && !kept.has(file)) await rm(join(to, file), { force: true });
  }
}
