/**
 * Which detected blocks are worth cleaning by default.
 *
 * The detector marks anything letter-like. Outside the bubbles that includes the page number in the margin and
 * specks of screentone texture; inside, it includes slivers of tone and the occasional piece of artwork that
 * happens to look like a line of type. Cleaning those removes something that should stay, or paints over drawing
 * for nothing — and cleaning is the expensive stage, so it is also the slowest way to be wrong.
 *
 * Such blocks start with their "clean" switch off. Nothing is deleted: they stay on the page dashed, and the
 * Studio can turn any of them back on.
 *
 * Geometry is all that is known when the page is detected. What the block actually *says* is only known after it
 * has been read, which is why {@link readsAsNothing} is a second, later judgement.
 */
import type { Box } from "@/lib/mask";

/** A block smaller than this share of the page is a speck, not lettering (≈ 25×25 on a 1200×1800 page). */
const MIN_AREA_SHARE = 0.0003;
/** The same test for a text block, at a third of the size: one short word in a small bubble is still text. */
const MIN_TEXT_AREA_SHARE = 0.0001;
/** …or whose longer side is under this share of the page's shorter side. */
const MIN_SIDE_SHARE = 0.015;
/**
 * Page numbers sit in the top or bottom margin — the block's centre within this share of the page's shorter side of
 * an edge — and are small: under these shares of the shorter side. Measured against the shorter side, so a tall
 * webtoon strip doesn't get a margin (and a "page number") hundreds of pixels deep.
 */
const MARGIN_SHARE = 0.1;
const PAGE_NUMBER_MAX_HEIGHT = 0.05;
const PAGE_NUMBER_MAX_WIDTH = 0.12;

/**
 * A block narrower than this share of its length is a sliver, not a line of type. Japanese sets vertically, so a
 * tall narrow block is ordinary and the test has to be blind to which way round it is.
 */
const MIN_THICKNESS_RATIO = 0.06;

/** Why a block is left out of cleaning by default, or null when it should be cleaned. */
export type Exclusion = "speck" | "page number" | "sliver";

/** Why a sound-effect block is left out of cleaning by default, or null when it should be cleaned. */
export function sfxExclusion(block: Box, width: number, height: number): Exclusion | null {
  // The page number first: it is small too, and the more specific name is the useful one
  const scale = Math.min(width, height);
  const centreY = block.y + block.h / 2;
  const inMargin = centreY < scale * MARGIN_SHARE || centreY > height - scale * MARGIN_SHARE;
  if (inMargin && block.h < scale * PAGE_NUMBER_MAX_HEIGHT && block.w < scale * PAGE_NUMBER_MAX_WIDTH) return "page number";
  const area = block.w * block.h;
  if (area < width * height * MIN_AREA_SHARE || Math.max(block.w, block.h) < Math.min(width, height) * MIN_SIDE_SHARE) return "speck";
  return null;
}

/**
 * Why a text block is left out of cleaning by default, or null when it should be cleaned.
 *
 * Kinder than the sound-effect rule on size, because a bubble holding one short word is small and entirely real,
 * and because leaving lettering behind inside a bubble is more obviously wrong than leaving a speck of tone. Only
 * what cannot be a line of text at all is excluded here: a speck, or a sliver too thin to hold characters.
 */
export function textExclusion(block: Box, width: number, height: number): Exclusion | null {
  const area = block.w * block.h;
  if (area < width * height * MIN_TEXT_AREA_SHARE) return "speck";
  const [long, short] = block.w >= block.h ? [block.w, block.h] : [block.h, block.w];
  if (short < long * MIN_THICKNESS_RATIO) return "sliver";
  return null;
}

/** A block of this kind is left out when the filter for it says so. */
export function blockExclusion(kind: "text" | "sfx" | string, block: Box, width: number, height: number): Exclusion | null {
  return kind === "sfx" ? sfxExclusion(block, width, height) : textExclusion(block, width, height);
}

/**
 * Whether a reading amounts to no text at all: empty, or nothing but punctuation, tone marks and spacing.
 *
 * A bubble that truly holds only `……` or `！？` reads the same in English as it does in Japanese, so cleaning it
 * and lettering it back costs artwork for no gain. A block that reads as nothing is therefore left alone — and,
 * being only hidden rather than dropped, can be put back by hand when the reader was simply wrong.
 */
export function readsAsNothing(text: string | null | undefined): boolean {
  if (!text) return true;
  // Everything that carries no meaning of its own: spacing, the Japanese and Latin punctuation marks, the long
  // vowel and repetition marks, and the dot leaders a scanner turns ellipses into
  const bare = text.replace(/[\s\p{P}\p{S}\u30fb\u30fc\u3005\u3006\u2026\u2025\uff65]/gu, "");
  return bare.length === 0;
}
