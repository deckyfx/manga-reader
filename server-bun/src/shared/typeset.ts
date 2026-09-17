/**
 * Typesetting shared by the server (burning text into the page) and the Studio (live preview while editing), so the
 * preview matches the burned result. Browser-safe: fonts come in as bytes and nothing here touches the file system or
 * sharp. Finding a block's text area needs the cleaned page and the bubble detector, so that stays on the server; the
 * area is stored with the block and reused here.
 */
import { parse, type Font } from "opentype.js";
import { hyphenateSync } from "hyphen/en";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FONT_VARIANTS = ["regular", "bold", "italic"] as const;
export type FontVariant = (typeof FONT_VARIANTS)[number];

export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

/** Per-block overrides; every field is optional and falls back to the automatic layout. */
export interface TextStyle {
  /** Anime Ace variant (default: bold). */
  font?: FontVariant;
  /** Fixed size in page pixels; absent means the largest size that fits, capped by the page size. */
  font_size?: number;
  /** `#rrggbb`; absent means black on light backgrounds, white on dark ones. */
  fill?: string;
  stroke?: string;
  /** Outline width in page pixels (0 = none); absent means 14% of the font size. */
  stroke_width?: number;
  align?: TextAlign;
  /** Line spacing as a multiple of the font size (default 1.1). */
  line_height?: number;
  /** Letter everything in capitals, as comics do (default true). */
  uppercase?: boolean;
  /** Clockwise rotation in degrees around the text box centre. */
  rotation?: number;
  /** Explicit text box in page pixels, used instead of the detected bubble interior. */
  box?: Box;
}

/** Where text may be placed: a mask local to `bound` (1 = allowed). */
export interface TextArea {
  bound: Box;
  mask: Uint8Array;
  /** Dark background → light text by default. */
  dark: boolean;
}

/** A text area as stored with a block: the mask run-length encoded (see {@link encodeMask}). */
export interface StoredArea {
  bound: Box;
  dark: boolean;
  mask: number[];
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
  /** False when the text overflowed its area (auto: even at the minimum size; fixed: at the chosen size). */
  fits: boolean;
}

/** Text rendered as a transparent SVG placed at (x, y) on the page. */
export interface TextPatch {
  x: number;
  y: number;
  width: number;
  height: number;
  svg: string;
}

const DEFAULT_FONT: FontVariant = "bold";
const LINE_HEIGHT = 1.1;
const MIN_FONT_SIZE = 10;
const STROKE_RATIO = 0.14;
/** Word widths are measured once at this size and scaled (advance width is linear in font size). */
const MEASURE_SIZE = 100;
/** Words shorter than this are never hyphenated; each part keeps at least HYPHEN_MIN_PART letters. */
const HYPHEN_MIN_WORD = 7;
const HYPHEN_MIN_PART = 3;
/** Hyphenate only when it allows a clearly larger font. */
const HYPHEN_GAIN = 1.35;
const SOFT_HYPHEN = "­";
/** The automatic size is capped at page height / this, so lettering stays in proportion to the page. */
const PAGE_SIZE_DIVISOR = 40;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
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
  width: number;
  height: number;
}

/** Everything one layout pass needs, resolved from the style. */
interface LayoutContext {
  font: Font;
  tokens: Token[];
  widths: number[];
  geometry: AreaGeometry;
  lineHeight: number;
  align: TextAlign;
}

/** A whole-box area: an explicit text box, or a sound-effect region. */
export function rectArea(box: Box, dark: boolean): TextArea {
  const bound = { x: Math.round(box.x), y: Math.round(box.y), w: Math.max(1, Math.round(box.w)), h: Math.max(1, Math.round(box.h)) };
  return { bound, mask: new Uint8Array(bound.w * bound.h).fill(1), dark };
}

/** Run lengths of a 0/1 mask, alternating and starting with a (possibly empty) run of zeros. */
export function encodeMask(mask: Uint8Array): number[] {
  const runs: number[] = [];
  let value = 0, run = 0;
  for (const v of mask) {
    if ((v ? 1 : 0) === value) {
      run++;
      continue;
    }
    runs.push(run);
    value = 1 - value;
    run = 1;
  }
  runs.push(run);
  return runs;
}

