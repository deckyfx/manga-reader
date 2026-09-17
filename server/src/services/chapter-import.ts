/**
 * Filing images into a chapter: plain images or ZIP / CBZ archives. Each page is normalised and stored exactly like a
 * translated page (`<page id>/original.png`), so the pipeline can run over it later without re-uploading anything.
 * Imported pages start idle with no stages; a chapter batch run (or "run again" in the Studio) translates them.
 */
import sharp from "sharp";
import { unzip, type Unzipped } from "fflate";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { childLogger } from "@/lib/logger";
import { MAX_IMAGE_BYTES } from "@/services/page-jobs";
import { normalisePage } from "@/services/page-pipeline";
import { pageDir, PageStore } from "@/stores/page-store";

const log = childLogger("chapter-import");

/** Archives expand in memory, so cap what one import may hold. */
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
/** Pages accepted in a single import, so one bad archive can't fill the disk. */
const MAX_PAGES_PER_IMPORT = 500;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|avif|tiff?)$/i;
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
const baseName = (path: string): string => {
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

function unzipArchive(bytes: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(bytes, (err, files) => (err ? reject(err) : resolve(files)));
  });
}

/**
 * Flattens the upload into page images in reading order: archives expand into their image entries (sorted naturally),
 * plain images keep the order they were given in.
 */
async function collectImages(sources: readonly ImportSource[]): Promise<ImportReport & { images: ImportSource[] }> {
  const images: ImportSource[] = [];
  const skipped: { name: string; reason: string }[] = [];
  let archiveBytes = 0;

  for (const source of sources) {
    if (ARCHIVE_EXTENSIONS.test(source.name)) {
      let entries: Unzipped;
      try {
        entries = await unzipArchive(source.bytes);
      } catch (err) {
        log.warn({ err, archive: source.name }, "Archive could not be read");
        skipped.push({ name: source.name, reason: "archive could not be read" });
        continue;
      }
      const names = Object.keys(entries).filter((name) => !isJunk(name) && IMAGE_EXTENSIONS.test(name)).sort(naturalCompare);
      for (const name of names) {
        const bytes = entries[name];
        if (!bytes || bytes.byteLength === 0) continue;
        archiveBytes += bytes.byteLength;
        if (archiveBytes > MAX_ARCHIVE_BYTES) {
          skipped.push({ name, reason: "import too large" });
          continue;
        }
        images.push({ name, bytes });
      }
      const ignored = Object.keys(entries).filter((name) => !isJunk(name) && !IMAGE_EXTENSIONS.test(name));
      if (ignored.length > 0) skipped.push({ name: source.name, reason: `${ignored.length} non-image entr${ignored.length === 1 ? "y" : "ies"} ignored` });
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
    try {
      const normalised = await normalisePage(sharp(Buffer.from(image.bytes))).png().toBuffer();
      const { width = 0, height = 0 } = await sharp(normalised).metadata();
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(normalised);
      const name = baseName(image.name);
      const page = await PageStore.createInChapter(hasher.digest("hex"), "import", chapterId, ++order, name);
      await mkdir(pageDir(page.id), { recursive: true });
      await Bun.write(join(pageDir(page.id), "original.png"), normalised);
      // Imported pages are idle with no stages until a batch run translates them
      await PageStore.update(page.id, { width, height, status: "done" });
      pages.push({ id: page.id, name });
    } catch (err) {
      log.warn({ err, entry: image.name }, "Page could not be imported");
      skipped.push({ name: image.name, reason: "image could not be decoded" });
    }
  }

  log.info({ chapterId, imported: pages.length, skipped: skipped.length }, "Imported pages into chapter");
  return { pages, skipped };
}
