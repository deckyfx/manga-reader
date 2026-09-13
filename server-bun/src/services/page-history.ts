import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
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

/** Copies result.png as the snapshot of `revision`, then drops snapshots beyond HISTORY_LIMIT. */
export async function snapshotResult(pageId: string, revision: number): Promise<void> {
  await mkdir(historyDir(pageId), { recursive: true });
  await copyFile(join(pageDir(pageId), "result.png"), historyFile(pageId, revision));
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
