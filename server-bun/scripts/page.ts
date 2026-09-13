/**
 * Manual, stage-by-stage manga page translation. Each stage writes to data/pages/work/<name>/
 * so its result can be inspected (and fixed) before running the next stage.
 *
 *   bun run page detect <image> [name]            original.png, mask.png, overlay.png, blocks.json
 *   bun run page blocks <name> [--exclude 1,2] [--include 3|all]
 *                                                  list blocks; choose which ones get cleaned
 *   bun run page ocr <name>                       crops/<id>.png + source text (text blocks)
 *   bun run page translate <name>                 translation per text block
 *   bun run page clean <name>                     stage 1: clean-text.png — speech bubbles and caption boxes
 *   bun run page clean-sfx <name>                 stage 2: clean-sfx.png — sound effects and other lettering,
 *                                                  applied on top of clean-text.png
 *   bun run page render <name>                    patches/<id>.png, render-overlay.png, result.png — translations
 *                                                  typeset inside each bubble on the latest cleaned page
 *
 * Blocks are "text" (dialogue/captions) or "sfx" (everything else). Each clean stage only touches its own
 * kind, and only blocks still marked include.
 */
import sharp, { type OverlayOptions } from "sharp";
import { existsSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { env } from "@/env";
import { inferenceHandlers } from "@/queue/inference-queue";
import { maskFromImage, maskToPng, selectBlockMask, type BlockKind, type Box } from "@/lib/mask";
import { TextSegmenter, textSegModelPath } from "@/services/text-seg-service";
import { BubbleDetector, bubbleModelPath } from "@/services/bubble-service";
import { findTextArea, separateAreas, Typesetter, type TextArea } from "@/services/typeset-service";
import { MangaInpainter, inpaintModelPath } from "@/services/inpaint-service";

const WORK_DIR = "data/pages/work";

interface PageBlock {
  id: number;
  kind: BlockKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Whether `clean` removes this block's lettering. */
  include: boolean;
  source_text: string | null;
  translated_text: string | null;
  /** Filled by `render`: the typeset result, kept for review and later manual overrides. */
  render?: { font_size: number; lines: string[]; area: Box; fits: boolean };
}

interface PageJob {
  source: string;
  width: number;
  height: number;
  blocks: PageBlock[];
}

const signal = new AbortController().signal;
const jobDir = (name: string): string => join(WORK_DIR, name);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function readJob(name: string): Promise<PageJob> {
  const file = Bun.file(join(jobDir(name), "blocks.json"));
  if (!(await file.exists())) fail(`No job "${name}" — run: bun run page detect <image> ${name}`);
  return (await file.json()) as PageJob;
}

async function writeJob(name: string, job: PageJob): Promise<void> {
  await Bun.write(join(jobDir(name), "blocks.json"), JSON.stringify(job, null, 2));
}

const clip = (text: string | null, max = 28): string =>
  text === null ? "-" : text.length > max ? `${text.slice(0, max - 1)}…` : text;

function printBlocks(job: PageJob): void {
  console.log(" id  kind  box                    clean  source → translation");
  for (const b of job.blocks) {
    const box = `${b.x},${b.y} ${b.w}x${b.h}`.padEnd(22);
    const clean = (b.include ? "yes" : "no").padEnd(5);
    console.log(`${String(b.id).padStart(3)}  ${b.kind.padEnd(4)}  ${box} ${clean}  ${clip(b.source_text)} → ${clip(b.translated_text, 40)}`);
  }
}

/** Page with text pixels tinted red and numbered outlines: blue = text, orange = sfx, grey dashed = not cleaned. */
async function renderOverlay(name: string, job: PageJob): Promise<void> {
  const dir = jobDir(name);
  const { data: rgb, info } = await sharp(join(dir, "original.png")).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const { mask } = await maskFromImage(join(dir, "mask.png"));
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
    .toFile(join(dir, "overlay.png"));
}

async function detect([image, nameArg]: string[]): Promise<void> {
  if (!image || !existsSync(image)) fail("Usage: bun run page detect <image> [name]");
  const name = nameArg ?? basename(image, extname(image));
  const dir = jobDir(name);
  mkdirSync(dir, { recursive: true });

  const original = join(dir, "original.png");
  await sharp(image).png().toFile(original);

  const started = performance.now();
  const page = Buffer.from(await Bun.file(original).arrayBuffer());
  // Group text per bubble when the bubble detector is available; otherwise use the text detector's own boxes.
  let textBoxes: Box[] | undefined;
  if (existsSync(bubbleModelPath())) {
    const detector = await BubbleDetector.load(bubbleModelPath());
    textBoxes = (await detector.detect(page)).textBoxes;
  }
  const grouping = textBoxes?.length ? `grouped by ${textBoxes.length} bubble-detector text boxes` : "grouped by text-detector boxes";
  const segmenter = await TextSegmenter.load(textSegModelPath());
  const result = await segmenter.segment(page, textBoxes);
  const ms = Math.round(performance.now() - started);

  await Bun.write(join(dir, "mask.png"), await maskToPng(result.mask, result.width, result.height));
  const job: PageJob = {
    source: image,
    width: result.width,
    height: result.height,
    blocks: result.blocks.map((b, i) => ({ id: i + 1, ...b, include: true, source_text: null, translated_text: null })),
  };
  await writeJob(name, job);
  await renderOverlay(name, job);

  const textCount = job.blocks.filter((b) => b.kind === "text").length;
  const covered = result.mask.reduce((sum, v) => sum + v, 0);
  console.log(`detect "${name}": ${job.width}x${job.height}, ${textCount} text + ${job.blocks.length - textCount} sfx blocks, mask ${(covered / result.mask.length * 100).toFixed(1)}%, ${grouping} (${ms}ms)`);
  console.log(`  ${dir}/overlay.png  red = text pixels, blue = text, orange = sfx, grey dashed = not cleaned\n`);
  printBlocks(job);
  console.log(`\nnext: bun run page ocr ${name}  |  bun run page blocks ${name} --exclude <ids> (skip blocks when cleaning)`);
}

function parseIds(value: string | undefined, job: PageJob): number[] {
  if (!value) fail("Expected a comma-separated id list or 'all'");
  if (value === "all") return job.blocks.map((b) => b.id);
  return value.split(",").map((v) => {
    const id = Number(v.trim());
    if (!job.blocks.some((b) => b.id === id)) fail(`Unknown block id: ${v}`);
    return id;
  });
}

async function blocks([name, ...flags]: string[]): Promise<void> {
  if (!name) fail("Usage: bun run page blocks <name> [--exclude 1,2] [--include 3|all]");
  const job = await readJob(name);
  let changed = false;
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (flag !== "--exclude" && flag !== "--include") fail(`Unknown option: ${flag}`);
    const ids = parseIds(flags[++i], job);
    for (const b of job.blocks) if (ids.includes(b.id)) b.include = flag === "--include";
    changed = true;
  }
  if (changed) {
    await writeJob(name, job);
    await renderOverlay(name, job);
    console.log(`updated ${jobDir(name)}/overlay.png\n`);
  }
  printBlocks(job);
}

