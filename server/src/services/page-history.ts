import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
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

/** Copies result.png as the snapshot of `revision`. Pruning is separate, so a publish that fails loses nothing. */
export async function snapshotResult(pageId: string, revision: number): Promise<void> {
  await mkdir(historyDir(pageId), { recursive: true });
  await copyFile(join(pageDir(pageId), "result.png"), historyFile(pageId, revision));
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
  const result = join(pageDir(pageId), "result.png");
  if (!existsSync(result)) return false;
  const published = publishedFile(pageId);
  if (!published) return true;
  try {
    return statSync(result).mtimeMs > statSync(published).mtimeMs;
  } catch {
    return false;
  }
}
