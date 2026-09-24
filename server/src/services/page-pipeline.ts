/**
 * Manga page translation pipeline, shared by the `bun run page` CLI and POST /api/translate-page.
 * Every stage reads and writes files in one job directory, so each result can be inspected (and
 * fixed) before the next stage runs:
 *
 *   detect     original.png → mask.png, overlay.png, blocks.json
 *   ocr        crops/<id>.png, source text per text block
 *   translate  translated text per text block
 *   clean      clean-text.png (bubbles, captions)  ·  clean-sfx.png (sound effects, optional)
 *   render     patches/<id>.png, render-overlay.png, result.png
 */
import sharp from "@/lib/sharp";
// Types only, erased at build: the value has to come through the shim (see lib/sharp.ts)
import type { OverlayOptions, Sharp } from "sharp";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { blockOwnerMask, labelComponents, maskFromImage, maskToPng, selectBlockMask, type BlockKind, type Box } from "@/lib/mask";
import { getTextSegmenter, textSegModelPath } from "@/services/text-seg-service";
import { getBubbleDetector } from "@/services/bubble-service";
import { getInpainter, inpaintModelPath, type CleanMethod } from "@/services/inpaint-service";
import { leftoverInk } from "@/services/clean-check";
import { getTypesetter, isDarkBackground, separateAreas, textAreaFor, type TextArea } from "@/services/typeset-service";
import { childLogger } from "@/lib/logger";
import { blockExclusion, readsAsNothing } from "@/services/block-filter";
import { rectArea, shiftArea, storedArea, typesetPage, type StoredArea, type TextStyle, type TypesetEntry } from "@/shared/typeset";

export type PageStage = "detecting" | "ocr" | "translating" | "cleaning" | "typesetting";

/**
 * Region outline drawn in the Studio. The block's box (x, y, w, h) always bounds it and is what the stages use for
 * cropping and cleaning; polygon points are in page pixels.
 */
export type BlockShape =
  | { type: "rect" }
  | { type: "ellipse" }
  | { type: "polygon"; points: { x: number; y: number }[] };

export interface PageBlock extends Box {
  id: number;
  kind: BlockKind;
  /** Absent for detector blocks and plain rectangles. */
  shape?: BlockShape;
  /** Whether the clean stages remove this block's lettering. */
  include: boolean;
  source_text: string | null;
  translated_text: string | null;
  /** Filled by `render`: the typeset result, kept for review and later manual overrides. */
  render?: { font_size: number; lines: string[]; area: Box; fits: boolean };
  /** Lettering overrides set in the Studio (font, size, colours, alignment, rotation, text box). */
  style?: TextStyle;
  /** Filled by `render`: where the text was placed, reused by the Studio's live preview. */
  area?: StoredArea;
  /** Filled by `clean`: how this block was cleaned, and how much of its lettering still shows. */
  clean?: { method: CleanMethod; ink: number };
  /** Changed since the last translation of it (its source text did): set by edits and OCR, cleared by `translate`. */
  needs_translate?: boolean;
  /** Changed since the last render (text, style, shape, cleaning): set by edits, cleared by `render`. */
  needs_render?: boolean;
}

export interface PageJob {
  source: string;
  width: number;
  height: number;
  blocks: PageBlock[];
}

export interface ProgressUpdate {
  stage: PageStage;
  message: string;
  /** 0–1 within the stage. */
  fraction: number;
  /** Per-item updates (e.g. "Reading text 3/8"), as opposed to a stage starting or finishing. */
  detail?: boolean;
}

export type ProgressReporter = (update: ProgressUpdate) => void;

/** OCR and translation are injected so the server can route them through its inference queue. */
const log = childLogger("pipeline");

export interface PipelineEngines {
  ocr(image: Buffer): Promise<string>;
  /** Translates several texts at once, answering in the same order. */
  translate(texts: string[]): Promise<{ texts: string[]; engine: string }>;
  /** How many texts the engine takes in one request: a page is sent in pieces of this size. */
  batchSize(): number;
}

