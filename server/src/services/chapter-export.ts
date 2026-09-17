/**
 * Exporting a chapter as a ZIP of its pages in reading order: each page's published result when it has one, else its
 * original. Names are numbered so any reader keeps the order.
 */
import { zip } from "fflate";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pageDir, PageStore } from "@/stores/page-store";
import type { Page } from "@/db/schema";

/** Characters that are awkward in file names on some systems. */
const safeName = (name: string): string => name.replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 80);

/** The image a page exports as: the published result, or the original when it hasn't been translated. */
export function exportImagePath(page: Page): string | null {
  const result = join(pageDir(page.id), "result.png");
  if (existsSync(result)) return result;
  const original = join(pageDir(page.id), "original.png");
  return existsSync(original) ? original : null;
}

function zipEntries(entries: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    // level 0: PNGs are already compressed, so storing them keeps the export fast
    zip(entries, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

export interface ChapterExport {
  bytes: Uint8Array;
  pages: number;
  /** Pages left out because they have no image on disk. */
  missing: number;
}

/** Builds the ZIP for a chapter; pages without any stored image are skipped. */
export async function exportChapter(chapterId: number): Promise<ChapterExport> {
  const pages = await PageStore.listByChapter(chapterId);
  const entries: Record<string, Uint8Array> = {};
  let missing = 0;

  for (const [index, page] of pages.entries()) {
    const path = exportImagePath(page);
    if (!path) {
      missing++;
      continue;
    }
    const number = String(index + 1).padStart(3, "0");
    const name = page.name ? `${number} ${safeName(page.name)}` : number;
    entries[`${name}.png`] = new Uint8Array(await Bun.file(path).arrayBuffer());
  }

  return { bytes: await zipEntries(entries), pages: Object.keys(entries).length, missing };
}
