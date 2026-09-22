/**
 * Finalizing a page: removing what it took to make it, keeping what it made.
 *
 * A translated page carries its whole working state — masks, overlays, crops, cleaned passes, patches, stage state,
 * blocks and a publish history — long after anyone will edit it again. Finalizing deletes all of that and keeps the
 * final image: the published snapshot readers are served (for a page that has been published) and result.png, plus
 * the original unless asked to delete it too.
 *
 * - Original kept: the page can be redone — "Run again" rebuilds every stage from original.png — and it stays matched
 *   by image hash, so the extension still finds it.
 * - Original deleted: read-only for good. Nothing can rebuild it, so edits, re-runs and publishes are refused, and it
 *   is no longer matched by hash: the same image sent again starts a new page.
 *
 * Decided with the user on 2026-09-14 (TODO.txt). Two guards are added so a reader never loses an image: a page with
 * work it hasn't published is refused (publish or roll back first — otherwise the final image would be a guess), and
 * so is a chapter page that was never published (readers are served published snapshots, and there would be none).
 */
import { readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { childLogger } from "@/lib/logger";
import { hasUnpublishedEdits, historyFile } from "@/services/page-history";
import { pageDir, PageStore } from "@/stores/page-store";
import type { Page } from "@/db/schema";

const log = childLogger("page-finalize");

export type FinalizePlan =
  | { ok: true; files: string[]; bytes: number }
  | { ok: false; reason: string };

/** Every file under `dir`, as paths relative to it. */
async function walk(dir: string, base = dir): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path, base)));
    else files.push(relative(base, path));
  }
  return files;
}

/** Why this page can't be finalized as asked, or null. */
export function finalizeBlocker(page: Page, deleteRaw: boolean): string | null {
  if (page.status === "queued" || page.status === "running") return "it is still being translated";
  if (page.finalizedAt !== null) {
    if (page.rawDeleted) return "it is already finalized";
    // Finalized with the original kept: the only thing left to do is delete that too
    if (!deleteRaw) return "it is already finalized";
    return null;
  }
  if (!existsSync(join(pageDir(page.id), "result.png"))) return "it has no finished image yet";
  if (page.chapterId !== null && page.revision === 0) return "it has never been published, and readers are only served published pages";
  // A page that has been published — or a draft, which publishes over its chapter page — mustn't be frozen with work
  // readers haven't got: a finalized page can't publish any more, so that work would never reach them
  if ((page.revision > 0 || page.originPageId !== null) && hasUnpublishedEdits(page)) {
    return "it has edits nobody has published — publish or roll them back first";
  }
  return null;
}

/**
 * What finalizing would delete and how much space that frees, without deleting anything: the confirmation dialog shows
 * it, and `finalizePage` carries out exactly this plan.
 */
export async function planFinalize(page: Page, deleteRaw: boolean): Promise<FinalizePlan> {
  const blocker = finalizeBlocker(page, deleteRaw);
  if (blocker) return { ok: false, reason: blocker };
  const dir = pageDir(page.id);
  const keep = new Set(["result.png"]);
  if (!deleteRaw) keep.add("original.png");
  // The snapshot readers are served; older ones are rollbacks nobody can make once the working state is gone
  if (page.revision > 0) keep.add(relative(dir, historyFile(page.id, page.revision)));
  const files = (await walk(dir)).filter((file) => !keep.has(file)).sort();
  let bytes = 0;
  for (const file of files) bytes += (await stat(join(dir, file)).catch(() => null))?.size ?? 0;
  return { ok: true, files, bytes };
}

/**
 * Finalizes a page as planned. Call under the page's lock, with a fresh row: the plan is taken again here so it can't
 * act on a page that changed since the dialog showed it.
 */
export async function finalizePage(page: Page, deleteRaw: boolean): Promise<FinalizePlan> {
  const plan = await planFinalize(page, deleteRaw);
  if (!plan.ok) return plan;
  // The row first: once it says finalized, nothing will try to use the working state being removed
  await PageStore.markFinalized(page.id, deleteRaw);
  const dir = pageDir(page.id);
  for (const file of plan.files) {
    await rm(join(dir, file), { recursive: true, force: true }).catch((err: unknown) =>
      log.warn({ err, pageId: page.id, file }, "Couldn't remove a finalized page's file"));
  }
  // Empty folders left by removed files (crops/, patches/, history/ when nothing was published)
  for (const folder of ["crops", "patches", "history"]) {
    const path = join(dir, folder);
    if (existsSync(path) && (await readdir(path)).length === 0) await rm(path, { recursive: true, force: true });
  }
  log.info({ pageId: page.id, deleteRaw, files: plan.files.length, bytes: plan.bytes }, "Page finalized");
  return plan;
}