export interface DetectResult {
  job: PageJob;
  grouping: string;
  maskCoverage: number;
}

export interface CleanResult {
  output: string;
  regions: number;
  total: number;
  flat: number;
  lama: number;
}

export interface RenderedBlock {
  id: number;
  fontSize: number;
  bestFontSize: number;
  lines: string[];
  fits: boolean;
}

export interface RenderResult {
  input: string;
  pageFontSize: number;
  blocks: RenderedBlock[];
  skipped: number[];
}

/** Mask layers painted in the Studio: pixels to add to, or erase from, the detector's text mask. */
export type MaskLayer = "add" | "erase";

export const MASK_LAYER_FILES: Record<MaskLayer, string> = {
  add: "mask-add.png",
  erase: "mask-erase.png",
};

/** Files produced after `detect`, removed when a page is detected again. */
const DERIVED_OUTPUTS = ["crops", "clean-text.png", "clean-sfx.png", "patches", "render-overlay.png", "result.png", ...Object.values(MASK_LAYER_FILES)];

/** Model files the pipeline cannot run without (the bubble detector is optional). */
export function missingPipelineModels(): string[] {
  return [textSegModelPath(), inpaintModelPath()].filter((path) => !existsSync(path));
}

/**
 * Upright, opaque page: applies the EXIF orientation (phone photos, some scans) and flattens transparency onto
 * white, since the stages drop alpha and transparent pixels often hide black underneath.
 */
export function normalisePage(image: Sharp): Sharp {
  return image.rotate().flatten({ background: "#ffffff" });
}

/** Bubble covering most of the block, if any. */
function matchBubble(block: Box, bubbles: Box[]): Box | null {
  let best: Box | null = null, bestShare = 0.5;
  for (const bubble of bubbles) {
    const ix = Math.max(0, Math.min(block.x + block.w, bubble.x + bubble.w) - Math.max(block.x, bubble.x));
    const iy = Math.max(0, Math.min(block.y + block.h, bubble.y + bubble.h) - Math.max(block.y, bubble.y));
    const share = (ix * iy) / (block.w * block.h);
    if (share >= bestShare) {
      best = bubble;
      bestShare = share;
    }
  }
  return best;
}

/** Where a page's blocks and metadata are stored: blocks.json for the CLI, SQLite for the server. */
export interface JobRepository {
  read(): Promise<PageJob | null>;
  write(job: PageJob): Promise<void>;
  /** result.png was just rewritten, so it holds work nobody has published; the CLI has nothing to publish and skips it. */
  resultChanged?(): Promise<void>;
}

/** Stores the job as blocks.json inside the job directory. */
export function fileJobRepository(dir: string): JobRepository {
  const path = join(dir, "blocks.json");
  return {
    read: async () => {
      const file = Bun.file(path);
      return (await file.exists()) ? ((await file.json()) as PageJob) : null;
    },
    write: async (job) => {
      await Bun.write(path, JSON.stringify(job, null, 2));
    },
  };
}

export class PagePipeline {
  constructor(
    readonly dir: string,
    private readonly report: ProgressReporter = () => {},
    private readonly repository: JobRepository = fileJobRepository(dir),
  ) {}

  /** Path of a file inside the job directory. */
  path(file: string): string {
    return join(this.dir, file);
  }

  /** Blocks and metadata, or null before `detect` has run. */
  readJob(): Promise<PageJob | null> {
    return this.repository.read();
  }

  /** Saves blocks and metadata. */
  writeJob(job: PageJob): Promise<void> {
    return this.repository.write(job);
  }

