/**
 * Server side of typesetting: finding where each block's text may go on the cleaned page, and loading the fonts.
 * Layout and rendering live in `@/shared/typeset`, which the Studio also runs for its live preview.
 */
import animeAce from "../../assets/fonts/anime-ace/animeace.ttf" with { type: "file" };
import animeAceBold from "../../assets/fonts/anime-ace/animeace_b.ttf" with { type: "file" };
import animeAceItalic from "../../assets/fonts/anime-ace/animeace_i.ttf" with { type: "file" };
import { dilateMask, type Box } from "@/lib/mask";
import { rectArea, Typesetter, type FontVariant, type TextArea } from "@/shared/typeset";

export type { TextArea } from "@/shared/typeset";

/** Bundled font files by variant (embedded in the single-file build). */
export const FONT_FILES: Record<FontVariant, string> = { regular: animeAce, bold: animeAceBold, italic: animeAceItalic };

/** Grey levels from the bubble background still counted as background when flood-filling the interior. */
const BACKGROUND_TOLERANCE = 40;
/** Share of the interior's smaller side kept clear of the bubble outline. */
const EDGE_MARGIN = 0.08;
const MIN_EDGE_MARGIN = 4;
const MIN_AREA_PIXELS = 100;
/** Pixels left empty on the dividing line between two blocks that share an interior. */
const AREA_GAP = 6;

const luma = (rgb: Buffer, p: number): number => (rgb[p * 3] * 299 + rgb[p * 3 + 1] * 587 + rgb[p * 3 + 2] * 114) / 1000;

function clampBox(box: Box, width: number, height: number): Box {
  const x = Math.max(0, Math.floor(box.x)), y = Math.max(0, Math.floor(box.y));
  return { x, y, w: Math.max(1, Math.min(width, Math.ceil(box.x + box.w)) - x), h: Math.max(1, Math.min(height, Math.ceil(box.y + box.h)) - y) };
}

/**
 * Interior of the bubble around `block` on the cleaned page: flood fill from the block through
 * background-coloured pixels, bounded by the detected bubble (or a padded block box), then shrunk
 * away from outlines so text never touches the bubble edge.
 */
export function findTextArea(rgb: Buffer, width: number, height: number, block: Box, bubble: Box | null): TextArea | null {
  const outer = bubble
    ? { x: Math.min(bubble.x, block.x), y: Math.min(bubble.y, block.y), w: Math.max(bubble.x + bubble.w, block.x + block.w) - Math.min(bubble.x, block.x), h: Math.max(bubble.y + bubble.h, block.y + block.h) - Math.min(bubble.y, block.y) }
    : { x: block.x - 16, y: block.y - 16, w: block.w + 32, h: block.h + 32 };
  const bound = clampBox(outer, width, height);
  const bw = bound.w, bh = bound.h;

  const inner = clampBox(block, width, height);
  const levels: number[] = [];
  for (let y = inner.y; y < inner.y + inner.h; y++) {
    for (let x = inner.x; x < inner.x + inner.w; x++) levels.push(luma(rgb, y * width + x));
  }
  levels.sort((a, b) => a - b);
  const background = levels[Math.floor(levels.length / 2)];
  const isBackground = (p: number): boolean => Math.abs(luma(rgb, p) - background) <= BACKGROUND_TOLERANCE;

  const region = new Uint8Array(bw * bh);
  const queue = new Int32Array(bw * bh);
  let tail = 0;
  for (let y = Math.max(inner.y, bound.y); y < Math.min(inner.y + inner.h, bound.y + bh); y++) {
    for (let x = Math.max(inner.x, bound.x); x < Math.min(inner.x + inner.w, bound.x + bw); x++) {
      const local = (y - bound.y) * bw + (x - bound.x);
      if (!region[local] && isBackground(y * width + x)) {
        region[local] = 1;
        queue[tail++] = local;
      }
    }
  }
  for (let head = 0; head < tail; head++) {
    const local = queue[head];
    const lx = local % bw, ly = (local - lx) / bw;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = lx + dx, ny = ly + dy;
      if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
      const n = ny * bw + nx;
      if (region[n] || !isBackground((ny + bound.y) * width + nx + bound.x)) continue;
      region[n] = 1;
      queue[tail++] = n;
    }
  }

  const margin = Math.max(MIN_EDGE_MARGIN, Math.round(Math.min(bw, bh) * EDGE_MARGIN));
  const outside = new Uint8Array(bw * bh);
  for (let i = 0; i < outside.length; i++) outside[i] = region[i] ? 0 : 1;
  const nearOutline = dilateMask(outside, bw, bh, margin);
  const mask = new Uint8Array(bw * bh);
  let allowed = 0;
  for (let y = margin; y < bh - margin; y++) {
    for (let x = margin; x < bw - margin; x++) {
      const i = y * bw + x;
      if (nearOutline[i]) continue;
      mask[i] = 1;
      allowed++;
    }
  }
  if (allowed < MIN_AREA_PIXELS) return null;
  return { bound, mask, dark: background < 128 };
}

