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
async function fillCopy(source: Page, copy: Page, chapterId: number): Promise<Page> {
  await PageStore.update(copy.id, {
    width: source.width,
    height: source.height,
    status: source.status === "queued" || source.status === "running" ? "done" : source.status,
    cleanSfx: source.cleanSfx,
  });

  // Every image the page holds, but not its history: the copy has published nothing yet
  const from = pageDir(source.id);
  const to = pageDir(copy.id);
  let files: string[] = [];
  try {
    files = await readdir(from);
  } catch {
    // A page with no folder (nothing rendered yet) copies as an empty one
  }
  if (files.some((file) => file.endsWith(".png"))) await mkdir(to, { recursive: true });
  for (const file of files) {
    if (!file.endsWith(".png")) continue;
    await cp(join(from, file), join(to, file), { recursive: false, force: true });
  }

  await PageStore.copyStagesAndBlocks(source.id, copy.id);
  log.info({ from: source.id, to: copy.id, chapterId }, "Copied a page into a chapter");
  return (await PageStore.findById(copy.id)) ?? copy;
}
