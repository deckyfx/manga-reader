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
import sharp, { type OverlayOptions, type Sharp } from "sharp";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { labelComponents, maskFromImage, maskToPng, selectBlockMask, type BlockKind, type Box } from "@/lib/mask";
import { getTextSegmenter, textSegModelPath } from "@/services/text-seg-service";
import { getBubbleDetector } from "@/services/bubble-service";
import { getInpainter, inpaintModelPath } from "@/services/inpaint-service";
import { findTextArea, getTypesetter, separateAreas, type TextArea } from "@/services/typeset-service";

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
export interface PipelineEngines {
  ocr(image: Buffer): Promise<string>;
  translate(text: string): Promise<{ text: string; engine: string }>;
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
      blocks: result.blocks.map((b, i) => ({ id: i + 1, ...b, include: true, source_text: null, translated_text: null })),
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
      b.source_text = await readText(crop);
    }
    await this.writeJob(job);
    this.report({ stage: "ocr", message: `Read ${targets.length} text blocks`, fraction: 1 });
  }

  /** Translates text blocks with source text (or only `blockIds`); returns the engine used (e.g. "deepl"), or null when there was nothing to translate. */
  async translate(job: PageJob, translateText: PipelineEngines["translate"], blockIds?: number[]): Promise<string | null> {
    const targets = job.blocks.filter((b) => b.kind === "text" && b.source_text?.trim() && (!blockIds || blockIds.includes(b.id)));
    this.report({ stage: "translating", message: `Translating ${targets.length} text blocks…`, fraction: 0 });
    let engine: string | null = null;
    for (const [i, b] of targets.entries()) {
      this.report({ stage: "translating", message: `Translating ${i + 1}/${targets.length}`, fraction: i / targets.length, detail: true });
      const out = await translateText(b.source_text ?? "");
      b.translated_text = out.text;
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
    const hasPainted = kind === "text" && existsSync(this.path(MASK_LAYER_FILES.add));
    if (regions.length === 0 && !hasPainted) {
      // Still write the output: later stages choose their input by file existence
      await sharp(this.path(input)).png().toFile(this.path(output));
      this.report({ stage: "cleaning", message: `No ${label} to clean`, fraction: 1 });
      return null;
    }
    this.report({ stage: "cleaning", message: `Cleaning ${regions.length} ${label}…`, fraction: 0 });

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
    const { rgb: cleaned, flat, lama } = await inpainter.inpaintRgb(rgb, width, height, target, [...regions, ...paintedRegions]);
    await sharp(cleaned, { raw: { width, height, channels: 3 } }).png().toFile(this.path(output));
    this.report({ stage: "cleaning", message: `Cleaned ${regions.length} ${label} (${flat} flat fill, ${lama} LaMa)`, fraction: 1 });
    return { output, regions: regions.length, total, flat, lama };
  }

  /**
   * Text mask the clean stages remove: the detector's mask.png, plus pixels painted into mask-add.png, minus pixels
   * painted into mask-erase.png. `added` is the painted-in layer minus erasures (null when there is none). Layers
   * with a different size than mask.png are refused rather than stretched.
   */
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
    const clipped = areas
      .map((a) => ({ x: Math.max(0, a.x), y: Math.max(0, a.y), w: Math.min(width, a.x + a.w) - Math.max(0, a.x), h: Math.min(height, a.y + a.h) - Math.max(0, a.y) }))
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

  /** Typeset translations inside each bubble on the latest cleaned page → result.png. */
  async render(job: PageJob): Promise<RenderResult> {
    const input = existsSync(this.path("clean-sfx.png")) ? "clean-sfx.png" : "clean-text.png";
    if (!existsSync(this.path(input))) throw new Error("No cleaned page yet — clean the text blocks first");
    const targets = job.blocks.filter((b) => b.kind === "text" && b.translated_text?.trim());
    this.report({ stage: "typesetting", message: `Typesetting ${targets.length} translations…`, fraction: 0 });

    const page = Buffer.from(await Bun.file(this.path(input)).arrayBuffer());
    const { data: rgb, info } = await sharp(page).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;

    // Bubbles are detected again on the cleaned page: without the original lettering the outlines are unambiguous.
    const detector = await getBubbleDetector();
    const bubbles = detector ? (await detector.detect(page)).bubbles : [];
    const typesetter = await getTypesetter();
    const maxFontSize = Math.round(height / 40);
    // A block this run doesn't typeset (skipped, or no translation any more) must not keep an older patch
    for (const b of job.blocks) delete b.render;
    rmSync(this.path("patches"), { recursive: true, force: true });
    mkdirSync(this.path("patches"), { recursive: true });

    const entries: { block: PageBlock; area: TextArea }[] = [];
    const skipped: number[] = [];
    for (const b of targets) {
      const area = findTextArea(rgb, width, height, b, matchBubble(b, bubbles));
      if (area) entries.push({ block: b, area });
      else skipped.push(b.id);
    }
    separateAreas(entries);

    // Largest size each block could take, then a shared page size so the lettering looks consistent
    const bestSizes = entries.map(({ block, area }) => typesetter.layout(block.translated_text ?? "", area, maxFontSize).fontSize);
    // Size 0 means separateAreas left the area empty: it must not drag the page size down to the minimum
    const sortedSizes = bestSizes.filter((size) => size > 0).sort((a, b) => a - b);
    const pageFontSize = sortedSizes[Math.floor((sortedSizes.length - 1) / 2)] ?? maxFontSize;

    const patches: OverlayOptions[] = [];
    const rendered: RenderedBlock[] = [];
    const laidOut: TextArea[] = [];
    for (const [i, { block: b, area }] of entries.entries()) {
      if (bestSizes[i] <= 0) {
        skipped.push(b.id);
        continue;
      }
      laidOut.push(area);
      const layout = typesetter.layout(b.translated_text ?? "", area, Math.min(pageFontSize, bestSizes[i]));
      const patch = await sharp(Buffer.from(typesetter.renderSvg(layout, area))).png().toBuffer();
      await Bun.write(this.path(`patches/${b.id}.png`), patch);
      patches.push({ input: patch, left: area.bound.x, top: area.bound.y });
      const lines = layout.lines.map((l) => l.text);
      b.render = { font_size: layout.fontSize, lines, area: area.bound, fits: layout.fits };
      rendered.push({ id: b.id, fontSize: layout.fontSize, bestFontSize: bestSizes[i], lines, fits: layout.fits });
    }

    await sharp(page).composite(patches).png().toFile(this.path("result.png"));
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
        for (let x = 0; x < area.bound.w; x++) {
          if (!area.mask[y * area.bound.w + x]) continue;
          const p = ((y + area.bound.y) * width + x + area.bound.x) * 3;
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
