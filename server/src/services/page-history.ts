import { copyFile, mkdir, readdir, rm, stat, utimes } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pageDir } from "@/stores/page-store";

/** Published results kept per page; older snapshots are deleted on publish. */
export const HISTORY_LIMIT = 10;

export interface HistoryEntry {
  revision: number;
  /** When the snapshot was taken (ISO 8601). */
  published_at: string;
}

const historyDir = (pageId: string): string => join(pageDir(pageId), "history");

/** Path of a revision's snapshot image. */
export const historyFile = (pageId: string, revision: number): string => join(historyDir(pageId), `${revision}.png`);

/** Snapshots of earlier publishes, newest first. */
export async function listHistory(pageId: string): Promise<HistoryEntry[]> {
  let files: string[];
  try {
    files = await readdir(historyDir(pageId));
  } catch {
    return [];
  }
  const revisions = files
    .map((f) => /^(\d+)\.png$/.exec(f)?.[1])
    .filter((rev): rev is string => rev !== undefined)
    .map(Number)
    .sort((a, b) => b - a);
  return Promise.all(revisions.map(async (revision) => ({
    revision,
    published_at: (await stat(historyFile(pageId, revision))).mtime.toISOString(),
  })));
}

/**
 * Copies result.png as the snapshot of `revision`. Pruning is separate, so a publish that fails loses nothing.
 *
 * `keepTime` gives the snapshot the burn's own modification time instead of now. Whether a draft has work its
 * chapter page hasn't published is decided by comparing those times (see `hasUnpublishedEditsAgainst`), so a publish
 * that records an *old* burn — the backfill — has to say when that burn was made. Stamping it "now" would date a
 * two-week-old result later than a draft rendered yesterday, and that draft's edits would stop being offered.
 */
export async function snapshotResult(pageId: string, revision: number, { keepTime = false } = {}): Promise<void> {
  await mkdir(historyDir(pageId), { recursive: true });
  const source = join(pageDir(pageId), "result.png");
  const target = historyFile(pageId, revision);
  await copyFile(source, target);
  if (keepTime) {
    const { atime, mtime } = await stat(source);
    await utimes(target, atime, mtime);
  }
}

/** Drops snapshots beyond HISTORY_LIMIT. Call once the revision they belong to is committed. */
export async function pruneHistory(pageId: string): Promise<void> {
  const expired = (await listHistory(pageId)).slice(HISTORY_LIMIT);
  await Promise.all(expired.map((entry) => rm(historyFile(pageId, entry.revision), { force: true })));
}

/** Puts a snapshot back as result.png; false when that revision isn't kept any more. */
export async function restoreResult(pageId: string, revision: number): Promise<boolean> {
  const source = Bun.file(historyFile(pageId, revision));
  if (!(await source.exists())) return false;
  await copyFile(historyFile(pageId, revision), join(pageDir(pageId), "result.png"));
  return true;
}

/** The revisions this page has published, newest first. */
function publishedRevisions(pageId: string): number[] {
  try {
    return readdirSync(historyDir(pageId))
      .map((file) => /^(\d+)\.png$/.exec(file)?.[1])
      .filter((revision): revision is string => revision !== undefined)
      .map(Number)
      .sort((a, b) => b - a);
  } catch {
    return [];
  }
}

/**
 * The newest published snapshot of a page, or null when it has never been published. This is what readers are served:
 * burning in the Studio rewrites result.png, but nothing reaches the reader until it is published.
 */
export function publishedFile(pageId: string): string | null {
  const [revision] = publishedRevisions(pageId);
  if (revision === undefined) return null;
  const file = historyFile(pageId, revision);
  return existsSync(file) ? file : null;
}

/** True when result.png holds work that has not been published: newer than the last snapshot, or never published. */
export function hasUnpublishedEdits(pageId: string): boolean {
  return hasUnpublishedEditsAgainst(pageId, pageId);
}

/**
 * Whether `resultPageId`'s burnt result is newer than what `publishedPageId` last published. The two differ for a
 * draft of a chapter page: its work is unpublished until it has been copied over that page and published there.
 */
export function hasUnpublishedEditsAgainst(resultPageId: string, publishedPageId: string): boolean {
  const result = join(pageDir(resultPageId), "result.png");
  if (!existsSync(result)) return false;
  const published = publishedFile(publishedPageId);
  if (!published) return true;
  try {
    return statSync(result).mtimeMs > statSync(published).mtimeMs;
  } catch {
    return false;
  }
}