export function decodeMask(runs: readonly number[], length: number): Uint8Array {
  const mask = new Uint8Array(length);
  let i = 0;
  runs.forEach((run, k) => {
    if (k % 2 === 1) mask.fill(1, i, Math.min(length, i + run));
    i += run;
  });
  return mask;
}

export function storedArea(area: TextArea): StoredArea {
  return { bound: area.bound, dark: area.dark, mask: encodeMask(area.mask) };
}

export function areaFromStored(stored: StoredArea): TextArea {
  return { bound: stored.bound, dark: stored.dark, mask: decodeMask(stored.mask, stored.bound.w * stored.bound.h) };
}

function tokenize(text: string, uppercase: boolean): Token[] {
  const tokens: Token[] = [];
  for (const word of (uppercase ? text.toUpperCase() : text).split(/\s+/).filter(Boolean)) {
    word.split(/(?<=\/)/).forEach((part, i) => tokens.push({ text: part, glue: i > 0 }));
  }
  return tokens;
}

function capHeightRatio(font: Font): number {
  const os2 = font.tables.os2 as { sCapHeight?: number } | undefined;
  return (os2?.sCapHeight || font.ascender * 0.7) / font.unitsPerEm;
}

function areaGeometry(area: TextArea): AreaGeometry | null {
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
  return { left, right, cx, cy, width: w, height: h };
}

/** Left edge of a line of `width` inside the span [l, r], by alignment. */
function lineX(align: TextAlign, l: number, r: number, width: number): number {
  if (align === "left") return l;
  if (align === "right") return r - width;
  return (l + r) / 2 - width / 2;
}

const safeColor = (value: string | undefined, fallback: string): string => (value && HEX_COLOR.test(value) ? value : fallback);

export class Typesetter {
  constructor(private readonly fonts: Record<FontVariant, Font>) {}

  /** Parses the three Anime Ace variants (regular, bold, italic). */
  static fromBuffers(buffers: Record<FontVariant, ArrayBuffer>): Typesetter {
    return new Typesetter({ regular: parse(buffers.regular), bold: parse(buffers.bold), italic: parse(buffers.italic) });
  }

  private fontFor(style: TextStyle): Font {
    return this.fonts[style.font ?? DEFAULT_FONT] ?? this.fonts[DEFAULT_FONT];
  }

  /**
   * Replace characters the font has no glyph for with ASCII look-alikes. Translations often contain
   * typographic punctuation (DeepL's em dash, curly quotes) that comic fonts like Anime Ace lack, which
   * would otherwise render as empty boxes.
   */
  private withAvailableGlyphs(font: Font, text: string): string {
    let result = "";
    for (const ch of text) {
      const fallback = GLYPH_FALLBACKS[ch];
      result += fallback !== undefined && font.charToGlyphIndex(ch) === 0 ? fallback : ch;
    }
    return result;
  }

  /**
   * Word-wrapped lines of `text` inside the area's shape. With a fixed `style.font_size` the text is wrapped at that
   * size; otherwise the largest size up to `maxFontSize` that fits is chosen. Each line gets the interior's width at
   * its own height, so text follows oval and cloud bubbles. Breaks after "/" are always allowed; hyphenation only
   * when it buys a clearly larger font (or is needed at a fixed size).
   */
  layout(text: string, area: TextArea, maxFontSize: number, style: TextStyle = {}): TextLayout {
    const font = this.fontFor(style);
    const tokens = tokenize(this.withAvailableGlyphs(font, text), style.uppercase ?? true);
    const geometry = areaGeometry(area);
    if (tokens.length === 0 || !geometry) return { fontSize: 0, lines: [], fits: tokens.length === 0 };

    const ctx: LayoutContext = {
      font,
      tokens,
      widths: tokens.map((t) => font.getAdvanceWidth(t.text, MEASURE_SIZE)),
      geometry,
      lineHeight: style.line_height ?? LINE_HEIGHT,
      align: style.align ?? "center",
    };

    if (style.font_size !== undefined) {
      const size = style.font_size;
      const lines = this.fitAtSize(ctx, size, false) ?? this.fitAtSize(ctx, size, true);
      return lines ? { fontSize: size, lines, fits: true } : { fontSize: size, lines: this.overflowLines(ctx, size), fits: false };
    }

    const best = (hyphenate: boolean): { size: number; lines: LayoutLine[] } | null => {
      for (let size = Math.floor(maxFontSize); size >= MIN_FONT_SIZE; size--) {
        const lines = this.fitAtSize(ctx, size, hyphenate);
        if (lines) return { size, lines };
      }
      return null;
    };
    const plain = best(false);
    const hyphenated = best(true);
    const chosen = hyphenated && (!plain || hyphenated.size >= plain.size * HYPHEN_GAIN) ? hyphenated : plain;
    if (chosen) return { fontSize: chosen.size, lines: chosen.lines, fits: true };
    return { fontSize: MIN_FONT_SIZE, lines: this.overflowLines(ctx, MIN_FONT_SIZE), fits: false };
  }