async function ocr([name]: string[]): Promise<void> {
  if (!name) fail("Usage: bun run page ocr <name>");
  const job = await readJob(name);
  const dir = jobDir(name);
  mkdirSync(join(dir, "crops"), { recursive: true });

  process.env.OCR_DEBUG = "false";
  const load = env.OCR_ENGINE === "baberu"
    ? (await import("@/services/baberu-ocr-service")).loadBaberuOcrModel
    : (await import("@/services/ocr-service")).loadOcrModel;
  await load();

  const original = join(dir, "original.png");
  for (const b of job.blocks.filter((block) => block.kind === "text")) {
    const crop = await sharp(original).extract({ left: b.x, top: b.y, width: b.w, height: b.h }).png().toBuffer();
    await Bun.write(join(dir, "crops", `${b.id}.png`), crop);
    const { text } = (await inferenceHandlers.ocr({ imageBuffer: crop }, signal)) as { text: string };
    b.source_text = text;
    console.log(`${String(b.id).padStart(3)}  ${text}`);
  }
  await writeJob(name, job);
  console.log(`\nocr (${env.OCR_ENGINE}) done → ${dir}/crops/, blocks.json\nnext: bun run page translate ${name}`);
}

async function translate([name]: string[]): Promise<void> {
  if (!name) fail("Usage: bun run page translate <name>");
  const job = await readJob(name);
  const pending = job.blocks.filter((b) => b.kind === "text" && b.source_text);
  if (pending.length === 0) fail(`No source text yet — run: bun run page ocr ${name}`);

  const { loadTranslateModel } = await import("@/services/translate-service");
  await loadTranslateModel();

  for (const b of pending) {
    const out = (await inferenceHandlers.translate({ text: b.source_text }, signal)) as { translatedText: string; engine: string };
    b.translated_text = out.translatedText;
    console.log(`${String(b.id).padStart(3)}  [${out.engine}] ${b.source_text} → ${out.translatedText}`);
  }
  await writeJob(name, job);
  console.log(`\ntranslate done → ${jobDir(name)}/blocks.json\nnext: bun run page clean ${name}  (stage 1: bubbles and caption boxes)`);
}

