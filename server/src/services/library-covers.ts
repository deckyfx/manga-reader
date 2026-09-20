/**
 * Series cover images: uploads are normalised and stored under `data/covers/`, keyed by series id. A series without
 * an uploaded cover falls back to the first page of its first chapter (see the read plugin).
 */
import sharp from "sharp";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { MAX_IMAGE_BYTES } from "@/services/page-jobs";
import { normalisePage } from "@/services/page-pipeline";
import { env } from "@/env";

/** Covers live beside the page folders, under the server's data directory. */
export const COVERS_DIR = `${env.DATA_DIR}/covers`;

/** Absolute path of a stored cover; `name` is what the series row holds. */
export const coverFilePath = (name: string): string => join(COVERS_DIR, name);

/** Largest side of a stored cover: enough for a detail page, small enough to load in a grid. */
const MAX_COVER_SIDE = 1200;

export class CoverTooLargeError extends Error {}

/**
 * Stores an uploaded cover for a series and returns the name to save on the row. The image is rotated by its EXIF,
 * flattened and scaled down, so the library grid doesn't load full-size scans.
 *
 * The name carries a random part: a series holds several covers now, and the old `series-<id>.png` would have had
 * each upload overwrite the last — including the one another cover row still pointed at.
 */
export async function saveCover(seriesId: number, bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new CoverTooLargeError("cover image too large (max 15 MB)");
  await mkdir(COVERS_DIR, { recursive: true });
  const name = `series-${seriesId}-${crypto.randomUUID().slice(0, 8)}.png`;
  const image = normalisePage(sharp(Buffer.from(bytes))).resize({
    width: MAX_COVER_SIDE,
    height: MAX_COVER_SIDE,
    fit: "inside",
    withoutEnlargement: true,
  });
  await Bun.write(coverFilePath(name), await image.png().toBuffer());
  return name;
}

/** Removes a stored cover (when it's replaced or its series is deleted); missing files are fine. */
export async function deleteCover(name: string | null): Promise<void> {
  if (!name) return;
  await rm(coverFilePath(name), { force: true });
}