  /** Text that doesn't fit the shape: wrapped to the area's full width and centred vertically, spilling over. */
  private overflowLines(ctx: LayoutContext, size: number): LayoutLine[] {
    const { font, tokens, widths, geometry, align } = ctx;
    const scale = size / MEASURE_SIZE;
    const space = font.getAdvanceWidth(" ", size);
    const rows: { text: string; width: number }[] = [];
    for (const [i, token] of tokens.entries()) {
      const width = widths[i] * scale;
      const last = rows.at(-1);
      const gap = token.glue ? 0 : space;
      if (last && last.width + gap + width <= geometry.width) {
        last.text += (gap ? " " : "") + token.text;
        last.width += gap + width;
      } else {
        rows.push({ text: token.text, width });
      }
    }
    const lineHeight = Math.round(size * ctx.lineHeight);
    const capPx = capHeightRatio(font) * size;
    const top = geometry.cy - (rows.length * lineHeight) / 2;
    return rows.map((row, i) => ({
      text: row.text,
      width: row.width,
      x: lineX(align, 0, geometry.width, row.width),
      baseline: top + i * lineHeight + (lineHeight + capPx) / 2,
    }));
  }

  private fitAtSize(ctx: LayoutContext, size: number, hyphenate: boolean): LayoutLine[] | null {
    const { font, tokens, widths, geometry: g, align } = ctx;
    const scale = size / MEASURE_SIZE;
    const space = font.getAdvanceWidth(" ", size);
    const lineHeight = Math.max(1, Math.round(size * ctx.lineHeight));
    const capPx = capHeightRatio(font) * size;
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
          const pieceWidth = fromCarry ? font.getAdvanceWidth(piece, size) : widths[next] * scale;
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
          const split: { head: string; tail: string; width: number } | null = hyphenate ? this.hyphenate(font, piece, available, size) : null;
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
        lines.push({ text, width, x: lineX(align, l, r, width), baseline: top + i * lineHeight + (lineHeight + capPx) / 2 });
      }
      if (!failed && next === tokens.length && carry === null && lines.length === lineCount) return lines;
    }
    return null;
  }

  /**
   * Split at the rightmost English hyphenation point (Knuth–Liang patterns) whose "PREFIX-" fits
   * `available`, keeping HYPHEN_MIN_PART letters on each side. Null when no legal break fits.
   */
  private hyphenate(font: Font, word: string, available: number, size: number): { head: string; tail: string; width: number } | null {
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
      const width = font.getAdvanceWidth(head, size);
      if (width <= available) return { head, tail: word.slice(k), width };
    }
    return null;
  }

  /**
   * The layout as a transparent SVG patch: outline stroke under the fill for readability, rotated around the area's
   * centre. The patch covers the rotated area plus room for the stroke, clipped to `page` when given; null when it
   * has nothing to draw.
   */
  renderPatch(layout: TextLayout, area: TextArea, style: TextStyle = {}, page?: { width: number; height: number }): TextPatch | null {
    if (layout.lines.length === 0 || layout.fontSize <= 0) return null;
    const font = this.fontFor(style);
    const fill = safeColor(style.fill, area.dark ? "#ffffff" : "#000000");
    const stroke = safeColor(style.stroke, area.dark ? "#000000" : "#ffffff");
    const strokeWidth = Math.max(0, style.stroke_width ?? Math.max(2, Math.round(layout.fontSize * STROKE_RATIO)));
    const d = layout.lines.map((line) => font.getPath(line.text, line.x, line.baseline, layout.fontSize).toPathData(2)).join(" ").trim();
    if (!d) return null;

    const { bound } = area;
    const rotation = ((((style.rotation ?? 0) + 180) % 360) + 360) % 360 - 180;
    const radians = (rotation * Math.PI) / 180;
    // Room for the stroke, and for lines that spill past the area when the text doesn't fit
    const spill = layout.fits ? 0 : layout.fontSize * 2;
    const pad = Math.ceil(strokeWidth / 2) + 2 + spill;
    const halfW = bound.w / 2 + pad, halfH = bound.h / 2 + pad;
    const cx = bound.x + bound.w / 2, cy = bound.y + bound.h / 2;
    const extentX = Math.abs(halfW * Math.cos(radians)) + Math.abs(halfH * Math.sin(radians));
    const extentY = Math.abs(halfW * Math.sin(radians)) + Math.abs(halfH * Math.cos(radians));
    let x0 = Math.floor(cx - extentX), y0 = Math.floor(cy - extentY);
    let x1 = Math.ceil(cx + extentX), y1 = Math.ceil(cy + extentY);
    if (page) {
      x0 = Math.max(0, x0);
      y0 = Math.max(0, y0);
      x1 = Math.min(page.width, x1);
      y1 = Math.min(page.height, y1);
    }
    const width = x1 - x0, height = y1 - y0;
    if (width <= 0 || height <= 0) return null;

    const transform = `translate(${bound.x - x0} ${bound.y - y0})${rotation ? ` rotate(${rotation} ${bound.w / 2} ${bound.h / 2})` : ""}`;
    const outline = strokeWidth > 0
      ? `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`
      : "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<g transform="${transform}">${outline}<path d="${d}" fill="${fill}"/></g></svg>`;
    return { x: x0, y: y0, width, height, svg };
  }
}

