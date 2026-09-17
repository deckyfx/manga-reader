/**
 * Compare manga-ocr with Baberu OCR on bubble crops.
 *
 *   bun run ocr:compare <image|dir>...
 *
 * Put the correct text in `<image>.txt` beside an image to also get a character error rate.
 * Expects both models downloaded: data/models/ocr (manga-ocr) and data/models/baberu.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { loadOcrModel } from "@/services/ocr-service";
import { BaberuOcr } from "@/services/baberu-ocr-service";
import { inferenceHandlers } from "@/queue/inference-queue";

const MANGA_OCR_DIR = "data/models/ocr";
const BABERU_DIR = "data/models/baberu";
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/** Character error rate (Levenshtein over code points, whitespace ignored). */
function cer(predicted: string, expected: string): number {
  const a = [...predicted.replace(/\s+/g, "")];
  const b = [...expected.replace(/\s+/g, "")];
  if (b.length === 0) return a.length === 0 ? 0 : 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[b.length] / b.length;
}

function collectImages(path: string): string[] {
  if (!existsSync(path)) {
    console.error(`skip: ${path} not found`);
    return [];
  }
  if (statSync(path).isDirectory()) {
    return readdirSync(path)
      .filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
      .sort()
      .map((f) => join(path, f));
  }
  return IMAGE_EXT.has(extname(path).toLowerCase()) ? [path] : [];
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const pct = (v: number): string => `${(v * 100).toFixed(1).padStart(5)}%`;

const images = Bun.argv.slice(2).flatMap(collectImages);
if (images.length === 0) {
  console.error("Usage: bun run ocr:compare <image|dir>...");
  process.exit(1);
}

process.env.OCR_DEBUG = "false";
let started = performance.now();
await loadOcrModel(MANGA_OCR_DIR);
const mangaOcr = inferenceHandlers.ocr;
if (!mangaOcr) throw new Error("manga-ocr handler not registered");
console.log(`manga-ocr loaded in ${Math.round(performance.now() - started)}ms`);

started = performance.now();
const baberu = await BaberuOcr.load(BABERU_DIR);
console.log(`baberu    loaded in ${Math.round(performance.now() - started)}ms\n`);

const stats = { manga: { ms: [] as number[], cer: [] as number[] }, baberu: { ms: [] as number[], cer: [] as number[] } };
let identical = 0;

for (const [index, path] of images.entries()) {
  const image = Buffer.from(await Bun.file(path).arrayBuffer());
  const expectedPath = path.slice(0, -extname(path).length) + ".txt";
  const expected = existsSync(expectedPath) ? (await Bun.file(expectedPath).text()).trim() : null;

  started = performance.now();
  const { text: mangaText } = (await mangaOcr({ imageBuffer: image }, new AbortController().signal)) as { text: string };
  const mangaMs = performance.now() - started;

  started = performance.now();
  const baberuText = await baberu.recognize(image);
  const baberuMs = performance.now() - started;

  stats.manga.ms.push(mangaMs);
  stats.baberu.ms.push(baberuMs);
  if (mangaText === baberuText) identical++;

  const row = (name: string, ms: number, text: string, key: "manga" | "baberu"): string => {
    let score = "        ";
    if (expected !== null) {
      const rate = cer(text, expected);
      stats[key].cer.push(rate);
      score = `CER${pct(rate)}`;
    }
    return `  ${name.padEnd(9)} ${String(Math.round(ms)).padStart(5)}ms  ${score}  ${text}`;
  };

  console.log(`[${index + 1}/${images.length}] ${basename(path)}${mangaText === baberuText ? "  (same)" : ""}`);
  console.log(row("manga-ocr", mangaMs, mangaText, "manga"));
  console.log(row("baberu", baberuMs, baberuText, "baberu"));
  if (expected !== null) console.log(`  ${"expected".padEnd(9)} ${" ".repeat(19)}  ${expected}`);
}

const mean = (values: number[]): string =>
  values.length ? pct(values.reduce((sum, v) => sum + v, 0) / values.length) : "   n/a";
console.log(`\n${images.length} images, ${identical} identical outputs`);
console.log(`  manga-ocr  median ${Math.round(median(stats.manga.ms))}ms  mean CER ${mean(stats.manga.cer)}`);
console.log(`  baberu     median ${Math.round(median(stats.baberu.ms))}ms  mean CER ${mean(stats.baberu.cer)}`);
process.exit(0);