/**
 * Remove the lettering of included blocks of one kind, reading `input` and writing `output`.
 * Blob ownership is still decided against all blocks, so the other kind's pixels are never touched.
 */
async function cleanKind(name: string, kind: BlockKind, input: string, output: string): Promise<void> {
  const job = await readJob(name);
  const dir = jobDir(name);
  const inputPath = join(dir, input);
  if (!existsSync(inputPath)) fail(`${input} not found — run: bun run page clean ${name}`);

  const regions = job.blocks.filter((b) => b.kind === kind && b.include);
  if (regions.length === 0) {
    console.log(`clean ${kind} "${name}": no included ${kind} blocks — nothing to do`);
    return;
  }

  const { data: rgb, info } = await sharp(inputPath).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const { mask, width, height } = await maskFromImage(join(dir, "mask.png"));
  if (width !== info.width || height !== info.height) fail(`mask.png size does not match ${input}`);
  const selection = job.blocks.map((b) => ({ ...b, include: b.kind === kind && b.include }));
  const target = selectBlockMask(mask, width, height, selection);

  const started = performance.now();
  const inpainter = await MangaInpainter.load(inpaintModelPath(), false);
  const { rgb: cleaned, flat, lama } = await inpainter.inpaintRgb(rgb, width, height, target, regions);
  const ms = Math.round(performance.now() - started);

  await sharp(cleaned, { raw: { width, height, channels: 3 } }).png().toFile(join(dir, output));
  const total = job.blocks.filter((b) => b.kind === kind).length;
  console.log(`clean ${kind} "${name}": ${regions.length}/${total} blocks (${flat} flat fill, ${lama} LaMa) in ${ms}ms → ${dir}/${output}`);
}

async function clean([name]: string[]): Promise<void> {
  if (!name) fail("Usage: bun run page clean <name>");
  await cleanKind(name, "text", "original.png", "clean-text.png");
  console.log(`next: bun run page clean-sfx ${name}  (optional — exclude SFX to keep with: bun run page blocks ${name} --exclude <ids>)`);
}