/** One block to letter: its translation, where it goes, and its style. */
export interface TypesetEntry {
  id: number;
  text: string;
  area: TextArea;
  style: TextStyle;
}

export interface TypesetBlock {
  id: number;
  layout: TextLayout;
  /** Largest size the block could take on its own (its fixed size when set). */
  bestFontSize: number;
  patch: TextPatch | null;
}

/**
 * Letters a whole page. Blocks on the automatic size share one page size (the median of their best sizes, capped by
 * the page height), so lettering looks consistent; a block with a fixed size keeps it. Blocks whose area has no room
 * are returned in `skipped`.
 */
export function typesetPage(
  typesetter: Typesetter,
  entries: readonly TypesetEntry[],
  page: { width: number; height: number },
): { pageFontSize: number; blocks: TypesetBlock[]; skipped: number[] } {
  const maxFontSize = Math.round(page.height / PAGE_SIZE_DIVISOR);
  const bestSizes = entries.map((e) => e.style.font_size ?? typesetter.layout(e.text, e.area, maxFontSize, e.style).fontSize);
  // Size 0 means the area has no room: it must not drag the page size down to the minimum
  const autoSizes = entries
    .flatMap((e, i) => (e.style.font_size === undefined && bestSizes[i] > 0 ? [bestSizes[i]] : []))
    .sort((a, b) => a - b);
  const pageFontSize = autoSizes[Math.floor((autoSizes.length - 1) / 2)] ?? maxFontSize;

  const blocks: TypesetBlock[] = [];
  const skipped: number[] = [];
  for (const [i, entry] of entries.entries()) {
    if (bestSizes[i] <= 0) {
      skipped.push(entry.id);
      continue;
    }
    const cap = entry.style.font_size === undefined ? Math.min(pageFontSize, bestSizes[i]) : maxFontSize;
    const layout = typesetter.layout(entry.text, entry.area, cap, entry.style);
    blocks.push({ id: entry.id, layout, bestFontSize: bestSizes[i], patch: typesetter.renderPatch(layout, entry.area, entry.style, page) });
  }
  return { pageFontSize, blocks, skipped };
}