/**
 * Where a text block's lettering goes: the bubble interior when there is one, else the block's own box.
 *
 * Text written straight onto the artwork — a narration or a character's inner monologue with no bubble around it — has
 * no plain background to flood through, so `findTextArea` finds no room and the block would be left unlettered: its
 * original text cleaned away and nothing burned in its place. The block's box is exactly what was cleaned, so the
 * translation goes there, as a sound effect's does. A block entirely off the page gets no area: there's nowhere to
 * put it.
 */
export function textAreaFor(rgb: Buffer, width: number, height: number, block: Box, bubble: Box | null): TextArea | null {
  const onPage = block.x < width && block.y < height && block.x + block.w > 0 && block.y + block.h > 0;
  if (!onPage) return null;
  return findTextArea(rgb, width, height, block, bubble) ?? rectArea(clampBox(block, width, height), isDarkBackground(rgb, width, height, block));
}

/** Distance from a point to a box (0 inside). */
function distanceToBox(x: number, y: number, box: Box): number {
  return Math.hypot(Math.max(box.x - x, 0, x - (box.x + box.w)), Math.max(box.y - y, 0, y - (box.y + box.h)));
}

/**
 * Joined bubbles and overlapping caption boxes flood-fill into one shared interior. Give each contested
 * pixel to the block it is nearer to, leaving a gap on the dividing line so neighbouring texts never touch.
 */
export function separateAreas(entries: ReadonlyArray<{ area: TextArea; block: Box }>): void {
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      const ab = a.area.bound, bb = b.area.bound;
      const x0 = Math.max(ab.x, bb.x), x1 = Math.min(ab.x + ab.w, bb.x + bb.w);
      const y0 = Math.max(ab.y, bb.y), y1 = Math.min(ab.y + ab.h, bb.y + bb.h);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const ia = (y - ab.y) * ab.w + (x - ab.x), ib = (y - bb.y) * bb.w + (x - bb.x);
          if (!a.area.mask[ia] || !b.area.mask[ib]) continue;
          const da = distanceToBox(x, y, a.block), db = distanceToBox(x, y, b.block);
          if (da + AREA_GAP <= db) b.area.mask[ib] = 0;
          else if (db + AREA_GAP <= da) a.area.mask[ia] = 0;
          else a.area.mask[ia] = b.area.mask[ib] = 0;
        }
      }
    }
  }
}

/** Whether the cleaned page is dark inside `box` (median brightness), so default lettering is light. */
export function isDarkBackground(rgb: Buffer, width: number, height: number, box: Box): boolean {
  const area = clampBox(box, width, height);
  const levels: number[] = [];
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) levels.push(luma(rgb, y * width + x));
  }
  levels.sort((a, b) => a - b);
  return (levels[Math.floor(levels.length / 2)] ?? 255) < 128;
}

let sharedTypesetter: Promise<Typesetter> | null = null;

/** Process-wide typesetter (all three fonts parsed), loaded on first use. */
export function getTypesetter(): Promise<Typesetter> {
  sharedTypesetter ??= (async () => {
    const [regular, bold, italic] = await Promise.all([FONT_FILES.regular, FONT_FILES.bold, FONT_FILES.italic].map((f) => Bun.file(f).arrayBuffer()));
    return Typesetter.fromBuffers({ regular, bold, italic });
  })();
  return sharedTypesetter;
}
