/**
 * Which detected sound-effect blocks are worth cleaning by default.
 *
 * The detector marks anything letter-like outside the bubbles as a sound effect — including the page number in the
 * margin and specks of screentone texture. Cleaning those removes things that should stay (the page number) or paints
 * over artwork for nothing (the specks). Such blocks start with their "clean" switch off; the Studio can turn any of
 * them back on. Text blocks are never touched here.
 */
import type { Box } from "@/lib/mask";

/** A block smaller than this share of the page is a speck, not lettering (≈ 25×25 on a 1200×1800 page). */
const MIN_AREA_SHARE = 0.0003;
/** …or whose longer side is under this share of the page's shorter side. */
const MIN_SIDE_SHARE = 0.015;
/** Page numbers sit in the top or bottom margin: the block's centre within this share of the page height of an edge. */
const MARGIN_SHARE = 0.07;
/** …and are small: under these shares of the page's height and width. */
const PAGE_NUMBER_MAX_HEIGHT = 0.04;
const PAGE_NUMBER_MAX_WIDTH = 0.12;

/** Why a sound-effect block is left out of cleaning by default, or null when it should be cleaned. */
export function sfxExclusion(block: Box, width: number, height: number): "speck" | "page number" | null {
  // The page number first: it is small too, and the more specific name is the useful one
  const centreY = block.y + block.h / 2;
  const inMargin = centreY < height * MARGIN_SHARE || centreY > height * (1 - MARGIN_SHARE);
  if (inMargin && block.h < height * PAGE_NUMBER_MAX_HEIGHT && block.w < width * PAGE_NUMBER_MAX_WIDTH) return "page number";
  const area = block.w * block.h;
  if (area < width * height * MIN_AREA_SHARE || Math.max(block.w, block.h) < Math.min(width, height) * MIN_SIDE_SHARE) return "speck";
  return null;
}
