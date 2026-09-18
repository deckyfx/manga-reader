/**
 * Publishing a page: the one step that changes what readers and open extension tabs see.
 *
 * Burning in the Studio rewrites `result.png` as often as you like; publishing snapshots it under the next revision,
 * and the reader is served that snapshot (see `publishedFile`). So a page can be edited while it is being read without
 * anyone seeing half-finished lettering.
 */
import { childLogger } from "@/lib/logger";
import { snapshotResult } from "@/services/page-history";
import { resultUrl } from "@/services/page-jobs";
import { pageLive } from "@/stores/page-live-channel";
import { PageStore } from "@/stores/page-store";

const log = childLogger("publish");

/** Bumps the revision, snapshots result.png under it and tells open extension tabs. Call under the page lock. */
export async function publishPage(id: string): Promise<{ revision: number; notified: number }> {
  const revision = await PageStore.bumpRevision(id);
  await snapshotResult(id, revision);
  const notified = pageLive.publish({ type: "page-updated", page_id: id, revision, result_url: resultUrl(id, revision) });
  log.info({ pageId: id, revision, notified }, "Page published");
  return { revision, notified };
}
