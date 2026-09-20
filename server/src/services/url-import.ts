/**
 * Filing images into a chapter from a list of addresses, rather than from uploads.
 *
 * The downloading is the only new part: each address goes through `fetchImage`, which pins DNS and refuses private
 * networks, and the bytes then take exactly the same path as an upload (`importIntoChapter`). So an address that
 * fails is a skipped entry in the report, like an unreadable file, rather than a failed request.
 */
import { childLogger } from "@/lib/logger";
import { importIntoChapter, type ImportReport, type ImportSource } from "@/services/chapter-import";
import { fetchImage } from "@/services/image-fetch";
import { importIntoWorkspace, type WorkspaceImportReport, type WorkspaceUpload } from "@/services/workspace-import";

const log = childLogger("url-import");

/** Addresses accepted in one request. Each one is a download, so a long list is a long wait. */
export const MAX_URLS_PER_IMPORT = 50;

/**
 * How an address is turned into bytes. Production always uses `fetchImage`, which pins DNS and refuses private
 * networks; tests pass their own, because that guard blocks a local test server by design — and rightly so.
 */
export type Download = (url: string) => Promise<Buffer>;

/**
 * Trims, drops blanks, and keeps the first of any address given twice, in the order given.
 *
 * A list pasted from a reader often repeats an address — a page shown twice, a preview alongside the full image —
 * and each repeat would otherwise become its own page. The first occurrence is the one that keeps its position.
 */
export function tidyUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const tidy: string[] = [];
  for (const raw of urls) {
    const url = raw.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    tidy.push(url);
  }
  return tidy;
}

/** A readable page name from an address: its file name, else its last path segment, else the host. */
export function nameFromUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const last = url.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url.hostname;
  } catch {
    return raw.slice(0, 80);
  }
}

/**
 * Downloads each address in order and files what arrives into the chapter. Order is the order given, which is the
 * order somebody pasted their pages in; downloading them one at a time keeps that true and is politer to the host
 * than firing fifty requests at once.
 */
export async function importUrlsIntoChapter(
  chapterId: number,
  urls: readonly string[],
  download: Download = fetchImage,
): Promise<ImportReport> {
  const sources: ImportSource[] = [];
  const failed: { name: string; reason: string }[] = [];

  for (const url of urls.slice(0, MAX_URLS_PER_IMPORT)) {
    const name = nameFromUrl(url);
    try {
      sources.push({ name, bytes: new Uint8Array(await download(url)), source: url });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "could not be downloaded";
      log.warn({ err, url }, "A page address could not be downloaded");
      failed.push({ name, reason });
    }
  }

  for (const url of urls.slice(MAX_URLS_PER_IMPORT)) {
    failed.push({ name: nameFromUrl(url), reason: `more than ${MAX_URLS_PER_IMPORT} addresses in one import` });
  }

  const report = await importIntoChapter(chapterId, sources);
  // The downloads that never happened are skipped entries too: one report, whatever went wrong
  return { pages: report.pages, skipped: [...failed, ...report.skipped] };
}

/**
 * The same into a Studio workspace, keeping each page's position so a retried list doesn't add anything twice.
 *
 * An address that fails to download still takes its position: the pages that follow keep the numbers they would have
 * had, so retrying the same list fills the gap rather than shifting everything up by one.
 */
export async function importUrlsIntoWorkspace(
  workspaceId: number,
  startIndex: number,
  urls: readonly string[],
  download: Download = fetchImage,
): Promise<WorkspaceImportReport> {
  const report: WorkspaceImportReport = { pages: [], existing: [], skipped: [] };
  /** Downloads waiting to be stored, and where the first of them belongs. */
  let run: WorkspaceUpload[] = [];
  let runStart = startIndex;

  const flush = async (): Promise<void> => {
    if (run.length === 0) return;
    const part = await importIntoWorkspace(workspaceId, runStart, run);
    report.pages.push(...part.pages);
    report.existing.push(...part.existing);
    report.skipped.push(...part.skipped);
    run = [];
  };

  for (const [offset, url] of urls.slice(0, MAX_URLS_PER_IMPORT).entries()) {
    const index = startIndex + offset;
    const name = nameFromUrl(url);
    try {
      const bytes = new Uint8Array(await download(url));
      if (run.length === 0) runStart = index;
      run.push({ name, bytes, source: url });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "could not be downloaded";
      log.warn({ err, url }, "A page address could not be downloaded");
      // What downloaded before this one is stored now, so the failure leaves a gap at its own position rather than
      // shifting every page after it up by one. Retrying the same list then fills the gap.
      await flush();
      report.skipped.push({ name, index, reason });
    }
  }
  await flush();

  for (const [offset, url] of urls.slice(MAX_URLS_PER_IMPORT).entries()) {
    report.skipped.push({
      name: nameFromUrl(url),
      index: startIndex + MAX_URLS_PER_IMPORT + offset,
      reason: `more than ${MAX_URLS_PER_IMPORT} addresses in one import`,
    });
  }
  return report;
}
