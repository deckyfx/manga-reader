/**
 * Deleting a page for good: its row, stages and blocks, and its folder of images.
 *
 * One place for it, because the order matters and is easy to get subtly wrong. The folder is moved aside first, then
 * the row is deleted, then the moved folder is removed — so if deleting the row fails the folder goes back and the
 * page is still whole, and if removing the folder fails the page is already gone and the leftovers are swept at the
 * next start. The caller holds the page's lock and has decided the page may go; this only does it.
 */
import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { childLogger } from "@/lib/logger";
import { PAGE_JOBS_DIR, pageDir, PageStore } from "@/stores/page-store";

const log = childLogger("page-discard");

export type DiscardResult = { ok: true } | { ok: false; error: string };

export async function discardPage(id: string): Promise<DiscardResult> {
  // Only ever this page's own folder: the resolved path must be exactly <jobs dir>/<id>
  const jobsDir = resolve(PAGE_JOBS_DIR);
  const dir = resolve(pageDir(id));
  if (dirname(dir) !== jobsDir || basename(dir) !== id) return { ok: false, error: "refusing to delete an unexpected path" };

  const parked = existsSync(dir) ? join(jobsDir, `${id}.deleting-${Date.now()}`) : null;
  if (parked) await rename(dir, parked);
  try {
    await PageStore.deletePage(id);
  } catch (err) {
    if (parked) await rename(parked, dir).catch((restoreErr: unknown) => log.error({ err: restoreErr, pageId: id, parked }, "Couldn't restore the page folder"));
    throw err;
  }
  // The page is already deleted: cleanup is best-effort, and leftovers are swept at the next server start
  if (parked) {
    await rm(parked, { recursive: true, force: true }).catch((err: unknown) =>
      log.warn({ err, pageId: id, parked }, "Couldn't remove the deleted page's folder; it will be swept at next start"));
  }
  log.info({ pageId: id }, "Page deleted");
  return { ok: true };
}
