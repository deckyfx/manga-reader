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
import { publishBlocker } from "@/services/draft-publish";
import { publishedFile } from "@/services/page-history";
import { publishPage } from "@/services/page-publish";
import { pageDir, PageStore } from "@/stores/page-store";
import { ServerSettingStore } from "@/stores/settings-store";

const log = childLogger("publish-backfill");

/**
 * When the boot pass ran. It is recorded because the pass must happen **once**, on the upgrade that removed the
 * reader's fallback to a burn — not on every start.
 *
 * After that upgrade, "a chapter page with a fresh render and no snapshot" stops meaning "a page from before
 * publishing existed" and starts meaning "work somebody has deliberately not published yet". Re-running the pass at
 * each boot would publish that work behind their back, which is the opposite of what the publish gate is for.
 */
const RAN_AT_KEY = "publish_backfill_at";

export interface BackfillReport {
  /** Pages that now have a published snapshot they didn't have before. */
  published: string[];
  /** Pages that couldn't be published, with why; the rest of the run carries on. */
  failed: { pageId: string; error: string }[];
}

/** When the one-time pass ran, or null when it hasn't. */
export async function backfillRanAt(): Promise<string | null> {
  return (await ServerSettingStore.get(RAN_AT_KEY)) ?? null;
}

/**
 * Runs the pass once per server, on the first start after this upgrade. The stamp is written whatever the outcome:
 * pages that failed are reported in the admin area, where somebody can run it again deliberately, and that is a
 * better answer than a pass that quietly republishes held-back work every morning.
 */
export async function backfillOnce(): Promise<BackfillReport | null> {
  if ((await backfillRanAt()) !== null) return null;
  try {
    return await backfillPublishes();
  } finally {
    await ServerSettingStore.set(RAN_AT_KEY, new Date().toISOString());
  }
}

/**
 * Pages the pass would leave behind: a chapter page holding a burn nobody published, which can't be published as it
 * stands. Shown in the admin area so a stale render is something an admin can see and re-render, rather than a page
 * that quietly shows its original to readers.
 */
export async function pagesBlockedFromPublish(): Promise<{ pageId: string; reason: string }[]> {
  const blocked: { pageId: string; reason: string }[] = [];
  for (const page of await PageStore.listAllInChapters()) {
    if (publishedFile(page.id) !== null) continue;
    if (!existsSync(join(pageDir(page.id), "result.png"))) continue;
    const reason = publishBlocker(page, await PageStore.listStages(page.id));
    if (reason !== null) blocked.push({ pageId: page.id, reason });
  }
  return blocked;
}

/**
 * Chapter pages holding a burn that was never published, and that are fit to publish.
 *
 * Fitness is `publishBlocker`, the same rule filing a workspace and the publish routes use, so all three agree: a
 * page still being translated, or whose render went stale after a later edit, is left alone. Filing deliberately
 * moves such a page into its chapter unpublished, and this must not undo that by publishing the stale render.
 *
 * A page can belong to a chapter and to a workspace at once — filing keeps `workspaceId` set, because the page is
 * still being worked on there while readers are served it — so membership is not the test; fitness is.
 *
 * Studio drafts are never reached here, and shouldn't be: a draft is loose (no chapter) and publishes over its
 * origin rather than over itself, so `listAllInChapters` excluding it is the point, not an oversight.
 */
export async function pagesNeedingPublish(): Promise<string[]> {
  const filed = await PageStore.listAllInChapters();
  const needed: string[] = [];
  for (const page of filed) {
    if (publishedFile(page.id) !== null) continue;
    // One query per candidate; this runs once per library, at boot or from a button, so clarity wins over batching
    if (publishBlocker(page, await PageStore.listStages(page.id)) !== null) continue;
    needed.push(page.id);
  }
  return needed;
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
      // Checked again under the lock: a normal publish, or an edit that stales the render, may have landed since
      // the list was taken
      const done = await withPageLock(pageId, async () => {
        const page = await PageStore.findById(pageId);
        if (!page) return false;
        if (publishedFile(pageId) !== null) return false;
        if (publishBlocker(page, await PageStore.listStages(pageId)) !== null) return false;
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
