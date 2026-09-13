/**
 * Typesetting: fit translated text inside a bubble's interior and render it as a transparent patch.
 * Glyph outlines come from opentype.js (bundled Anime Ace Bold); sharp rasterises the SVG.
 */
import { parse, type Font } from "opentype.js";
import { hyphenateSync } from "hyphen/en";
import animeAceBold from "../../assets/fonts/anime-ace/animeace_b.ttf" with { type: "file" };
import { dilateMask, type Box } from "@/lib/mask";

/** Grey levels from the bubble background still counted as background when flood-filling the interior. */
const BACKGROUND_TOLERANCE = 40;
const LINE_HEIGHT = 1.1;
const MIN_FONT_SIZE = 10;
/** Share of the interior's smaller side kept clear of the bubble outline. */
const EDGE_MARGIN = 0.08;
const MIN_EDGE_MARGIN = 4;
const STROKE_RATIO = 0.14;
/** Word widths are measured once at this size and scaled (advance width is linear in font size). */
const MEASURE_SIZE = 100;
const MIN_AREA_PIXELS = 100;
/** Words shorter than this are never hyphenated; each part keeps at least HYPHEN_MIN_PART letters. */
const HYPHEN_MIN_WORD = 7;
const HYPHEN_MIN_PART = 3;
/** Hyphenate only when it allows a clearly larger font. */
const HYPHEN_GAIN = 1.35;
const SOFT_HYPHEN = "\u00AD";
/** Pixels left empty on the dividing line between two blocks that share an interior. */
const AREA_GAP = 6;
/** ASCII stand-ins for typographic characters, used only when the font lacks the original glyph. */
const GLYPH_FALLBACKS: Record<string, string> = {
  "—": "--",
  "–": "-",
  "‘": "'",
  "’": "'",
  "“": "\"",
  "”": "\"",
  "…": "...",
  "　": " ",
};

/** Where text may be placed: a mask local to `bound` (1 = allowed). */
export interface TextArea {
  bound: Box;
  mask: Uint8Array;
  /** Dark bubble → light text. */
  dark: boolean;
}

export interface LayoutLine {
  text: string;
  /** Left edge and baseline, local to the area's bound. */
  x: number;
  baseline: number;
  width: number;
}

export interface TextLayout {
  fontSize: number;
  lines: LayoutLine[];
  /** False when even the minimum size overflowed the bubble shape. */
  fits: boolean;
}

/** A wrappable piece of text; `glue` pieces join the previous piece without a space (e.g. after "/"). */
interface Token {
  text: string;
  glue: boolean;
}

/** Row-wise free span through the interior's centre column, plus its centroid. */
interface AreaGeometry {
  left: Int32Array;
  right: Int32Array;
  cx: number;
  cy: number;
  height: number;
}

const luma = (rgb: Buffer, p: number): number => (rgb[p * 3] * 299 + rgb[p * 3 + 1] * 587 + rgb[p * 3 + 2] * 114) / 1000;

function clampBox(box: Box, width: number, height: number): Box {
  const x = Math.max(0, Math.floor(box.x)), y = Math.max(0, Math.floor(box.y));
  return { x, y, w: Math.max(1, Math.min(width, Math.ceil(box.x + box.w)) - x), h: Math.max(1, Math.min(height, Math.ceil(box.y + box.h)) - y) };
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const word of text.toUpperCase().split(/\s+/).filter(Boolean)) {
    word.split(/(?<=\/)/).forEach((part, i) => tokens.push({ text: part, glue: i > 0 }));
  }
  return tokens;
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

let sharedTypesetter: Promise<Typesetter> | null = null;

/** Process-wide typesetter (parsed font), loaded on first use. */
export function getTypesetter(): Promise<Typesetter> {
  sharedTypesetter ??= Typesetter.load();
  return sharedTypesetter;
}

export class Typesetter {
  private constructor(private readonly font: Font) {}

