import sharp from "sharp";

/** Axis-aligned box in page pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** "text" = dialogue/caption found by the detector; "sfx" = leftover lettering (sound effects, signs). */
export type BlockKind = "text" | "sfx";

export interface TextBlock extends Box {
  kind: BlockKind;
}

/** Connected text-pixel blobs: per-pixel id (0 = background) with each blob's box and pixel count. */
export interface Components {
  labels: Int32Array;
  /** Index `id - 1`. */
  boxes: Box[];
  areas: number[];
}

/** Leftover blobs smaller than this are specks, not lettering. */
const MIN_COMPONENT_AREA = 100;
const MERGE_DISTANCE = 50;
const BOX_PADDING = 15;
/** A merge is skipped only when the result exceeds BOTH limits, so whole page sections don't collapse into one block. */
const MAX_MERGED_WIDTH = 300;
const MAX_MERGED_HEIGHT = 350;
/** A blob belongs to a block when at least this share of its bounding box lies inside the block. */
const OWNERSHIP = 0.5;
const TEXT_BLOCK_PADDING = 6;

/** Grow a binary mask (1 = masked) by `radius` pixels using a separable box filter. */
export function dilateMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask.slice();
  const tmp = new Uint8Array(width * height);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    let run = 0;
    for (let x = -radius; x < width; x++) {
      const add = x + radius, drop = x - radius - 1;
      if (add < width) run += mask[y * width + add];
      if (drop >= 0) run -= mask[y * width + drop];
      if (x >= 0) tmp[y * width + x] = run > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < width; x++) {
    let run = 0;
    for (let y = -radius; y < height; y++) {
      const add = y + radius, drop = y - radius - 1;
      if (add < height) run += tmp[add * width + x];
      if (drop >= 0) run -= tmp[drop * width + x];
      if (y >= 0) out[y * width + x] = run > 0 ? 1 : 0;
    }
  }
  return out;
}

/** Label 8-connected blobs of a binary mask. */
export function labelComponents(mask: Uint8Array, width: number, height: number): Components {
  const labels = new Int32Array(width * height);
  const queue = new Int32Array(width * height);
  const boxes: Box[] = [];
  const areas: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = boxes.length + 1;
    let head = 0, tail = 0, area = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    queue[tail++] = start;
    labels[start] = id;
    while (head < tail) {
      const idx = queue[head++];
      const cx = idx % width, cy = (idx - cx) / width;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
      area++;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (mask[ni] && !labels[ni]) {
            labels[ni] = id;
            queue[tail++] = ni;
          }
        }
      }
    }
    boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
    areas.push(area);
  }
  return { labels, boxes, areas };
}

/** Share of `inner`'s area that lies inside `outer` (0–1). */
function overlapShare(inner: Box, outer: Box): number {
  const ix = Math.max(0, Math.min(inner.x + inner.w, outer.x + outer.w) - Math.max(inner.x, outer.x));
  const iy = Math.max(0, Math.min(inner.y + inner.h, outer.y + outer.h) - Math.max(inner.y, outer.y));
  return (ix * iy) / (inner.w * inner.h);
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function pad(box: Box, padding: number, width: number, height: number): Box {
  const x = Math.max(0, box.x - padding), y = Math.max(0, box.y - padding);
  return { x, y, w: Math.min(width, box.x + box.w + padding) - x, h: Math.min(height, box.y + box.h + padding) - y };
}

/** Top-to-bottom, then right-to-left (manga reading order). */
function readingOrder(a: Box, b: Box): number {
  return Math.abs(a.y - b.y) > 40 ? a.y - b.y : b.x + b.w - (a.x + a.w);
}

/** Merge boxes within MERGE_DISTANCE of each other, then pad. */
function groupBoxes(rects: Box[], width: number, height: number): Box[] {
  const groups = rects.map((r) => ({ ...r }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i], b = groups[j];
        const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
        const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
        if (gapX > MERGE_DISTANCE || gapY > MERGE_DISTANCE) continue;
        const next = union(a, b);
        if (next.w > MAX_MERGED_WIDTH && next.h > MAX_MERGED_HEIGHT) continue;
        groups[i] = next;
        groups.splice(j, 1);
        j--;
        merged = true;
      }
    }
  }
  return groups.map((g) => pad(g, BOX_PADDING, width, height));
}

