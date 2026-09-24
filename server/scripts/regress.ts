/**
 * The page-pipeline regression set: run every page in data/pages/regress/ through the pipeline, measure the result,
 * and compare it with the accepted baseline — so a change to detection, OCR or cleaning shows what it did to every
 * kind of page, not just the one it was tuned on.
 *
 *   bun run regress                 run and compare with the baseline; exits 1 when a page got worse
 *   bun run regress --accept        run and make this the baseline
 *   bun run regress --only a,b      just these pages (file names without the extension)
 *   bun run regress --full          also translate (local engine) and burn the lettering
 *   REGRESS_DIR=<dir> bun run regress   another set of pages
 *
 * A page is an image in data/pages/regress/ (png, jpg, webp). Next to it, an optional <name>.json says what it is
 * there for and how to run it: { "covers": ["dark bubble", "white text"], "clean_sfx": true }. Aim for 10–20 pages
 * covering dark bubbles / white text, text over screentone, joined bubbles, colour pages, tall webtoon strips,
 * horizontal text and Chinese. data/ is gitignored, so the pages and the baseline stay on this machine.
 *
 * Per page it records the blocks (count, boxes, OCR text), how the clean went (flat fill vs LaMa, leftover ink from
 * services/clean-check.ts) and the time taken. Against the baseline it reports block-count and OCR changes, the
 * change in leftover ink, and how far the cleaned image moved. More leftover ink is what counts as worse; the rest is
 * shown for judgement.
 */
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import sharp from "@/lib/sharp";
import type { Box } from "@/lib/mask";
import { leftoverInk, overallInk, type InkReport } from "@/services/clean-check";
import { PagePipeline, type PageJob, type PipelineEngines } from "@/services/page-pipeline";
import { ocrEngine, translateEngine } from "./engines";

/** Where the pages, the last run and the baseline live; REGRESS_DIR points it elsewhere (a second set, a scratch run). */
const REGRESS_DIR = Bun.env.REGRESS_DIR ?? "data/pages/regress";
const RUN_DIR = join(REGRESS_DIR, ".run");
const BASELINE_DIR = join(REGRESS_DIR, "baseline");
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
/** Leftover ink (share of marked pixels) that has to move before a page counts as better or worse. */
const INK_TOLERANCE = 0.02;
/** Two blocks are the same block when their boxes overlap this much (intersection over union). */
const SAME_BLOCK_IOU = 0.5;
/** Files kept per page, in the run and in the baseline. */
const KEPT_FILES = ["metrics.json", "overlay.png", "clean-text.png", "clean-sfx.png", "result.png"];

interface CaseOptions {
  covers?: string[];
  clean_sfx?: boolean;
}

interface PageMetrics {
  name: string;
  covers: string[];
  width: number;
  height: number;
  blocks: { id: number; kind: string; box: Box; include: boolean; source_text: string | null; translated_text: string | null }[];
  flat: number;
  lama: number;
  /** Leftover ink over all cleaned text blocks, 0–1. */
  ink: number;
  inkByBlock: InkReport[];
  ms: Record<string, number>;
}

type Verdict = "better" | "worse" | "same" | "new";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter === 0 ? 0 : inter / (a.w * a.h + b.w * b.h - inter);
}