  /** Text mask and blocks. Text is grouped per bubble when the bubble detector is available. */
  async detect(image: string | Buffer, source: string): Promise<DetectResult> {
    mkdirSync(this.dir, { recursive: true });
    // Later stages pick their input by file existence, so outputs from an earlier run would go stale
    for (const stale of DERIVED_OUTPUTS) rmSync(this.path(stale), { recursive: true, force: true });
    this.report({ stage: "detecting", message: "Detecting bubbles and text…", fraction: 0 });
    await normalisePage(sharp(image)).png().toFile(this.path("original.png"));
    const page = Buffer.from(await Bun.file(this.path("original.png")).arrayBuffer());

    const detector = await getBubbleDetector();
    const textBoxes = detector ? (await detector.detect(page)).textBoxes : undefined;
    const grouping = textBoxes?.length ? `grouped by ${textBoxes.length} bubble-detector text boxes` : "grouped by text-detector boxes";
    const result = await (await getTextSegmenter()).segment(page, textBoxes);

    await Bun.write(this.path("mask.png"), await maskToPng(result.mask, result.width, result.height));
    const job: PageJob = {
      source,
      width: result.width,
      height: result.height,
      // Page numbers, texture specks and slivers of tone start out of cleaning (see block-filter): cleaning is the
      // expensive stage and the one that paints over artwork, so it is the slowest way to be wrong
      blocks: result.blocks.map((b, i) => ({
        id: i + 1,
        ...b,
        include: blockExclusion(b.kind, b, result.width, result.height) === null,
        source_text: null,
        translated_text: null,
      })),
    };
    await this.writeJob(job);
    await this.renderDetectOverlay(job);

    const textCount = job.blocks.filter((b) => b.kind === "text").length;
    this.report({ stage: "detecting", message: `Found ${textCount} text blocks and ${job.blocks.length - textCount} sound effects`, fraction: 1 });
    const covered = result.mask.reduce((sum, v) => sum + v, 0);
    return { job, grouping, maskCoverage: covered / result.mask.length };
  }