/**
 * Build page blocks from detector text boxes and the text-pixel mask. Blobs mostly inside a detector
 * box grow it into a "text" block; leftover blobs (typically SFX lettering) are grouped by proximity
 * into "sfx" blocks. Text blocks come first, each kind in reading order.
 */
export function buildBlocks(mask: Uint8Array, width: number, height: number, textBoxes: Box[]): TextBlock[] {
  const comps = labelComponents(mask, width, height);
  const grown = textBoxes.map((b) => ({ ...b }));
  const leftovers: Box[] = [];

  comps.boxes.forEach((comp, i) => {
    let owner = -1, best = OWNERSHIP;
    textBoxes.forEach((box, j) => {
      const share = overlapShare(comp, box);
      if (share >= best) {
        owner = j;
        best = share;
      }
    });
    if (owner >= 0) grown[owner] = union(grown[owner], comp);
    else if (comps.areas[i] >= MIN_COMPONENT_AREA) leftovers.push(comp);
  });

  const text = grown.map((b): TextBlock => ({ ...pad(b, TEXT_BLOCK_PADDING, width, height), kind: "text" })).sort(readingOrder);
  const sfx = groupBoxes(leftovers, width, height).map((b): TextBlock => ({ ...b, kind: "sfx" })).sort(readingOrder);
  return [...text, ...sfx];
}

/**
 * Text pixels of the included blocks. Each blob belongs to the block containing most of it (text blocks
 * win ties), so lettering next to a block is only removed when its own block is included.
 */
export function selectBlockMask(
  mask: Uint8Array,
  width: number,
  height: number,
  blocks: ReadonlyArray<TextBlock & { include: boolean }>,
): Uint8Array {
  const { comps, owners } = blockOwners(mask, width, height, blocks);
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const owner = owners[comps.labels[i]!];
    if (owner !== undefined && owner.include) out[i] = 1;
  }
  return out;
}

/** The block each blob belongs to (undefined = none), by component id. Text blocks win ties over sound effects. */
function blockOwners<T extends TextBlock>(
  mask: Uint8Array,
  width: number,
  height: number,
  blocks: readonly T[],
): { comps: Components; owners: (T | undefined)[] } {
  const comps = labelComponents(mask, width, height);
  const ordered = [...blocks].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "text" ? -1 : 1));
  const owners: (T | undefined)[] = new Array<T | undefined>(comps.boxes.length + 1).fill(undefined);
  comps.boxes.forEach((comp, i) => {
    let owner: T | undefined;
    let best = OWNERSHIP;
    for (const block of ordered) {
      const share = overlapShare(comp, block);
      if (owner === undefined ? share >= best : share > best) {
        owner = block;
        best = share;
      }
    }
    owners[i + 1] = owner;
  });
  return { comps, owners };
}

/**
 * Which block owns each masked pixel, as that block's id (0 = none). Blobs are owned outright, so a block's own
 * lettering can be told from a neighbour's strokes reaching into its box — what measuring a clean needs.
 */
export function blockOwnerMask(
  mask: Uint8Array,
  width: number,
  height: number,
  blocks: ReadonlyArray<TextBlock & { id: number }>,
): Int32Array {
  const { comps, owners } = blockOwners(mask, width, height, blocks);
  const out = new Int32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = owners[comps.labels[i]!]?.id ?? 0;
  return out;
}

/** Encode a binary mask as a black/white PNG (white = masked). */
export async function maskToPng(mask: Uint8Array, width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = mask[i] ? 255 : 0;
  return sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

/** Decode a black/white mask image (any format) into a binary mask. */
/**
 * Pixel size of an image read from its header only, without decoding any pixels: lets a caller refuse an image whose
 * declared size is wrong (e.g. a tiny compressed PNG claiming huge dimensions) before paying for the decode.
 */
export async function imageSize(input: string | Buffer): Promise<{ width: number; height: number }> {
  const { width, height } = await sharp(input).metadata();
  if (!width || !height) throw new Error("image has no dimensions");
  return { width, height };
}

export async function maskFromImage(input: string | Buffer): Promise<{ mask: Uint8Array; width: number; height: number }> {
  const { data, info } = await sharp(input).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(info.width * info.height);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i] >= 128 ? 1 : 0;
  return { mask, width: info.width, height: info.height };
}
