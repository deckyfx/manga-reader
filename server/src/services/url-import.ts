/**
 * Filing images into a chapter from a list of addresses, rather than from uploads.
 *
 * The downloading is the only new part: each address goes through `fetchImage`, which pins DNS and refuses private
 * networks, and the bytes then take exactly the same path as an upload (`importIntoChapter`). So an address that
 * fails is a skipped entry in the report, like an unreadable file, rather than a failed request.
 */
import { childLogger } from "@/lib/logger";
import { IMAGE_EXTENSIONS, importIntoChapter, type ImportReport, type ImportSource } from "@/services/chapter-import";
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
 * What came back from importing a list of addresses. A skipped entry carries the address it came from, not just the
 * name it would have been filed under: names are derived from the path, so two addresses can share one, and an
 * extensionless address is filed under a name that doesn't look like it. Anything offering to retry the failures has
 * to know exactly which addresses failed.
 */
export interface UrlImportReport {
  pages: { id: string; name: string }[];
  skipped: { url: string | null; name: string; reason: string }[];
}

export interface UrlWorkspaceImportReport {
  pages: { id: string; name: string; index: number }[];
  existing: number[];
  skipped: { url: string | null; name: string; index: number; reason: string }[];
}

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

/**
 * The name an imported page is filed under, always ending in an image extension.
 *
 * `importIntoChapter` gates on the name's extension, because an upload's name is all it has to go on before it
 * opens the bytes — but plenty of image addresses have no extension at all (`/image`, `/download?id=5`). Without
 * this they'd be filed as "not an image or archive" despite being perfectly good downloads. The extension is
 * dropped again when the page is named, so nothing shows it.
 */
export function importNameFor(url: string): string {
  const name = nameFromUrl(url);
  return IMAGE_EXTENSIONS.test(name) ? name : `${name}.png`;
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
): Promise<UrlImportReport> {
  const report: UrlImportReport = { pages: [], skipped: [] };

  for (const url of urls.slice(0, MAX_URLS_PER_IMPORT)) {
    const name = importNameFor(url);
    try {
      const source: ImportSource = { name, bytes: new Uint8Array(await download(url)), source: url };
      // Stored before the next download starts, so fifty pages never sit in memory at once — at 15 MB each that
      // would be most of a gigabyte. `importIntoChapter` appends, so filing one at a time keeps the order given
      const part = await importIntoChapter(chapterId, [source]);
      report.pages.push(...part.pages);
      report.skipped.push(...part.skipped.map((entry) => ({ ...entry, url })));
    } catch (err) {
      const reason = err instanceof Error ? err.message : "could not be downloaded";
      log.warn({ err, url }, "A page address could not be downloaded");
      report.skipped.push({ url, name: nameFromUrl(url), reason });
    }
  }

  for (const url of urls.slice(MAX_URLS_PER_IMPORT)) {
    report.skipped.push({ url, name: nameFromUrl(url), reason: `more than ${MAX_URLS_PER_IMPORT} addresses in one import` });
  }
  return report;
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
): Promise<UrlWorkspaceImportReport> {
  const report: UrlWorkspaceImportReport = { pages: [], existing: [], skipped: [] };

  for (const [offset, url] of urls.slice(0, MAX_URLS_PER_IMPORT).entries()) {
    const index = startIndex + offset;
    const name = importNameFor(url);
    try {
      const upload: WorkspaceUpload = { name, bytes: new Uint8Array(await download(url)), source: url };
      // Stored at its own position before the next download starts: nothing accumulates in memory, and an address
      // that fails leaves its position free rather than shifting the pages after it up by one, so retrying the same
      // list fills the gap
      const part = await importIntoWorkspace(workspaceId, index, [upload]);
      report.pages.push(...part.pages);
      report.existing.push(...part.existing);
      report.skipped.push(...part.skipped.map((entry) => ({ ...entry, url })));
    } catch (err) {
      const reason = err instanceof Error ? err.message : "could not be downloaded";
      log.warn({ err, url }, "A page address could not be downloaded");
      report.skipped.push({ url, name: nameFromUrl(url), index, reason });
    }
  }

  for (const [offset, url] of urls.slice(MAX_URLS_PER_IMPORT).entries()) {
    report.skipped.push({
      url,
      name: nameFromUrl(url),
      index: startIndex + MAX_URLS_PER_IMPORT + offset,
      reason: `more than ${MAX_URLS_PER_IMPORT} addresses in one import`,
    });
  }
  return report;
}