  /** Page with text pixels tinted red and numbered outlines: blue = text, orange = sfx, grey dashed = not cleaned. */
  async renderDetectOverlay(job: PageJob): Promise<void> {
    const { data: rgb, info } = await sharp(this.path("original.png")).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    const { mask } = await maskFromImage(this.path("mask.png"));
    const tinted = Buffer.from(rgb);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      tinted[i * 3] = Math.round(rgb[i * 3] * 0.4 + 153);
      tinted[i * 3 + 1] = Math.round(rgb[i * 3 + 1] * 0.4);
      tinted[i * 3 + 2] = Math.round(rgb[i * 3 + 2] * 0.4);
    }
    const longSide = Math.max(info.width, info.height);
    const stroke = Math.max(2, Math.round(longSide / 500));
    const font = Math.max(16, Math.round(longSide / 60));
    const shapes = job.blocks.map((b) => {
      const color = !b.include ? "#888888" : b.kind === "text" ? "#0096ff" : "#ff8c00";
      const dash = b.include ? "" : ` stroke-dasharray="${stroke * 4} ${stroke * 3}"`;
      return `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="${color}" stroke-width="${stroke}"${dash}/>` +
        `<text x="${b.x + stroke * 2}" y="${b.y + font}" font-size="${font}" font-family="sans-serif" font-weight="bold" fill="${color}" stroke="#ffffff" stroke-width="${Math.max(2, Math.round(font / 6))}" paint-order="stroke">${b.id}</text>`;
    }).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}">${shapes}</svg>`;
    await sharp(tinted, { raw: { width: info.width, height: info.height, channels: 3 } })
      .composite([{ input: Buffer.from(svg) }])
      .png()
      .toFile(this.path("overlay.png"));
  }

  /** Crops each text block (or only `blockIds`) from original.png and reads its source text. */
  async ocr(job: PageJob, readText: PipelineEngines["ocr"], blockIds?: number[]): Promise<void> {
    mkdirSync(this.path("crops"), { recursive: true });
    const targets = job.blocks.filter((b) => b.kind === "text" && (!blockIds || blockIds.includes(b.id)));
    this.report({ stage: "ocr", message: `Reading ${targets.length} text blocks…`, fraction: 0 });
    for (const [i, b] of targets.entries()) {
      this.report({ stage: "ocr", message: `Reading text ${i + 1}/${targets.length}`, fraction: i / targets.length, detail: true });
      const crop = await sharp(this.path("original.png")).extract({ left: b.x, top: b.y, width: b.w, height: b.h }).png().toBuffer();
      await Bun.write(this.path(`crops/${b.id}.png`), crop);
      const read = await readText(crop);
      // A new reading needs translating and lettering again; the same reading changes nothing
      const changed = read !== b.source_text;
      if (changed) {
        b.needs_translate = true;
        b.needs_render = true;
        // A new reading that says nothing at all — no text, or only punctuation, which reads the same in either
        // language — takes the block out of cleaning: painting over artwork to remove nothing costs the artwork.
        // It stays on the page, dashed, for anyone who thinks the reader was wrong.
        //
        // Only on a *new* reading, though. Someone who put such a block back means it, and reading it again to the
        // same nothing is no reason to overrule them.
        if (readsAsNothing(read)) {
          if (b.include) log.info({ block: b.id, read }, "Block reads as nothing: leaving it out of cleaning");
          b.include = false;
        }
      }
      b.source_text = read;
    }
    await this.writeJob(job);
    this.report({ stage: "ocr", message: `Read ${targets.length} text blocks`, fraction: 1 });
  }

  /**
   * Translates text blocks with source text (or only `blockIds`); returns the engine used (e.g. "deepl"), or null
   * when there was nothing to translate.
   *
   * A page goes in pieces of whatever the engine takes at once. A remote engine spends its time waiting for the
   * answer rather than translating, so a page's blocks sent one at a time cost one wait each — measured at 2.7s of
   * a 5.3s page, with the processor idle throughout. The built-in model takes one text, which leaves this exactly
   * as it was, progress included.
   */
  async translate(job: PageJob, engines: Pick<PipelineEngines, "translate" | "batchSize">, blockIds?: number[]): Promise<string | null> {
    const targets = job.blocks.filter((b) => b.kind === "text" && b.source_text?.trim() && (!blockIds || blockIds.includes(b.id)));
    this.report({ stage: "translating", message: `Translating ${targets.length} text blocks…`, fraction: 0 });
    let engine: string | null = null;
    const size = Math.max(1, engines.batchSize());
    for (let from = 0; from < targets.length; from += size) {
      const batch = targets.slice(from, from + size);
      const upto = Math.min(from + batch.length, targets.length);
      this.report({
        stage: "translating",
        message: targets.length === batch.length ? `Translating ${targets.length} text blocks…` : `Translating ${upto}/${targets.length}`,
        fraction: from / targets.length,
        detail: true,
      });
      const out = await engines.translate(batch.map((b) => b.source_text ?? ""));
      // Position is what ties a translation to its block, so anything else is a mismatch rather than a guess
      if (out.texts.length !== batch.length) throw new Error(`the translator answered with ${out.texts.length} translations for ${batch.length} blocks`);
      for (const [i, b] of batch.entries()) {
        const translated = out.texts[i] ?? "";
        if (translated !== b.translated_text) b.needs_render = true;
        b.translated_text = translated;
        b.needs_translate = false;
      }
      engine = out.engine;
    }
    await this.writeJob(job);
    this.report({ stage: "translating", message: `Translated ${targets.length} text blocks${engine ? ` (${engine})` : ""}`, fraction: 1 });
    return engine;
  }

  /**
   * Remove the lettering of included blocks of one kind: "text" reads original.png → clean-text.png,
   * "sfx" reads clean-text.png → clean-sfx.png. Blob ownership is decided against all blocks, so the
   * other kind's pixels are never touched. Returns null when no block of that kind is included (the
   * output is then a copy of the input).
   */
  async clean(job: PageJob, kind: BlockKind): Promise<CleanResult | null> {
    const input = kind === "text" ? "original.png" : "clean-text.png";
    const output = kind === "text" ? "clean-text.png" : "clean-sfx.png";
    const label = kind === "text" ? "bubbles and captions" : "sound effects";
    if (!existsSync(this.path(input))) throw new Error(`${input} not found — clean the text blocks first`);
    // Re-cleaning text makes an earlier sound-effect pass stale
    if (kind === "text") rmSync(this.path("clean-sfx.png"), { force: true });

    const regions = job.blocks.filter((b) => b.kind === kind && b.include);
    const total = job.blocks.filter((b) => b.kind === kind).length;
    /**
     * Self-checks this pass makes untrue: blocks of this kind it doesn't clean (they were left out), and — when text
     * is cleaned — every sound effect, since the pass that cleaned them was just thrown away with clean-sfx.png.
     */
    const dropStaleChecks = (): void => {
      for (const block of job.blocks) {
        if ((block.kind === kind && !regions.includes(block)) || (kind === "text" && block.kind === "sfx")) delete block.clean;
      }
    };
    const hasPainted = kind === "text" && existsSync(this.path(MASK_LAYER_FILES.add));
    if (regions.length === 0 && !hasPainted) {
      // Still write the output: later stages choose their input by file existence
      await sharp(this.path(input)).png().toFile(this.path(output));
      dropStaleChecks();
      await this.writeJob(job);
      this.report({ stage: "cleaning", message: `No ${label} to clean`, fraction: 1 });
      return null;
    }
    this.report({ stage: "cleaning", message: `Cleaning ${regions.length} ${label}${hasPainted ? " and painted areas" : ""}…`, fraction: 0 });

    const { data: rgb, info } = await sharp(this.path(input)).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    const { mask, added, width, height } = await this.effectiveMask();
    if (width !== info.width || height !== info.height) throw new Error(`mask.png size does not match ${input}`);
    const selection = job.blocks.map((b) => ({ ...b, include: b.kind === kind && b.include }));
    const target = selectBlockMask(mask, width, height, selection);

    // Painted additions are removed in the text pass wherever they are, even outside any block: the user asked for it
    const paintedRegions: Box[] = [];
    if (kind === "text" && added) {
      for (let i = 0; i < target.length; i++) if (added[i]) target[i] = 1;
      paintedRegions.push(...labelComponents(added, width, height).boxes);
    }

    const inpainter = await getInpainter();
    const { rgb: cleaned, flat, lama, methods } = await inpainter.inpaintRgb(rgb, width, height, target, [...regions, ...paintedRegions]);
    await sharp(cleaned, { raw: { width, height, channels: 3 } }).png().toFile(this.path(output));

    // The self-check: how each block was cleaned, and how much of its lettering still shows on the page just written.
    // Measured against the mask the clean actually removed, painted additions included
    // Measured against everything this pass removed, with each stroke's owner worked out from the detector's mask
    // alone: painting a stroke between two blocks joins their lettering into one blob, which belongs to neither, and
    // measuring by the joined mask would quietly drop both blocks' strokes
    const ink = await leftoverInk(this.path(output), await maskToPng(mask, width, height), regions, await this.strokeOwners(job, width, height));
    dropStaleChecks();
    for (const [i, block] of regions.entries()) {
      block.clean = { method: methods[i] ?? "lama", ink: ink[i]?.ink ?? 0 };
    }
    // The other stages save the job themselves; this one has the self-check to record
    await this.writeJob(job);
    const painted = paintedRegions.length > 0 ? ` and ${paintedRegions.length} painted area${paintedRegions.length === 1 ? "" : "s"}` : "";
    this.report({ stage: "cleaning", message: `Cleaned ${regions.length} ${label}${painted} (${flat} flat fill, ${lama} LaMa)`, fraction: 1 });
    // Painted areas count as cleaned regions too (a page may have nothing but painted areas)
    return { output, regions: regions.length + paintedRegions.length, total: total + paintedRegions.length, flat, lama };
  }

  /**
   * Text mask the clean stages remove: the detector's mask.png, plus pixels painted into mask-add.png, minus pixels
   * painted into mask-erase.png. `added` is the painted-in layer minus erasures (null when there is none). Layers
   * with a different size than mask.png are refused rather than stretched.
   */
  /**
   * Which block owns each stroke, from the detector's mask alone. Painted additions are left out on purpose: a stroke
   * painted between two blocks would join their lettering into one blob, and whichever block didn't get it would
   * measure as clean. A pixel nobody owns (painted, or a blob no block claims) counts for no block.
   */
  private async strokeOwners(job: PageJob, width: number, height: number): Promise<Int32Array> {
    const detected = await maskFromImage(this.path("mask.png"));
    if (detected.width !== width || detected.height !== height) throw new Error("mask.png size does not match the page");
    return blockOwnerMask(detected.mask, width, height, job.blocks);
  }

  async effectiveMask(): Promise<{ mask: Uint8Array; added: Uint8Array | null; width: number; height: number }> {
    const { mask, width, height } = await maskFromImage(this.path("mask.png"));
    const layer = async (name: MaskLayer): Promise<Uint8Array | null> => {
      const file = this.path(MASK_LAYER_FILES[name]);
      if (!existsSync(file)) return null;
      const decoded = await maskFromImage(file);
      if (decoded.width !== width || decoded.height !== height) throw new Error(`${MASK_LAYER_FILES[name]} size does not match mask.png`);
      return decoded.mask;
    };
    const [add, erase] = await Promise.all([layer("add"), layer("erase")]);
    const added = add ? new Uint8Array(add.length) : null;
    for (let i = 0; i < mask.length; i++) {
      if (add?.[i] && !erase?.[i]) {
        mask[i] = 1;
        if (added) added[i] = 1;
      }
      if (erase?.[i]) mask[i] = 0;
    }
    return { mask, added, width, height };
  }

  /**
   * Re-clean only `areas` of the latest cleaned page (the image render reads: clean-sfx.png when present, otherwise
   * clean-text.png), removing the effective mask inside them. Everything outside the areas stays byte-identical, so a
   * missed stroke can be painted and fixed without re-cleaning the page. Block ownership doesn't apply here: the user
   * picked the areas.
   */
  async recleanAreas(areas: Box[]): Promise<CleanResult> {
    const output = existsSync(this.path("clean-sfx.png")) ? "clean-sfx.png" : "clean-text.png";
    if (!existsSync(this.path(output))) throw new Error("No cleaned page yet — clean the text blocks first");
    this.report({ stage: "cleaning", message: `Re-cleaning ${areas.length} area${areas.length === 1 ? "" : "s"}…`, fraction: 0 });

    const { data: rgb, info } = await sharp(this.path(output)).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    const { mask, width, height } = await this.effectiveMask();
    if (width !== info.width || height !== info.height) throw new Error(`mask.png size does not match ${output}`);

    const target = new Uint8Array(width * height);
    // Whole pixels covering each area (callers other than the route may pass fractions), clipped to the page
    const clipped = areas
      .map((a) => {
        const x0 = Math.max(0, Math.floor(a.x));
        const y0 = Math.max(0, Math.floor(a.y));
        const x1 = Math.min(width, Math.ceil(a.x + a.w));
        const y1 = Math.min(height, Math.ceil(a.y + a.h));
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      })
      .filter((a) => a.w > 0 && a.h > 0);
    for (const area of clipped) {
      for (let y = area.y; y < area.y + area.h; y++) {
        for (let x = area.x; x < area.x + area.w; x++) {
          const p = y * width + x;
          if (mask[p]) target[p] = 1;
        }
      }
    }

    const inpainter = await getInpainter();
    const { rgb: cleaned, flat, lama } = await inpainter.inpaintRgb(rgb, width, height, target, clipped);
    await sharp(cleaned, { raw: { width, height, channels: 3 } }).png().toFile(this.path(output));
    this.report({ stage: "cleaning", message: `Re-cleaned ${clipped.length} area${clipped.length === 1 ? "" : "s"} (${flat} flat fill, ${lama} LaMa)`, fraction: 1 });
    return { output, regions: clipped.length, total: clipped.length, flat, lama };
  }

  /**
   * Measures the blocks' leftover ink again on the page as it is now, keeping how each was cleaned. For after a
   * re-clean of a few areas, which fixes what the blocks' own clean left behind.
   */
  async refreshCleanCheck(job: PageJob): Promise<void> {
    const output = existsSync(this.path("clean-sfx.png")) ? "clean-sfx.png" : "clean-text.png";
    if (!existsSync(this.path(output))) return;
    const checked = job.blocks.filter((b) => b.clean);
    if (checked.length === 0) return;
    const { mask, width, height } = await this.effectiveMask();
    // Through the same ownership filter the clean used, so a neighbour's strokes inside this block's box aren't
    // counted against it
    const ink = await leftoverInk(this.path(output), await maskToPng(mask, width, height), checked, await this.strokeOwners(job, width, height));
    for (const [i, block] of checked.entries()) block.clean = { method: block.clean!.method, ink: ink[i]?.ink ?? 0 };
  }

  /**
   * Finds where each block's lettering may go on the latest cleaned page and stores it on the blocks: a text block's
   * bubble interior (separated from neighbouring interiors), or its own box when it's written on the artwork with no
   * bubble; a sound effect's own box. Returns the page and its pixels for a burn that follows.
   */
  private async findAreas(job: PageJob): Promise<{ input: string; page: Buffer; rgb: Buffer; width: number; height: number; areas: Map<number, TextArea> }> {
    const input = existsSync(this.path("clean-sfx.png")) ? "clean-sfx.png" : "clean-text.png";
    if (!existsSync(this.path(input))) throw new Error("No cleaned page yet — clean the text blocks first");
    const page = Buffer.from(await Bun.file(this.path(input)).arrayBuffer());
    const { data: rgb, info } = await sharp(page).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;

    // Bubbles are detected again on the cleaned page: without the original lettering the outlines are unambiguous
    const detector = job.blocks.some((b) => b.kind === "text") ? await getBubbleDetector() : null;
    const bubbles = detector ? (await detector.detect(page)).bubbles : [];

    const areas = new Map<number, TextArea>();
    const detected: { block: PageBlock; area: TextArea }[] = [];
    for (const b of job.blocks) {
      delete b.area;
      let area: TextArea | null = null;
      if (b.kind === "sfx") area = rectArea(b, isDarkBackground(rgb, width, height, b));
      else if (b.kind === "text") {
        area = textAreaFor(rgb, width, height, b, matchBubble(b, bubbles));
        if (area) detected.push({ block: b, area });
      }
      if (area) areas.set(b.id, area);
    }
    separateAreas(detected);
    for (const b of job.blocks) {
      const area = areas.get(b.id);
      if (area) b.area = storedArea(area);
    }
    return { input, page, rgb, width, height, areas };
  }

  /** Stores every block's text area without burning, so the Studio can preview lettering before any render. */
  async placeText(job: PageJob): Promise<number> {
    const { areas } = await this.findAreas(job);
    await this.writeJob(job);
    return areas.size;
  }

  /** Typeset translations inside each bubble on the latest cleaned page → result.png. */
  async render(job: PageJob): Promise<RenderResult> {
    // Text blocks carry translations; sound-effect regions are re-lettered when given text in the Studio
    const targets = job.blocks.filter((b) => (b.kind === "text" || b.kind === "sfx") && b.translated_text?.trim());
    this.report({ stage: "typesetting", message: `Typesetting ${targets.length} translations…`, fraction: 0 });

    const { input, page, rgb, width, height, areas } = await this.findAreas(job);
    // A block this run doesn't typeset (skipped, or no translation any more) must not keep an older patch
    for (const b of job.blocks) delete b.render;
    rmSync(this.path("patches"), { recursive: true, force: true });
    mkdirSync(this.path("patches"), { recursive: true });

    const entries: TypesetEntry[] = [];
    const skipped: number[] = [];
    for (const b of targets) {
      const style = b.style ?? {};
      const found = areas.get(b.id);
      // An explicit box wins; otherwise the found area, moved by the block's offset
      const area = style.box
        ? rectArea(style.box, isDarkBackground(rgb, width, height, style.box))
        : found ? shiftArea(found, style.offset) : null;
      if (area) entries.push({ id: b.id, text: b.translated_text ?? "", area, style });
      else skipped.push(b.id);
    }

    const typesetter = await getTypesetter();
    const typeset = typesetPage(typesetter, entries, { width, height });
    skipped.push(...typeset.skipped);
    const pageFontSize = typeset.pageFontSize;

    const patches: OverlayOptions[] = [];
    const rendered: RenderedBlock[] = [];
    const laidOut: TextArea[] = [];
    for (const result of typeset.blocks) {
      const entry = entries.find((e) => e.id === result.id);
      const b = job.blocks.find((block) => block.id === result.id);
      if (!entry || !b) continue;
      if (!result.patch) {
        skipped.push(b.id);
        continue;
      }
      laidOut.push(entry.area);
      const patch = await sharp(Buffer.from(result.patch.svg)).png().toBuffer();
      await Bun.write(this.path(`patches/${b.id}.png`), patch);
      patches.push({ input: patch, left: result.patch.x, top: result.patch.y });
      const lines = result.layout.lines.map((l) => l.text);
      b.render = { font_size: result.layout.fontSize, lines, area: entry.area.bound, fits: result.layout.fits };
      rendered.push({ id: b.id, fontSize: result.layout.fontSize, bestFontSize: result.bestFontSize, lines, fits: result.layout.fits });
    }

    await sharp(page).composite(patches).png().toFile(this.path("result.png"));
    await this.repository.resultChanged?.();
    // A render covers the whole page, so every block's lettering is now what was burned
    for (const b of job.blocks) b.needs_render = false;
    await this.renderTypesetOverlay(rgb, width, height, laidOut, patches);
    await this.writeJob(job);
    this.report({ stage: "typesetting", message: `Typeset ${rendered.length} translations`, fraction: 1 });
    return { input, pageFontSize, blocks: rendered, skipped };
  }

  /** Where text was allowed (green) and each area's bound, with the patches on top — for reviewing placement. */
  private async renderTypesetOverlay(rgb: Buffer, width: number, height: number, areas: TextArea[], patches: OverlayOptions[]): Promise<void> {
    const tinted = Buffer.from(rgb);
    for (const area of areas) {
      for (let y = 0; y < area.bound.h; y++) {
        // A moved text area can hang off the page: skip what's outside rather than wrapping into other rows
        const py = y + area.bound.y;
        if (py < 0 || py >= height) continue;
        for (let x = 0; x < area.bound.w; x++) {
          const px = x + area.bound.x;
          if (px < 0 || px >= width || !area.mask[y * area.bound.w + x]) continue;
          const p = (py * width + px) * 3;
          tinted[p] = Math.round(tinted[p] * 0.6);
          tinted[p + 1] = Math.round(tinted[p + 1] * 0.6 + 100);
          tinted[p + 2] = Math.round(tinted[p + 2] * 0.6);
        }
      }
    }
    const outlines = areas.map((a) => `<rect x="${a.bound.x}" y="${a.bound.y}" width="${a.bound.w}" height="${a.bound.h}" fill="none" stroke="#00a000" stroke-width="2"/>`).join("");
    await sharp(tinted, { raw: { width, height, channels: 3 } })
      .composite([...patches, { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${outlines}</svg>`) }])
      .png()
      .toFile(this.path("render-overlay.png"));
  }
}
