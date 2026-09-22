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
 * kind, and only blocks still marked include. The same pipeline serves POST /api/translate-page.
 */
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { env } from "@/env";
import { PagePipeline, type PageJob } from "@/services/page-pipeline";
import { ocrEngine, translateEngine } from "./engines";

const WORK_DIR = "data/pages/work";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Stage start/finish messages go to the console; per-item progress is left out. */
const pipelineFor = (name: string): PagePipeline =>
  new PagePipeline(join(WORK_DIR, name), ({ message, detail }) => {
    if (!detail) console.log(`  ${message}`);
  });

async function readJob(pipeline: PagePipeline, name: string): Promise<PageJob> {
  const job = await pipeline.readJob();
  if (!job) fail(`No job "${name}" — run: bun run page detect <image> ${name}`);
  return job;
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

async function detect([image, nameArg]: string[]): Promise<void> {
  if (!image || !existsSync(image)) fail("Usage: bun run page detect <image> [name]");
  const name = nameArg ?? basename(image, extname(image));
  const pipeline = pipelineFor(name);
  const started = performance.now();
  const { job, grouping, maskCoverage } = await pipeline.detect(image, image);
  const textCount = job.blocks.filter((b) => b.kind === "text").length;
  console.log(`detect "${name}": ${job.width}x${job.height}, ${textCount} text + ${job.blocks.length - textCount} sfx blocks, mask ${(maskCoverage * 100).toFixed(1)}%, ${grouping} (${Math.round(performance.now() - started)}ms)`);
  console.log(`  ${pipeline.path("overlay.png")}  red = text pixels, blue = text, orange = sfx, grey dashed = not cleaned\n`);
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
  const pipeline = pipelineFor(name);
  const job = await readJob(pipeline, name);
  let changed = false;
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (flag !== "--exclude" && flag !== "--include") fail(`Unknown option: ${flag}`);
    const ids = parseIds(flags[++i], job);
    for (const b of job.blocks) if (ids.includes(b.id)) b.include = flag === "--include";
    changed = true;
  }
  if (changed) {
    await pipeline.writeJob(job);
    await pipeline.renderDetectOverlay(job);
    console.log(`updated ${pipeline.path("overlay.png")}\n`);
  }
  printBlocks(job);
}

async function ocr([name]: string[]): Promise<void> {
  if (!name) fail("Usage: bun run page ocr <name>");
  const pipeline = pipelineFor(name);
  const job = await readJob(pipeline, name);
  await pipeline.ocr(job, await ocrEngine());
  for (const b of job.blocks.filter((block) => block.kind === "text")) console.log(`${String(b.id).padStart(3)}  ${b.source_text}`);
  console.log(`\nocr (${env.OCR_ENGINE}) done → ${pipeline.path("crops")}/, blocks.json\nnext: bun run page translate ${name}`);
}

async function translate([name]: string[]): Promise<void> {
  if (!name) fail("Usage: bun run page translate <name>");
  const pipeline = pipelineFor(name);
  const job = await readJob(pipeline, name);
  if (!job.blocks.some((b) => b.kind === "text" && b.source_text)) fail(`No source text yet — run: bun run page ocr ${name}`);
  await pipeline.translate(job, await translateEngine());
  for (const b of job.blocks.filter((block) => block.kind === "text" && block.source_text)) {
    console.log(`${String(b.id).padStart(3)}  ${b.source_text} → ${b.translated_text}`);
  }
  console.log(`\ntranslate done → ${pipeline.path("blocks.json")}\nnext: bun run page clean ${name}  (stage 1: bubbles and caption boxes)`);
}

async function clean([name]: string[]): Promise<void> {
  if (!name) fail("Usage: bun run page clean <name>");
  const pipeline = pipelineFor(name);
  const started = performance.now();
  const result = await pipeline.clean(await readJob(pipeline, name), "text");
  if (result) console.log(`clean text "${name}": ${result.regions}/${result.total} blocks in ${Math.round(performance.now() - started)}ms → ${pipeline.path(result.output)}`);
  console.log(`next: bun run page clean-sfx ${name}  (optional — exclude SFX to keep with: bun run page blocks ${name} --exclude <ids>)`);
}

async function cleanSfx([name]: string[]): Promise<void> {
  if (!name) fail("Usage: bun run page clean-sfx <name>");
  const pipeline = pipelineFor(name);
  const started = performance.now();
  const result = await pipeline.clean(await readJob(pipeline, name), "sfx");
  if (result) console.log(`clean sfx "${name}": ${result.regions}/${result.total} blocks in ${Math.round(performance.now() - started)}ms → ${pipeline.path(result.output)}`);
}

async function render([name]: string[]): Promise<void> {
  if (!name) fail("Usage: bun run page render <name>");
  const pipeline = pipelineFor(name);
  const job = await readJob(pipeline, name);
  if (!job.blocks.some((b) => b.kind === "text" && b.translated_text?.trim())) fail(`No translations yet — run: bun run page translate ${name}`);
  const started = performance.now();
  const result = await pipeline.render(job);

  console.log(" id  size  best  lines  fit   text");
  for (const b of result.blocks) {
    console.log(`${String(b.id).padStart(3)}  ${String(b.fontSize).padStart(4)}  ${String(b.bestFontSize).padStart(4)}  ${String(b.lines.length).padStart(5)}  ${(b.fits ? "yes" : "NO").padEnd(4)}  ${b.lines.join(" / ")}`);
  }
  for (const id of result.skipped) console.log(`${String(id).padStart(3)}  no usable space inside the bubble — skipped`);
  console.log(`page font size ${result.pageFontSize}px (median of best fits)`);
  console.log(`\nrender "${name}": ${result.blocks.length} blocks on ${result.input} in ${Math.round(performance.now() - started)}ms`);
  console.log(`  ${pipeline.path("result.png")}  |  ${pipeline.path("render-overlay.png")} (green = allowed text area)  |  ${pipeline.path("patches")}/`);
}

const [command, ...args] = Bun.argv.slice(2);
const commands: Record<string, (args: string[]) => Promise<void>> = { detect, blocks, ocr, translate, clean, "clean-sfx": cleanSfx, render };
const run = command ? commands[command] : undefined;
if (!run) fail("Usage: bun run page <detect|blocks|ocr|translate|clean|clean-sfx|render> ...  (see scripts/page.ts)");
try {
  await run(args);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
process.exit(0);