async function cleanSfx([name]: string[]): Promise<void> {
  if (!name) fail("Usage: bun run page clean-sfx <name>");
  await cleanKind(name, "sfx", "clean-text.png", "clean-sfx.png");
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

async function render([name]: string[]): Promise<void> {
  if (!name) fail("Usage: bun run page render <name>");
  const job = await readJob(name);
  const dir = jobDir(name);
  const input = existsSync(join(dir, "clean-sfx.png")) ? "clean-sfx.png" : "clean-text.png";
  const base = join(dir, input);
  if (!existsSync(base)) fail(`No cleaned page yet — run: bun run page clean ${name}`);
  const targets = job.blocks.filter((b) => b.kind === "text" && b.translated_text?.trim());
  if (targets.length === 0) fail(`No translations yet — run: bun run page translate ${name}`);

  const started = performance.now();
  const page = Buffer.from(await Bun.file(base).arrayBuffer());
  const { data: rgb, info } = await sharp(page).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  // Bubbles are detected again on the cleaned page: without the original lettering the outlines are unambiguous.
  const bubbles = existsSync(bubbleModelPath()) ? (await (await BubbleDetector.load(bubbleModelPath())).detect(page)).bubbles : [];
  const typesetter = await Typesetter.load();
  const maxFontSize = Math.round(height / 40);
  mkdirSync(join(dir, "patches"), { recursive: true });

  const entries: { block: PageBlock; area: TextArea }[] = [];
  for (const b of targets) {
    const area = findTextArea(rgb, width, height, b, matchBubble(b, bubbles));
    if (area) entries.push({ block: b, area });
    else console.log(`${String(b.id).padStart(3)}  no usable space inside the bubble — skipped`);
  }
  separateAreas(entries);

  // Largest size each block could take, then a shared page size so the lettering looks consistent
  const bestSizes = entries.map(({ block, area }) => typesetter.layout(block.translated_text ?? "", area, maxFontSize).fontSize);
  const sortedSizes = [...bestSizes].sort((a, b) => a - b);
  const pageFontSize = sortedSizes[Math.floor((sortedSizes.length - 1) / 2)] ?? maxFontSize;

  const patches: OverlayOptions[] = [];
  const areas: TextArea[] = [];
  console.log(" id  size  best  lines  fit   text");
  for (const [i, { block: b, area }] of entries.entries()) {
    const layout = typesetter.layout(b.translated_text ?? "", area, Math.min(pageFontSize, bestSizes[i]));
    const patch = await sharp(Buffer.from(typesetter.renderSvg(layout, area))).png().toBuffer();
    await Bun.write(join(dir, "patches", `${b.id}.png`), patch);
    patches.push({ input: patch, left: area.bound.x, top: area.bound.y });
    areas.push(area);
    b.render = { font_size: layout.fontSize, lines: layout.lines.map((l) => l.text), area: area.bound, fits: layout.fits };
    console.log(`${String(b.id).padStart(3)}  ${String(layout.fontSize).padStart(4)}  ${String(bestSizes[i]).padStart(4)}  ${String(layout.lines.length).padStart(5)}  ${(layout.fits ? "yes" : "NO").padEnd(4)}  ${layout.lines.map((l) => l.text).join(" / ")}`);
  }
  console.log(`page font size ${pageFontSize}px (median of best fits)`);

  await sharp(page).composite(patches).png().toFile(join(dir, "result.png"));

  // Where text was allowed (green) and the area bounds — for reviewing placement
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
    .toFile(join(dir, "render-overlay.png"));

  await writeJob(name, job);
  console.log(`\nrender "${name}": ${areas.length}/${targets.length} blocks on ${input} in ${Math.round(performance.now() - started)}ms`);
  console.log(`  ${dir}/result.png  |  ${dir}/render-overlay.png (green = allowed text area)  |  ${dir}/patches/`);
}

const [command, ...args] = Bun.argv.slice(2);
const commands: Record<string, (args: string[]) => Promise<void>> = { detect, blocks, ocr, translate, clean, "clean-sfx": cleanSfx, render };
const run = command ? commands[command] : undefined;
if (!run) fail("Usage: bun run page <detect|blocks|ocr|translate|clean|clean-sfx|render> ...  (see scripts/page.ts)");
await run(args);
process.exit(0);