  static async load(fontPath: string = animeAceBold): Promise<Typesetter> {
    return new Typesetter(parse(await Bun.file(fontPath).arrayBuffer()));
  }

  /**
   * Replace characters the font has no glyph for with ASCII look-alikes. Translations often contain
   * typographic punctuation (DeepL's em dash, curly quotes) that comic fonts like Anime Ace lack, which
   * would otherwise render as empty boxes.
   */
  private withAvailableGlyphs(text: string): string {
    let result = "";
    for (const ch of text) {
      const fallback = GLYPH_FALLBACKS[ch];
      result += fallback !== undefined && this.font.charToGlyphIndex(ch) === 0 ? fallback : ch;
    }
    return result;
  }

  private get capHeightRatio(): number {
    const os2 = this.font.tables.os2 as { sCapHeight?: number } | undefined;
    return (os2?.sCapHeight || this.font.ascender * 0.7) / this.font.unitsPerEm;
  }

  private geometry(area: TextArea): AreaGeometry | null {
    const { mask } = area;
    const w = area.bound.w, h = area.bound.h;
    let sumX = 0, sumY = 0, count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        sumX += x;
        sumY += y;
        count++;
      }
    }
    if (count === 0) return null;
    const cx = Math.round(sumX / count), cy = sumY / count;
    const left = new Int32Array(h), right = new Int32Array(h);
    for (let y = 0; y < h; y++) {
      if (!mask[y * w + cx]) {
        left[y] = right[y] = cx;
        continue;
      }
      let l = cx, r = cx + 1;
      while (l > 0 && mask[y * w + l - 1]) l--;
      while (r < w && mask[y * w + r]) r++;
      left[y] = l;
      right[y] = r;
    }
    return { left, right, cx, cy, height: h };
  }

  /**
   * Largest font size (≤ maxFontSize) whose uppercase, word-wrapped lines fit the area's shape. Each line
   * gets the interior's width at its own height, so text follows oval and cloud bubbles. Breaks after "/"
   * are always allowed; hyphenation only when it buys a clearly larger font.
   */
  layout(text: string, area: TextArea, maxFontSize: number): TextLayout {
    const tokens = tokenize(this.withAvailableGlyphs(text));
    const geometry = this.geometry(area);
    if (tokens.length === 0 || !geometry) return { fontSize: 0, lines: [], fits: tokens.length === 0 };

    const widths = tokens.map((t) => this.font.getAdvanceWidth(t.text, MEASURE_SIZE));
    const best = (hyphenate: boolean): { size: number; lines: LayoutLine[] } | null => {
      for (let size = Math.floor(maxFontSize); size >= MIN_FONT_SIZE; size--) {
        const lines = this.fitAtSize(tokens, widths, size, geometry, hyphenate);
        if (lines) return { size, lines };
      }
      return null;
    };
    const plain = best(false);
    const hyphenated = best(true);
    const chosen = hyphenated && (!plain || hyphenated.size >= plain.size * HYPHEN_GAIN) ? hyphenated : plain;
    if (chosen) return { fontSize: chosen.size, lines: chosen.lines, fits: true };

    // Nothing fits the shape: one piece per line at the minimum size, centred on the interior
    const scale = MIN_FONT_SIZE / MEASURE_SIZE, lineHeight = Math.round(MIN_FONT_SIZE * LINE_HEIGHT);
    const top = geometry.cy - (tokens.length * lineHeight) / 2;
    const capPx = this.capHeightRatio * MIN_FONT_SIZE;
    return {
      fontSize: MIN_FONT_SIZE,
      fits: false,
      lines: tokens.map((t, i) => ({
        text: t.text,
        width: widths[i] * scale,
        x: geometry.cx - (widths[i] * scale) / 2,
        baseline: top + i * lineHeight + (lineHeight + capPx) / 2,
      })),
    };
  }

  private fitAtSize(tokens: Token[], widths: number[], size: number, g: AreaGeometry, hyphenate: boolean): LayoutLine[] | null {
    const scale = size / MEASURE_SIZE;
    const space = this.font.getAdvanceWidth(" ", size);
    const lineHeight = Math.round(size * LINE_HEIGHT);
    const capPx = this.capHeightRatio * size;
    const maxLines = Math.floor(g.height / lineHeight);

    for (let lineCount = 1; lineCount <= maxLines; lineCount++) {
      const top = Math.round(g.cy - (lineCount * lineHeight) / 2);
      if (top < 0 || top + lineCount * lineHeight > g.height) continue;

      const lines: LayoutLine[] = [];
      let next = 0;
      let carry: string | null = null; // remainder of a hyphenated word
      let failed = false;

      for (let i = 0; i < lineCount && (next < tokens.length || carry !== null); i++) {
        let l = 0, r = Number.MAX_SAFE_INTEGER;
        for (let y = top + i * lineHeight; y < top + (i + 1) * lineHeight; y++) {
          l = Math.max(l, g.left[y]);
          r = Math.min(r, g.right[y]);
        }
        const available = r - l;
        if (available <= 0) {
          failed = true;
          break;
        }

        let text = "", width = 0;
        while (next < tokens.length || carry !== null) {
          const fromCarry = carry !== null;
          const piece: string = carry ?? tokens[next].text;
          const pieceWidth = fromCarry ? this.font.getAdvanceWidth(piece, size) : widths[next] * scale;
          const gap = text === "" || (!fromCarry && tokens[next].glue) ? 0 : space;
          if (width + gap + pieceWidth <= available) {
            text += (gap ? " " : "") + piece;
            width += gap + pieceWidth;
            if (fromCarry) carry = null;
            else next++;
            continue;
          }
          if (text !== "") break;
          // The piece alone is wider than the line: hyphenate or give up on this size
          const split: { head: string; tail: string; width: number } | null = hyphenate ? this.hyphenate(piece, available, size) : null;
          if (!split) {
            failed = true;
            break;
          }
          text = split.head;
          width = split.width;
          carry = split.tail;
          if (!fromCarry) next++;
          break;
        }
        if (failed) break;
        lines.push({ text, width, x: (l + r) / 2 - width / 2, baseline: top + i * lineHeight + (lineHeight + capPx) / 2 });
      }
      if (!failed && next === tokens.length && carry === null && lines.length === lineCount) return lines;
    }
    return null;
  }

  /**
   * Split at the rightmost English hyphenation point (Knuth–Liang patterns) whose "PREFIX-" fits
   * `available`, keeping HYPHEN_MIN_PART letters on each side. Null when no legal break fits.
   */
  private hyphenate(word: string, available: number, size: number): { head: string; tail: string; width: number } | null {
    if (word.length < HYPHEN_MIN_WORD) return null;
    const breaks: number[] = [];
    let index = 0;
    for (const ch of hyphenateSync(word.toLowerCase())) {
      if (ch === SOFT_HYPHEN) breaks.push(index);
      else index++;
    }
    for (const k of breaks.reverse()) {
      if (k < HYPHEN_MIN_PART || word.length - k < HYPHEN_MIN_PART) continue;
      const head = `${word.slice(0, k)}-`;
      const width = this.font.getAdvanceWidth(head, size);
      if (width <= available) return { head, tail: word.slice(k), width };
    }
    return null;
  }

  /** Transparent SVG the size of the area's bound: outline stroke under the fill for readability. */
  renderSvg(layout: TextLayout, area: TextArea): string {
    const fill = area.dark ? "#ffffff" : "#000000";
    const stroke = area.dark ? "#000000" : "#ffffff";
    const strokeWidth = Math.max(2, Math.round(layout.fontSize * STROKE_RATIO));
    const d = layout.lines.map((line) => this.font.getPath(line.text, line.x, line.baseline, layout.fontSize).toPathData(2)).join(" ");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${area.bound.w}" height="${area.bound.h}">` +
      `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>` +
      `<path d="${d}" fill="${fill}"/></svg>`;
  }
}
