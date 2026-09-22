/**
 * How well a clean worked: of the pixels the detector marked as lettering, how many still look like ink afterwards.
 *
 * For each cleaned block, the background is taken from the cleaned image inside the block's box, from the pixels the
 * mask did *not* mark (the bubble around the text); a marked pixel still far from that background is leftover ink. 0
 * means the lettering is gone, 1 means nothing was removed. It measures the clean, not the detector: text the mask
 * missed can't show up here.
 *
 * Used by the regression runner (scripts/regress.ts) to tell a better clean from a worse one, and meant for the
 * self-check after clean that flags blocks with leftover ink.
 */
import sharp from "sharp";
import type { Box } from "@/lib/mask";

/**
 * How far a marked pixel may sit from the background and still count as cleaned: the largest difference on any one
 * colour channel (0–255). Colour, not brightness, so red lettering left on a green bubble of the same brightness
 * still counts as ink.
 */
const INK_DELTA = 48;
/** Fewer unmarked pixels than this in a box, and the whole box's median stands in for the background. */
const MIN_BACKGROUND_PIXELS = 32;

export interface InkReport {
  blockId: number;
  /** Share of the block's marked pixels still inked after the clean, 0–1. */
  ink: number;
  /** How many pixels the mask marked in the block (the weight for averaging blocks). */
  marked: number;
}

/** The per-channel median colour of these pixels (indices into an RGB buffer). */
function medianColour(rgb: Buffer, pixels: readonly number[]): [number, number, number] {
  const channel = (c: number) => {
    const values = pixels.map((p) => rgb[p * 3 + c]!).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 0;
  };
  return [channel(0), channel(1), channel(2)];
}

/**
 * Leftover ink per block, measured on `cleaned` against `mask` (both files, same size; the mask white where the
 * detector saw lettering).
 */
export async function leftoverInk(cleaned: string | Buffer, mask: string | Buffer, blocks: readonly (Box & { id: number })[]): Promise<InkReport[]> {
  const image = await sharp(cleaned).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  // One byte per pixel whatever the mask file holds: greyscale() alone keeps an alpha channel, which would halve the
  // stride the loop below assumes
  const marks = await sharp(mask).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = image.info;
  if (marks.info.width !== width || marks.info.height !== height) throw new Error("the mask and the cleaned image differ in size");
  if (marks.info.channels !== 1) throw new Error("the mask is not single-channel");
  const rgb = image.data;
  const distance = (p: number, colour: readonly number[]) =>
    Math.max(Math.abs(rgb[p * 3]! - colour[0]!), Math.abs(rgb[p * 3 + 1]! - colour[1]!), Math.abs(rgb[p * 3 + 2]! - colour[2]!));

  return blocks.map((block) => {
    const x0 = Math.max(0, Math.floor(block.x)), y0 = Math.max(0, Math.floor(block.y));
    const x1 = Math.min(width, Math.ceil(block.x + block.w)), y1 = Math.min(height, Math.ceil(block.y + block.h));
    const marked: number[] = [];
    const background: number[] = [];
    const everything: number[] = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = y * width + x;
        everything.push(p);
        if (marks.data[p]! > 127) marked.push(p);
        else background.push(p);
      }
    }
    if (marked.length === 0) return { blockId: block.id, ink: 0, marked: 0 };
    const bg = medianColour(rgb, background.length >= MIN_BACKGROUND_PIXELS ? background : everything);
    const inked = marked.filter((p) => distance(p, bg) > INK_DELTA).length;
    return { blockId: block.id, ink: inked / marked.length, marked: marked.length };
  });
}

/** Blocks' leftover ink as one number: the share of all their marked pixels still inked. */
export function overallInk(reports: readonly InkReport[]): number {
  const marked = reports.reduce((sum, r) => sum + r.marked, 0);
  return marked === 0 ? 0 : reports.reduce((sum, r) => sum + r.ink * r.marked, 0) / marked;
}
