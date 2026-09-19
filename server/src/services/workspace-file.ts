/**
 * Filing a workspace into the library: its pages move into a chapter, in workspace order, and the ones that have
 * been translated are published so readers get them. The workspace stays, now bound to that chapter, which is what
 * makes later edits follow the draft rules rather than piling up new copies.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { childLogger } from "@/lib/logger";
import { withPageLock, withWorkspaceLock } from "@/queue/page-queue";
import { publishBlocker } from "@/services/draft-publish";
import { publishPage } from "@/services/page-publish";
import { pageDir, PageStore } from "@/stores/page-store";
import { WorkspaceStore } from "@/stores/workspace-store";

const log = childLogger("workspace-file");

export interface FileReport {
  /** Pages moved into the chapter. */
  filed: number;
  /** Of those, the ones published (they had a burnt result). */
  published: number;
  /** Pages left where they were, with why. */
  skipped: { pageId: string; reason: string }[];
}

/**
 * Moves every page of the workspace into `chapterId`, appended after what is already there, and publishes each one
 * that has a result. A page still in the pipeline is left alone, so nothing is moved mid-run.
 */
export function fileWorkspaceIntoChapter(workspaceId: number, chapterId: number): Promise<FileReport> {
  return withWorkspaceLock(workspaceId, async () => {
    const report: FileReport = { filed: 0, published: 0, skipped: [] };
    const pages = await WorkspaceStore.pages(workspaceId);
    let order = await PageStore.maxSortOrder(chapterId);

    for (const page of pages) {
      if (page.status === "queued" || page.status === "running") {
        report.skipped.push({ pageId: page.id, reason: "still being translated" });
        continue;
      }
      // The page itself moves: the workspace keeps showing it, now as a page of the chapter
      await PageStore.filePage(page.id, { chapterId, sortOrder: ++order });
      report.filed++;
      // Only what the publish route would allow: no result, or a render made stale by a later edit, means the page
      // waits to be run and published rather than showing readers an image that isn't current
      if (!existsSync(join(pageDir(page.id), "result.png"))) continue;
      const blocker = publishBlocker(page, await PageStore.listStages(page.id));
      if (blocker) {
        report.skipped.push({ pageId: page.id, reason: `moved, not published: ${blocker}` });
        continue;
      }
      try {
        await withPageLock(page.id, () => publishPage(page.id));
        report.published++;
      } catch (err) {
        log.warn({ err, pageId: page.id, chapterId }, "Couldn't publish a filed page");
        report.skipped.push({ pageId: page.id, reason: "moved, but publishing failed" });
      }
    }

    await WorkspaceStore.update(workspaceId, { chapterId });
    log.info({ workspaceId, chapterId, ...report, skipped: report.skipped.length }, "Filed a workspace into a chapter");
    return report;
  });
}