/** Mean absolute difference of two images, as a share of the full range; null when their sizes differ. */
async function imageDifference(a: string, b: string): Promise<number | null> {
  if (!existsSync(a) || !existsSync(b)) return null;
  const [x, y] = await Promise.all([a, b].map((file) => sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  if (!x || !y || x.info.width !== y.info.width || x.info.height !== y.info.height) return null;
  let total = 0;
  for (let i = 0; i < x.data.length; i++) total += Math.abs(x.data[i]! - y.data[i]!);
  return total / (x.data.length * 255);
}

async function readOptions(name: string): Promise<CaseOptions> {
  const file = Bun.file(join(REGRESS_DIR, `${name}.json`));
  if (!(await file.exists())) return {};
  const raw: unknown = await file.json();
  if (typeof raw !== "object" || raw === null) fail(`${name}.json should be an object like { "covers": [...], "clean_sfx": true }`);
  const options = raw as Record<string, unknown>;
  return {
    ...(Array.isArray(options.covers) ? { covers: options.covers.filter((c): c is string => typeof c === "string") } : {}),
    ...(typeof options.clean_sfx === "boolean" ? { clean_sfx: options.clean_sfx } : {}),
  };
}

/** Runs one page through the pipeline into the run folder and measures it. */
async function runPage(name: string, image: string, engines: { ocr: PipelineEngines["ocr"]; translate?: Pick<PipelineEngines, "translate" | "batchSize"> }): Promise<PageMetrics> {
  const options = await readOptions(name);
  const dir = join(RUN_DIR, name);
  await rm(dir, { recursive: true, force: true });
  const pipeline = new PagePipeline(dir);
  const ms: Record<string, number> = {};
  const timed = async <T>(stage: string, work: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try {
      return await work();
    } finally {
      ms[stage] = Math.round(performance.now() - started);
    }
  };

  const { job } = await timed("detect", () => pipeline.detect(image, image));
  await timed("ocr", () => pipeline.ocr(job, engines.ocr));
  const text = await timed("clean_text", () => pipeline.clean(job, "text"));
  const sfx = options.clean_sfx ? await timed("clean_sfx", () => pipeline.clean(job, "sfx")) : null;
  if (engines.translate) {
    await timed("translate", () => pipeline.translate(job, engines.translate!));
    await timed("render", () => pipeline.render(job));
  }

  const cleaned = job.blocks.filter((b) => b.kind === "text" && b.include);
  const inkByBlock = existsSync(pipeline.path("clean-text.png"))
    ? await leftoverInk(pipeline.path("clean-text.png"), pipeline.path("mask.png"), cleaned)
    : [];
  const metrics: PageMetrics = {
    name,
    covers: options.covers ?? [],
    width: job.width,
    height: job.height,
    blocks: job.blocks.map((b: PageJob["blocks"][number]) => ({
      id: b.id, kind: b.kind, box: { x: b.x, y: b.y, w: b.w, h: b.h }, include: b.include, source_text: b.source_text, translated_text: b.translated_text,
    })),
    flat: (text?.flat ?? 0) + (sfx?.flat ?? 0),
    lama: (text?.lama ?? 0) + (sfx?.lama ?? 0),
    ink: overallInk(inkByBlock),
    inkByBlock,
    ms,
  };
  await Bun.write(join(dir, "metrics.json"), JSON.stringify(metrics, null, 2));
  return metrics;
}

interface Comparison {
  verdict: Verdict;
  textBlocks: string;
  sfxBlocks: string;
  ocr: string;
  ink: string;
  imageDiff: string;
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const percent = (n: number) => `${(n * 100).toFixed(1)}%`;

async function compare(current: PageMetrics): Promise<Comparison> {
  const baseFile = Bun.file(join(BASELINE_DIR, current.name, "metrics.json"));
  const count = (m: PageMetrics, kind: string) => m.blocks.filter((b) => b.kind === kind).length;
  if (!(await baseFile.exists())) {
    return { verdict: "new", textBlocks: String(count(current, "text")), sfxBlocks: String(count(current, "sfx")), ocr: "-", ink: percent(current.ink), imageDiff: "-" };
  }
  const base = (await baseFile.json()) as PageMetrics;

  // OCR: the same block is the one whose box overlaps most; a changed reading, a lost block and a new one are counted
  const baseText = base.blocks.filter((b) => b.kind === "text");
  const curText = current.blocks.filter((b) => b.kind === "text");
  const matched = new Set<number>();
  let changed = 0;
  for (const b of baseText) {
    let best: (typeof curText)[number] | undefined;
    let bestIou = SAME_BLOCK_IOU;
    for (const c of curText) {
      const overlap = iou(b.box, c.box);
      if (overlap >= bestIou && !matched.has(c.id)) {
        best = c;
        bestIou = overlap;
      }
    }
    if (!best) continue;
    matched.add(best.id);
    if ((best.source_text ?? "") !== (b.source_text ?? "")) changed++;
  }
  const lost = baseText.length - matched.size;
  const added = curText.length - matched.size;
  const ocrParts = [changed > 0 ? `${changed} read differently` : "", lost > 0 ? `${lost} lost` : "", added > 0 ? `${added} new` : ""].filter(Boolean);

  const inkDelta = current.ink - base.ink;
  const diff = await imageDifference(join(RUN_DIR, current.name, "clean-text.png"), join(BASELINE_DIR, current.name, "clean-text.png"));
  const verdict: Verdict = inkDelta > INK_TOLERANCE ? "worse" : inkDelta < -INK_TOLERANCE ? "better" : "same";
  const delta = (now: number, then: number) => (now === then ? String(now) : `${now} (${signed(now - then)})`);
  return {
    verdict,
    textBlocks: delta(count(current, "text"), count(base, "text")),
    sfxBlocks: delta(count(current, "sfx"), count(base, "sfx")),
    ocr: ocrParts.length > 0 ? ocrParts.join(", ") : "same",
    ink: `${percent(current.ink)} (${inkDelta >= 0 ? "+" : ""}${(inkDelta * 100).toFixed(1)})`,
    imageDiff: diff === null ? "-" : percent(diff),
  };
}

async function accept(name: string): Promise<void> {
  const target = join(BASELINE_DIR, name);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const file of KEPT_FILES) {
    const source = join(RUN_DIR, name, file);
    if (existsSync(source)) await cp(source, join(target, file));
  }
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((row) => row[col]!.length)));
  return rows.map((row) => row.map((cell, col) => cell.padEnd(widths[col]!)).join("  ")).join("\n");
}

