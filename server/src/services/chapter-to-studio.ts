/**
 * Sending a chapter to the Studio to be worked on.
 *
 * The Studio works on *copies*: each chapter page gets a loose draft in a workspace, pointing back at the page it
 * came from (`originPageId`). The chapter keeps serving its own pages until a draft is published, and publishing a
 * draft copies its result over the origin — so readers never see a half-edited chapter, and the origin keeps its
 * publish history to roll back to.
 *
 * Sending again reuses the chapter's workspace and only copies pages that have no draft yet, so work in progress is
 * never overwritten.
 */
import { childLogger } from "@/lib/logger";
import { withChapterLock, withPageLock, withWorkspaceLock } from "@/queue/page-queue";
import { copyPageAsDraft } from "@/services/page-copy";
import { PageStore } from "@/stores/page-store";
import { WorkspaceStore } from "@/stores/workspace-store";
import type { Chapter, Workspace } from "@/db/schema";

const log = childLogger("chapter-to-studio");

export interface SendReport {
  workspace: Workspace;
  /** Drafts made by this call. */
  copied: number;
  /** Chapter pages that already had a draft, left as they are. */
  existing: number;
  /** Pages not copied, with why. */
  skipped: { pageId: string; reason: string }[];
}

/**
 * Makes (or extends) the chapter's workspace with a draft per chapter page. `createdBy` is who asked, so the
 * workspace shows an owner.
 */
export async function sendChapterToStudio(chapter: Chapter, createdBy: number | null): Promise<SendReport> {
  // Find-or-create under one lock per chapter: two sends at once would otherwise each make a workspace
  const workspace = await withChapterLock(chapter.id, async () => {
    const existing = await WorkspaceStore.findByChapter(chapter.id);
    return existing ?? WorkspaceStore.create({
      name: chapter.title,
      chapterId: chapter.id,
      createdBy,
      sourceUrl: null,
      sourceProvider: null,
      adult: false,
    });
  });

  return withWorkspaceLock(workspace.id, async () => {
    const report: SendReport = { workspace, copied: 0, existing: 0, skipped: [] };
    const [pages, alreadyDrafted] = await Promise.all([
      PageStore.listByChapter(chapter.id),
      WorkspaceStore.draftOrigins(workspace.id),
    ]);
    // Past every position in use, not the count: a deleted page leaves a gap, and two drafts must not share an order
    let order = (await WorkspaceStore.pages(workspace.id)).reduce((highest, page) => Math.max(highest, page.sortOrder), 0);

    for (const page of pages) {
      // A page of this workspace that was filed into the chapter needs no draft: it is already being worked on here
      if (alreadyDrafted.has(page.id) || page.workspaceId === workspace.id) {
        report.existing++;
        continue;
      }
      if (page.status === "queued" || page.status === "running") {
        report.skipped.push({ pageId: page.id, reason: "still being translated" });
        continue;
      }
      // Its working state is gone, so a draft of it would have nothing to edit
      if (page.finalizedAt !== null) {
        report.skipped.push({ pageId: page.id, reason: page.rawDeleted ? "finalized without its original" : "finalized — redo it first" });
        continue;
      }
      try {
        // Under the source's lock, so a copy is never taken while that page is being edited — and re-read there,
        // since a run finishing since the listing changes its size, status and images
        const copied = await withPageLock(page.id, async () => {
          const current = await PageStore.findById(page.id);
          if (!current || current.chapterId !== chapter.id) return false;
          if (current.status === "queued" || current.status === "running") return false;
          await copyPageAsDraft(current, workspace.id, ++order);
          return true;
        });
        if (copied) report.copied++;
        else report.skipped.push({ pageId: page.id, reason: "changed while it was being copied" });
      } catch (err) {
        log.warn({ err, pageId: page.id, chapterId: chapter.id }, "Couldn't copy a chapter page into the Studio");
        report.skipped.push({ pageId: page.id, reason: "could not be copied" });
      }
    }

    if (report.copied > 0) await WorkspaceStore.touch(workspace.id);
    log.info({ chapterId: chapter.id, workspaceId: workspace.id, copied: report.copied, existing: report.existing }, "Sent a chapter to the Studio");
    return report;
  });
}
