/**
 * Appending uploaded images to a Studio workspace. The extension downloads a chapter's images itself and uploads them
 * in batches, each batch saying where it starts (`startIndex`), so a batch retried after a dropped connection skips the
 * positions that already hold a page instead of adding them twice.
 */
import { childLogger } from "@/lib/logger";
import { withWorkspaceLock } from "@/queue/page-queue";
import { baseName, MAX_PAGES_PER_IMPORT, storePageImage, type ImportSource } from "@/services/chapter-import";
import { MAX_IMAGE_BYTES } from "@/services/page-jobs";
import { PageStore } from "@/stores/page-store";
import { WorkspaceStore } from "@/stores/workspace-store";

const log = childLogger("workspace-import");

/** One uploaded image and, when the uploader knows it, the URL it came from. */
export interface WorkspaceUpload extends ImportSource {
  source?: string;
}

export interface WorkspaceImportReport {
  /** Pages stored by this call, with their 0-based position in the workspace. */
  pages: { id: string; name: string; index: number }[];
  /** Positions that already held a page (an earlier attempt of the same batch), left as they were. */
  existing: number[];
  /** Images refused, with why. */
  skipped: { name: string; index: number; reason: string }[];
}

/**
 * Stores `uploads` as the workspace's pages at positions `startIndex`, `startIndex + 1`, … in that order. A page's
 * `sortOrder` is its position + 1, as chapter pages count from 1.
 */
export function importIntoWorkspace(workspaceId: number, startIndex: number, uploads: readonly WorkspaceUpload[]): Promise<WorkspaceImportReport> {
  return withWorkspaceLock(workspaceId, async () => {
    const report: WorkspaceImportReport = { pages: [], existing: [], skipped: [] };
    const taken = await WorkspaceStore.takenPositions(workspaceId, uploads.map((_, offset) => startIndex + offset + 1));
    let total = await WorkspaceStore.pageCount(workspaceId);

    for (const [offset, upload] of uploads.entries()) {
      const index = startIndex + offset;
      if (taken.has(index + 1)) {
        report.existing.push(index);
        continue;
      }
      if (total >= MAX_PAGES_PER_IMPORT) {
        report.skipped.push({ name: upload.name, index, reason: `a workspace holds at most ${MAX_PAGES_PER_IMPORT} pages` });
        continue;
      }
      if (upload.bytes.byteLength > MAX_IMAGE_BYTES) {
        report.skipped.push({ name: upload.name, index, reason: "image too large (max 15 MB)" });
        continue;
      }
      const name = baseName(upload.name);
      const page = await storePageImage(upload, (imageHash) =>
        PageStore.createInWorkspace(imageHash, upload.source ?? "import", workspaceId, index + 1, name));
      if (!page) {
        report.skipped.push({ name: upload.name, index, reason: "not an image, or it could not be stored" });
        continue;
      }
      total++;
      report.pages.push({ id: page.id, name, index });
    }

    if (report.pages.length > 0) await WorkspaceStore.touch(workspaceId);
    log.info({ workspaceId, startIndex, imported: report.pages.length, existing: report.existing.length, skipped: report.skipped.length }, "Imported pages into workspace");
    return report;
  });
}