const argv = Bun.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const onlyAt = argv.indexOf("--only");
const only = onlyAt >= 0 ? new Set((argv[onlyAt + 1] ?? "").split(",").filter(Boolean)) : null;
const unknown = argv.filter((arg, i) => arg.startsWith("--") && !["--accept", "--full", "--only"].includes(arg) && argv[i - 1] !== "--only");
if (unknown.length > 0) fail(`Unknown option: ${unknown.join(" ")}  (see scripts/regress.ts)`);

await mkdir(REGRESS_DIR, { recursive: true });
const pages = (await readdir(REGRESS_DIR))
  .filter((file) => IMAGE_EXTENSIONS.has(extname(file).toLowerCase()))
  .map((file) => ({ name: file.slice(0, -extname(file).length), image: join(REGRESS_DIR, file) }))
  .filter((page) => !only || only.has(page.name))
  .sort((a, b) => a.name.localeCompare(b.name));
if (pages.length === 0) {
  console.log(`No pages in ${REGRESS_DIR}/ yet${only ? " matching --only" : ""}.`);
  console.log("Add 10–20 page images covering dark bubbles / white text, screentone, joined bubbles, colour pages, tall webtoons,");
  console.log('horizontal text and Chinese — optionally with a <name>.json like { "covers": ["dark bubble"], "clean_sfx": true } — then:');
  console.log("  bun run regress --accept   to record the baseline");
  process.exit(0);
}

console.log(`Loading engines…`);
const engines = { ocr: await ocrEngine(), ...(flag("--full") ? { translate: await translateEngine() } : {}) };
const rows: string[][] = [["page", "covers", "text", "sfx", "ocr vs baseline", "leftover ink", "image moved", "flat/lama", "time", "verdict"]];
let worse = 0;
for (const page of pages) {
  process.stdout.write(`  ${page.name}… `);
  const metrics = await runPage(page.name, page.image, engines);
  const result = await compare(metrics);
  const time = Object.values(metrics.ms).reduce((a, b) => a + b, 0);
  console.log(result.verdict);
  if (result.verdict === "worse") worse++;
  rows.push([
    page.name, metrics.covers.join(", ") || "-", result.textBlocks, result.sfxBlocks, result.ocr, result.ink, result.imageDiff,
    `${metrics.flat}/${metrics.lama}`, `${(time / 1000).toFixed(1)}s`, result.verdict,
  ]);
  if (flag("--accept")) await accept(page.name);
}

console.log(`\n${table(rows)}\n`);
console.log(`Run kept in ${RUN_DIR}/ (overlay, cleaned pages, metrics.json per page).`);
if (flag("--accept")) {
  console.log(`Accepted as the baseline in ${BASELINE_DIR}/.`);
  process.exit(0);
}
if (worse > 0) {
  console.log(`${worse} page${worse === 1 ? "" : "s"} left more ink than the baseline (by more than ${percent(INK_TOLERANCE)}).`);
  process.exit(1);
}
console.log("Nothing got worse.");
process.exit(0);
