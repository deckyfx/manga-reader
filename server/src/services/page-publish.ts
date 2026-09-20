/**
 * Publishing a page: the one step that changes what readers and open extension tabs see.
 *
 * Burning in the Studio rewrites `result.png` as often as you like; publishing snapshots it under the next revision,
 * and the reader is served that snapshot (see `publishedFile`). So a page can be edited while it is being read without
 * anyone seeing half-finished lettering.
 */
import { rm } from "node:fs/promises";
import { childLogger } from "@/lib/logger";
import { historyFile, pruneHistory, snapshotResult } from "@/services/page-history";
import { resultUrl } from "@/services/page-jobs";
import { pageLive } from "@/stores/page-live-channel";
import { PageStore } from "@/stores/page-store";

const log = childLogger("publish");

/**
 * Snapshots result.png as the next revision, commits that revision and tells open extension tabs. Call under the
 * page lock — the lock is what makes the next revision number safe to compute here.
 *
 * The snapshot is written before the revision is committed, so a failure leaves the page exactly as it was: a
 * committed revision whose snapshot never landed would point readers and extension tabs at a missing image.
 */
export async function publishPage(id: string, { keepResultTime = false } = {}): Promise<{ revision: number; notified: number }> {
  const page = await PageStore.findById(id);
  if (!page) throw new Error("page not found");
  const revision = page.revision + 1;

  // `keepResultTime` is for the backfill, which records burns made long ago rather than publishing new work
  await snapshotResult(id, revision, { keepTime: keepResultTime });
  try {
    await PageStore.bumpRevision(id);
  } catch (err) {
    // The revision never took: drop the snapshot again so nothing claims to be published
    await rm(historyFile(id, revision), { force: true })
      .catch((cleanup: unknown) => log.error({ err: cleanup, pageId: id, revision }, "Couldn't remove an uncommitted snapshot"));
    throw err;
  }

  // Only now that the revision is committed: pruning before it would drop an old snapshot for a publish that
  // never happened, and that snapshot is somebody's rollback. The publish itself has already happened, so a
  // failure here is logged and nothing more — the extra snapshots go on the next publish, and the tabs waiting
  // for this revision still get told about it.
  await pruneHistory(id).catch((err: unknown) => log.warn({ err, pageId: id, revision }, "Couldn't prune the publish history"));

  const notified = pageLive.publish({ type: "page-updated", page_id: id, revision, result_url: resultUrl(id, revision) });
  log.info({ pageId: id, revision, notified }, "Page published");
  return { revision, notified };
}
