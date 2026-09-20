/**
 * The one-time backfill for pages burnt before publishing existed.
 *
 * Publishing arrived after pages were already being read: a chapter page could hold a burnt `result.png` and no
 * published snapshot at all. The reader covered that by falling back to the burn, which meant Studio edits reached
 * readers the moment they were burnt — the very thing publishing exists to prevent.
 *
 * This walks those pages once and publishes what they are already serving, so the fallback can be deleted. It is
 * deliberately boring: it never touches a page that has a snapshot, and publishing a page whose burn readers were
 * already being served changes nothing anybody can see.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { childLogger } from "@/lib/logger";
import { withPageLock } from "@/queue/page-queue";
import { publishedFile } from "@/services/page-history";
import { publishPage } from "@/services/page-publish";
import { pageDir, PageStore } from "@/stores/page-store";

const log = childLogger("publish-backfill");

export interface BackfillReport {
  /** Pages that now have a published snapshot they didn't have before. */
  published: string[];
  /** Pages that couldn't be published, with why; the rest of the run carries on. */
  failed: { pageId: string; error: string }[];
}

/**
 * Chapter pages holding a burn that was never published. Inbox and workspace pages are left alone: nobody reads
 * those, so there is nothing for them to be serving.
 */
export async function pagesNeedingPublish(): Promise<string[]> {
  const filed = await PageStore.listAllInChapters();
  return filed
    .filter((page) => existsSync(join(pageDir(page.id), "result.png")) && publishedFile(page.id) === null)
    .map((page) => page.id);
}

/**
 * Publishes each of them, one at a time under its page lock, so a run can't race the pipeline or the Studio. A page
 * that fails is reported and the run carries on: one broken page shouldn't leave the rest of a library unpublished.
 */
export async function backfillPublishes(): Promise<BackfillReport> {
  const pending = await pagesNeedingPublish();
  const report: BackfillReport = { published: [], failed: [] };
  if (pending.length === 0) return report;

  log.info({ pages: pending.length }, "Publishing pages burnt before the publish gate");
  for (const pageId of pending) {
    try {
      // Checked again under the lock: a normal publish may have landed since the list was taken
      const done = await withPageLock(pageId, async () => {
        if (publishedFile(pageId) !== null) return false;
        if (!existsSync(join(pageDir(pageId), "result.png"))) return false;
        // The snapshot keeps the burn's own timestamp. Whether a Studio draft still has work to publish is decided by
        // comparing it against its chapter page's newest snapshot, so dating these "now" would date an old burn later
        // than a draft rendered since, and that draft's edits would quietly stop being offered
        await publishPage(pageId, { keepResultTime: true });
        return true;
      });
      if (done) report.published.push(pageId);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn({ err, pageId }, "Couldn't publish a page during the backfill");
      report.failed.push({ pageId, error });
    }
  }
  log.info({ published: report.published.length, failed: report.failed.length }, "Publish backfill finished");
  return report;
}
