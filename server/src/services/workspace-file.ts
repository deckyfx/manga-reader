/**
 * Filing a workspace into the library: its pages move into a chapter, in workspace order, and the ones that have
 * been translated are published so readers get them. The workspace stays, now bound to that chapter, which is what
 * makes later edits follow the draft rules rather than piling up new copies.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { childLogger } from "@/lib/logger";
import { withPageLock, withWorkspaceLock } from "@/queue/page-queue";
import { batchRun } from "@/services/page-batch";
import { publishBlocker } from "@/services/draft-publish";
import { publishPage } from "@/services/page-publish";
import { pageDir, PageStore } from "@/stores/page-store";
import { WorkspaceStore } from "@/stores/workspace-store";

const log = childLogger("workspace-file");

/** Filing either ran, or was refused because the workspace is busy. */
export type FileResult = { ok: true; report: FileReport } | { ok: false; error: string };

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
export function fileWorkspaceIntoChapter(workspaceId: number, chapterId: number): Promise<FileResult> {
  return withWorkspaceLock(workspaceId, async () => {
    // Checked inside the lock, where a run can't start: filing under a run would move and publish pages the run is
    // still translating, and a run publishes nothing itself
    if (batchRun(`workspace:${workspaceId}`)?.running) {
      return { ok: false as const, error: "this workspace is being translated — wait for the run to finish" };
    }
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
      // Only what the publish route would allow, decided under the page's lock so an edit landing meanwhile can't
      // slip an outdated render past the check
      if (!existsSync(join(pageDir(page.id), "result.png"))) continue;
      try {
        const blocked = await withPageLock(page.id, async () => {
          const current = await PageStore.findById(page.id);
          if (!current) return "the page is gone";
          const blocker = publishBlocker(current, await PageStore.listStages(page.id));
          if (blocker) return blocker;
          await publishPage(page.id);
          return null;
        });
        if (blocked) report.skipped.push({ pageId: page.id, reason: `moved, not published: ${blocked}` });
        else report.published++;
      } catch (err) {
        log.warn({ err, pageId: page.id, chapterId }, "Couldn't publish a filed page");
        report.skipped.push({ pageId: page.id, reason: "moved, but publishing failed" });
      }
    }

    await WorkspaceStore.update(workspaceId, { chapterId });
    log.info({ workspaceId, chapterId, ...report, skipped: report.skipped.length }, "Filed a workspace into a chapter");
    return { ok: true as const, report };
  });
}
