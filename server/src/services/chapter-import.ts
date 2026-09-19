/**
 * Filing images into a chapter: plain images or ZIP / CBZ archives. Each page is normalised and stored exactly like a
 * translated page (`<page id>/original.png`), so the pipeline can run over it later without re-uploading anything.
 * Imported pages start idle with no stages; a chapter batch run (or "run again" in the Studio) translates them.
 */
import sharp from "sharp";
import { unzip, type Unzipped } from "fflate";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { childLogger } from "@/lib/logger";
import { MAX_IMAGE_BYTES } from "@/services/page-jobs";
import { normalisePage } from "@/services/page-pipeline";
import { pageDir, PageStore } from "@/stores/page-store";
import type { Page } from "@/db/schema";

const log = childLogger("chapter-import");

/** Archives expand in memory, so cap what one import may hold. */
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
/** Pages accepted in a single import, so one bad archive can't fill the disk. */
export const MAX_PAGES_PER_IMPORT = 500;
export const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|avif|tiff?)$/i;
const ARCHIVE_EXTENSIONS = /\.(zip|cbz)$/i;

export interface ImportSource {
  name: string;
  bytes: Uint8Array;
}

export interface ImportedPage {
  id: string;
  name: string;
}

export interface ImportReport {
  pages: ImportedPage[];
  /** Entries left out, with why (not an image, too large, unreadable). */
  skipped: { name: string; reason: string }[];
}

/** Filename without its directory or extension, for the page name. */
export const baseName = (path: string): string => {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.[^.]+$/, "");
};

/** Hidden files, macOS resource forks and directory entries carry no pages. */
const isJunk = (path: string): boolean =>
  path.endsWith("/") || path.includes("__MACOSX/") || (path.split("/").pop() ?? "").startsWith(".");

/** Sorts like a person reads file names: page2 before page10, ties broken by the full path. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Expands only the image entries of an archive, and only while the import's size budget lasts: the filter runs on each
 * entry's declared uncompressed size, so an archive that would inflate past the cap is never decompressed.
 */
function unzipImages(bytes: Uint8Array, budget: { remaining: number }, skipped: { name: string; reason: string }[]): Promise<Unzipped> {
  let ignored = 0;
  return new Promise((resolve, reject) => {
    unzip(
      bytes,
      {
        filter: (file) => {
          if (isJunk(file.name)) return false;
          if (!IMAGE_EXTENSIONS.test(file.name)) {
            ignored++;
            return false;
          }
          if (file.originalSize > MAX_IMAGE_BYTES) {
            skipped.push({ name: file.name, reason: "image too large (max 15 MB)" });
            return false;
          }
          if (file.originalSize > budget.remaining) {
            skipped.push({ name: file.name, reason: "import too large" });
            return false;
          }
          budget.remaining -= file.originalSize;
          return true;
        },
      },
      (err, files) => {
        if (err) return reject(err);
        if (ignored > 0) skipped.push({ name: "archive", reason: `${ignored} non-image entr${ignored === 1 ? "y" : "ies"} ignored` });
        resolve(files);
      },
    );
  });
}

/**
 * Flattens the upload into page images in reading order: archives expand into their image entries (sorted naturally),
 * plain images keep the order they were given in.
 */
async function collectImages(sources: readonly ImportSource[]): Promise<ImportReport & { images: ImportSource[] }> {
  const images: ImportSource[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const budget = { remaining: MAX_ARCHIVE_BYTES };

  for (const source of sources) {
    if (ARCHIVE_EXTENSIONS.test(source.name)) {
      let entries: Unzipped;
      try {
        entries = await unzipImages(source.bytes, budget, skipped);
      } catch (err) {
        log.warn({ err, archive: source.name }, "Archive could not be read");
        skipped.push({ name: source.name, reason: "archive could not be read" });
        continue;
      }
      for (const name of Object.keys(entries).sort(naturalCompare)) {
        const bytes = entries[name];
        if (bytes && bytes.byteLength > 0) images.push({ name, bytes });
      }
      continue;
    }
    if (!IMAGE_EXTENSIONS.test(source.name)) {
      skipped.push({ name: source.name, reason: "not an image or archive" });
      continue;
    }
    images.push(source);
  }
  return { images, pages: [], skipped };
}

/**
 * Normalises one image (EXIF rotation applied, transparency flattened) into a new page's folder as `original.png`. The
 * page starts idle with no stages, until a batch run translates it. `create` makes the row from the image's hash;
 * null when the image couldn't be read or stored, in which case nothing of it is left behind.
 */
export async function storePageImage(image: ImportSource, create: (imageHash: string) => Promise<Page>): Promise<Page | null> {
  let created: string | null = null;
  try {
    const normalised = await normalisePage(sharp(Buffer.from(image.bytes))).png().toBuffer();
    const { width = 0, height = 0 } = await sharp(normalised).metadata();
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(normalised);
    const page = await create(hasher.digest("hex"));
    created = page.id;
    await mkdir(pageDir(page.id), { recursive: true });
    await Bun.write(join(pageDir(page.id), "original.png"), normalised);
    await PageStore.update(page.id, { width, height, status: "done" });
    return { ...page, width, height, status: "done" };
  } catch (err) {
    log.warn({ err, entry: image.name }, "Page could not be imported");
    // The row is written before the image: a page whose image never landed would show up empty
    if (created) {
      const pageId = created;
      await PageStore.deletePage(pageId).catch((cleanup: unknown) => log.error({ err: cleanup, pageId }, "Couldn't remove a half-imported page"));
      await rm(pageDir(pageId), { recursive: true, force: true })
        .catch((cleanup: unknown) => log.error({ err: cleanup, pageId }, "Couldn't remove a half-imported page's folder"));
    }
    return null;
  }
}

/**
 * Stores images (and the contents of ZIP / CBZ archives) as pages of `chapterId`, appended after the pages already
 * there. Each image is normalised (EXIF rotation applied, transparency flattened) into its page folder.
 */
export async function importIntoChapter(chapterId: number, sources: readonly ImportSource[]): Promise<ImportReport> {
  const { images, skipped } = await collectImages(sources);
  const pages: ImportedPage[] = [];
  let order = await PageStore.maxSortOrder(chapterId);

  for (const image of images) {
    if (pages.length >= MAX_PAGES_PER_IMPORT) {
      skipped.push({ name: image.name, reason: `more than ${MAX_PAGES_PER_IMPORT} pages in one import` });
      continue;
    }
    if (image.bytes.byteLength > MAX_IMAGE_BYTES) {
      skipped.push({ name: image.name, reason: "image too large (max 15 MB)" });
      continue;
    }
    const name = baseName(image.name);
    const page = await storePageImage(image, (imageHash) => PageStore.createInChapter(imageHash, "import", chapterId, ++order, name));
    if (page) pages.push({ id: page.id, name });
    else skipped.push({ name: image.name, reason: "image could not be stored" });
  }

  log.info({ chapterId, imported: pages.length, skipped: skipped.length }, "Imported pages into chapter");
  return { pages, skipped };
}
