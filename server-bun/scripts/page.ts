/**
 * Manual, stage-by-stage manga page translation. Each stage writes to data/pages/work/<name>/
 * so its result can be inspected (and fixed) before running the next stage.
 *
 *   bun run page detect <image> [name]            original.png, mask.png, overlay.png, blocks.json
 *   bun run page blocks <name> [--exclude 1,2] [--include 3|all]
 *                                                  list blocks; choose which ones `clean` removes
 *   bun run page ocr <name>                       crops/<id>.png + source text (text blocks)
 *   bun run page translate <name>                 translation per text block
 *   bun run page clean <name>                     inpainted.png (included blocks only)
 *
 * Blocks are "text" (dialogue/captions, cleaned by default) or "sfx" (other lettering, kept by default).
 */
import sharp from "sharp";
import { existsSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { env } from "@/env";
import { inferenceHandlers } from "@/queue/inference-queue";
import { maskFromImage, maskToPng, selectBlockMask, type BlockKind } from "@/lib/mask";
import { TextSegmenter, textSegModelPath } from "@/services/text-seg-service";
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
  const segmenter = await TextSegmenter.load(textSegModelPath());
  const result = await segmenter.segment(Buffer.from(await Bun.file(original).arrayBuffer()));
  const ms = Math.round(performance.now() - started);

  await Bun.write(join(dir, "mask.png"), await maskToPng(result.mask, result.width, result.height));
  const job: PageJob = {
    source: image,
    width: result.width,
    height: result.height,
    blocks: result.blocks.map((b, i) => ({ id: i + 1, ...b, include: b.kind === "text", source_text: null, translated_text: null })),
  };
  await writeJob(name, job);
  await renderOverlay(name, job);

  const textCount = job.blocks.filter((b) => b.kind === "text").length;
  const covered = result.mask.reduce((sum, v) => sum + v, 0);
  console.log(`detect "${name}": ${job.width}x${job.height}, ${textCount} text + ${job.blocks.length - textCount} sfx blocks, mask ${(covered / result.mask.length * 100).toFixed(1)}% (${ms}ms)`);
  console.log(`  ${dir}/overlay.png  red = text pixels, blue = text, orange = sfx, grey dashed = kept\n`);
  printBlocks(job);
  console.log(`\nnext: bun run page blocks ${name} --include <ids> (also clean sfx)  |  bun run page ocr ${name}`);
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
  console.log(`\ntranslate done → ${jobDir(name)}/blocks.json\nnext: bun run page clean ${name}`);
}

async function clean([name]: string[]): Promise<void> {
  if (!name) fail("Usage: bun run page clean <name>");
  const job = await readJob(name);
  const dir = jobDir(name);
  const regions = job.blocks.filter((b) => b.include);
  if (regions.length === 0) fail(`No blocks included — use: bun run page blocks ${name} --include all`);

  const { data: rgb, info } = await sharp(join(dir, "original.png")).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const { mask, width, height } = await maskFromImage(join(dir, "mask.png"));
  if (width !== info.width || height !== info.height) fail("mask.png size does not match original.png");
  const target = selectBlockMask(mask, width, height, job.blocks);

  let started = performance.now();
  const inpainter = await MangaInpainter.load(inpaintModelPath());
  const loadMs = Math.round(performance.now() - started);
  started = performance.now();
  const cleaned = await inpainter.inpaintRgb(rgb, width, height, target, regions);
  const ms = Math.round(performance.now() - started);

  await sharp(cleaned, { raw: { width, height, channels: 3 } }).png().toFile(join(dir, "inpainted.png"));
  console.log(`clean "${name}": ${regions.length}/${job.blocks.length} blocks in ${ms}ms (model load ${loadMs}ms) → ${dir}/inpainted.png`);
}

const [command, ...args] = Bun.argv.slice(2);
const commands: Record<string, (args: string[]) => Promise<void>> = { detect, blocks, ocr, translate, clean };
const run = command ? commands[command] : undefined;
if (!run) fail("Usage: bun run page <detect|blocks|ocr|translate|clean> ...  (see scripts/page.ts)");
await run(args);
process.exit(0);
