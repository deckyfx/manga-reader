/**
 * Publishing a Studio draft. A plain draft publishes itself. A draft made by "send chapter to the Studio" carries
 * `originPageId`: its result, stage state and blocks are copied over that chapter page, and the chapter page is what
 * gets published — so the chapter's own publish history stays intact and can still be rolled back, and the draft
 * stays in the workspace to be edited and published again.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { childLogger } from "@/lib/logger";
import { withPageLock } from "@/queue/page-queue";
import { copyPageImages } from "@/services/page-copy";
import { publishPage } from "@/services/page-publish";
import { pageDir, PageStore } from "@/stores/page-store";
import type { Page } from "@/db/schema";

const log = childLogger("draft-publish");

export type PublishOutcome =
  | { ok: true; revision: number; notified: number; pageId: string }
  | { ok: false; code: 404 | 409; error: string };

/** Why this page can't be published right now, or null. */
export function publishBlocker(page: Page, stages: { stage: string; status: string }[]): string | null {
  if (page.status === "queued" || page.status === "running") return "page is still being translated";
  if (!existsSync(join(pageDir(page.id), "result.png"))) return "page has no result to publish";
  // An edit saved after the last render would otherwise publish an image without it
  if (stages.some((s) => s.stage === "render" && s.status === "stale")) {
    return "the page changed since it was last rendered — re-render before publishing";
  }
  return null;
}

/**
 * Publishes `draft`. The caller already holds the draft's page lock; the origin's lock is taken here, in that order
 * everywhere, so the two can't deadlock.
 */
export async function publishDraft(draft: Page): Promise<PublishOutcome> {
  if (draft.originPageId === null) {
    const { revision, notified } = await publishPage(draft.id);
    return { ok: true, revision, notified, pageId: draft.id };
  }

  const origin = await PageStore.findById(draft.originPageId);
  // The chapter page is gone: the draft is orphaned, and can only be filed as a new page
  if (!origin) return { ok: false, code: 409, error: "the page this draft replaces has been deleted — file it as a new page instead" };

  return withPageLock(origin.id, async () => {
    if (origin.status === "queued" || origin.status === "running") {
      return { ok: false, code: 409, error: "the chapter page is still being translated" };
    }
    await PageStore.update(origin.id, {
      width: draft.width,
      height: draft.height,
      status: "done",
      cleanSfx: draft.cleanSfx,
    });
    await copyPageImages(draft.id, origin.id);
    await PageStore.copyStagesAndBlocks(draft.id, origin.id);
    const { revision, notified } = await publishPage(origin.id);
    log.info({ draftId: draft.id, originPageId: origin.id, revision }, "Published a draft over its chapter page");
    return { ok: true, revision, notified, pageId: origin.id };
  });
}
