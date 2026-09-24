/**
 * Full-page translation jobs, shared by the extension route (POST /api/translate-page) and the Studio
 * (POST /studio/api/pages): admission (limits, dedupe, cache) and the pipeline run with stage tracking.
 */
import sharp from "sharp";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { childLogger } from "@/lib/logger";
import { describeUsage, startProbe, totalUsage, usageFields, type Usage } from "@/lib/resource-probe";
import { runExclusiveResult, withPageLock } from "@/queue/page-queue";
import { enginesNotReady, pageEngines as engines } from "@/services/page-engines";
import { missingPipelineModels, normalisePage, PagePipeline, type PageStage, type ProgressUpdate } from "@/services/page-pipeline";
import { pageDir, PageStore, type StageName } from "@/stores/page-store";
import { translationJobs, type PageJobEvent } from "@/stores/translation-job-store";

const log = childLogger("page-jobs");

/** Largest encoded image accepted, from an upload or a URL. */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
/** Up to MAX_PENDING_PAGES decodes run at once, each ~4 bytes per pixel raw. 40 MP still fits a 5000×8000 scan. */
const MAX_INPUT_PIXELS = 40_000_000;
/** Requests being loaded, decoded or waiting in the page queue; each holds a decoded page in memory. */
const MAX_PENDING_PAGES = 8;
let pendingPages = 0;

/** Share of overall progress each stage covers. */
const STAGE_SPAN: Record<PageStage, [number, number]> = {
  detecting: [0, 0.15],
  ocr: [0.15, 0.45],
  translating: [0.45, 0.6],
  cleaning: [0.6, 0.85],
  typesetting: [0.85, 1],
};

/** Public URL of a page's result.png; `revision` busts browser caches after a Studio publish. */
export const resultUrl = (id: string, revision?: number): string =>
  `/api/translate-page/${id}/result${revision ? `?rev=${revision}` : ""}`;

/** An image that couldn't be obtained (bad upload, unreachable URL); its message is shown to the client. */
export class ImageLoadError extends Error {}

/** Decodes an upload sent as base64 or a data URL; throws ImageLoadError for oversized or malformed payloads. */
export function decodeBase64Image(image: string): Buffer {
  const base64 = image.slice(image.indexOf(",") + 1);
  if (base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new ImageLoadError("image payload too large (max ~15 MB)");
  if (base64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new ImageLoadError("image must be valid base64");
  return Buffer.from(base64, "base64");
}

export interface SubmitPageOptions {
  /** Where the page came from: "upload" or the image URL. */
  source: string;
  /** Also remove sound effects. */
  cleanSfx: boolean;
  /** Re-run even when this page was translated before with the same options. */
  force: boolean;
}

export type SubmitPageResult =
  | { ok: true; job_id: string; cached: boolean }
  | { ok: false; code: 400 | 409 | 429 | 503; error: string };

/** Ends a job that failed before the pipeline started: records the error and tells progress subscribers. */
async function failJob(id: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  log.error({ err, jobId: id }, "Page job failed");
  await PageStore.update(id, { status: "error", errorMessage: message }).catch(() => {});
  translationJobs.emit(id, { type: "error", stage: "error", message, error: message });
}

/** Removes a page's pipeline files before a fresh run; its publish history (`history/`) is kept. */
async function clearPipelineFiles(id: string, keepOriginal = false): Promise<void> {
  const dir = pageDir(id);
  await mkdir(dir, { recursive: true });
  const kept = new Set(["history", ...(keepOriginal ? ["original.png"] : [])]);
  for (const entry of await readdir(dir)) {
    if (!kept.has(entry)) await rm(join(dir, entry), { recursive: true, force: true });
  }
}

/** Runs every pipeline stage for one page, recording stage state and streaming progress; failures end the job with an error event. */
async function runJob(id: string, page: Buffer, options: SubmitPageOptions): Promise<void> {
  const started = Date.now();
  const emit = (event: PageJobEvent): void => translationJobs.emit(id, event);
  const onProgress = ({ stage, message, fraction, detail }: ProgressUpdate): void => {
    const [from, to] = STAGE_SPAN[stage];
    emit({ type: detail ? "progress" : "log", stage, message, progress: Math.round((from + (to - from) * fraction) * 1000) / 1000 });
  };
  const pipeline = new PagePipeline(pageDir(id), onProgress, PageStore.repository(id));
  let current: StageName = "detect";
  // What each stage cost, kept so the run can report its own total at the end
  const costs: Usage[] = [];
  /** Runs a stage under the probe and says what it took; the stage's own work is unchanged. */
  const measure = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    const probe = startProbe();
    try {
      return await run();
    } finally {
      const usage = probe.stop();
      costs.push(usage);
      log.info({ jobId: id, stage: name, ...usageFields(usage) }, `${name} · ${describeUsage(usage)}`);
    }
  };
  const stage = async (name: StageName, run: () => Promise<unknown>): Promise<void> => {
    current = name;
    await measure(name, run);
    await PageStore.setStage(id, name, "fresh");
  };

  try {
    await PageStore.update(id, { status: "running", cleanSfx: options.cleanSfx, errorMessage: null });
    await PageStore.clearStages(id);
    const { job } = await measure("detect", () => pipeline.detect(page, options.source));
    await PageStore.setStage(id, "detect", "fresh");
    await stage("ocr", () => pipeline.ocr(job, engines.ocr));
    await stage("translate", () => pipeline.translate(job, engines));
    await stage("clean_text", () => pipeline.clean(job, "text"));
    if (options.cleanSfx) await stage("clean_sfx", () => pipeline.clean(job, "sfx"));
    await stage("render", () => pipeline.render(job));
    await PageStore.update(id, { status: "done" });

    const result = Buffer.from(await Bun.file(pipeline.path("result.png")).arrayBuffer()).toString("base64");
    emit({ type: "done", stage: "done", message: "Translation complete", progress: 1, result, result_url: resultUrl(id), elapsed_ms: Date.now() - started });
    const total = totalUsage(costs);
    log.info({ jobId: id, stage: "total", ...usageFields(total) }, `Page translated · ${describeUsage(total)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, jobId: id, stage: current }, "Page translation failed");
    await PageStore.setStage(id, current, "error", message).catch(() => {});
    await PageStore.update(id, { status: "error", errorMessage: message }).catch(() => {});
    emit({ type: "error", stage: "error", message, error: message });
  }
}

/**
 * Queues the pipeline for a page whose job slot is already reserved: marks it queued, then runs under the page lock
 * and the global queue. Returns once it's queued; `done` resolves when the run has finished (used by batch runs).
 * Releases the pending-page slot when the run ends.
 */
async function startRun(id: string, page: Buffer, options: SubmitPageOptions, keepOriginal = false): Promise<{ done: Promise<void> }> {
  translationJobs.emit(id, { type: "log", stage: "queued", message: "Queued for translation", progress: 0 });
  // Mark the page queued first, so Studio mutations that start from now on are refused
  await PageStore.update(id, { status: "queued", errorMessage: null });
  // Page lock before the global queue (the same order as Studio runs): a Studio edit, run or publish already
  // holding the lock finishes before this run clears the page's files, stages and blocks
  const done = withPageLock(id, async () => {
    try {
      await clearPipelineFiles(id, keepOriginal);
    } catch (err) {
      await failJob(id, err);
      return;
    }
    await runExclusiveResult(() => runJob(id, page, options));
  })
    // runJob reports pipeline errors itself; anything that escapes still has to end the job for its subscribers
    .catch((err: unknown) => failJob(id, err))
    .finally(() => {
      pendingPages--;
    });
  return { done };
}

/**
 * Runs the pipeline again for a page that already has its original stored (an imported chapter page, or "run again"
 * in the Studio). Unlike {@link submitPageJob} it never looks a page up by image hash, so chapter pages keep their
 * own job. `done` resolves when the run has finished.
 */
export async function runStoredPage(id: string, options: SubmitPageOptions): Promise<
  { ok: true; job_id: string; done: Promise<void> } | { ok: false; code: 400 | 404 | 409 | 429 | 503; error: string }
> {
  const notReady = enginesNotReady();
  if (notReady) return { ok: false, code: 503, error: notReady };
  const missing = missingPipelineModels();
  if (missing.length > 0) {
    return { ok: false, code: 503, error: `Page translation models missing (${missing.join(", ")}) — set TEXT_SEG_MODEL_ENABLED and INPAINT_MODEL_ENABLED so they download at boot` };
  }
  const row = await PageStore.findById(id);
  if (!row) return { ok: false, code: 404, error: "page not found" };
  const original = join(pageDir(id), "original.png");
  if (!existsSync(original)) return { ok: false, code: 400, error: "this page has no stored original to run again" };

  const live = translationJobs.get(id);
  if (live && (live.status === "queued" || live.status === "running")) {
    return { ok: false, code: 409, error: "this page is already being translated" };
  }
  if (pendingPages >= MAX_PENDING_PAGES) return { ok: false, code: 429, error: "Too many pages waiting for translation — try again shortly" };
  pendingPages++;
  let queued = false;
  // Reserved before any await: a second rerun of this page now sees a live job and is refused, instead of both
  // reading the original and queueing the same work twice
  translationJobs.create(id, options.cleanSfx);
  try {
    // The stored status is what Studio edits check, so it has to say "queued" before the read as well: an edit
    // saved during the read would be rebuilt away by the run that follows
    await PageStore.update(id, { status: "queued", errorMessage: null });
    const page = Buffer.from(await Bun.file(original).arrayBuffer());
    // The stored original is this page's only copy (imported pages): it stays while the run rebuilds the rest
    const { done } = await startRun(id, page, options, true);
    queued = true;
    return { ok: true, job_id: id, done };
  } catch (err) {
    // Never leave the reserved job "queued": it would make every later request for this page wait on it
    await failJob(id, err);
    throw err;
  } finally {
    if (!queued) pendingPages--;
  }
}

/**
 * Admits one page: checks models and capacity, loads and decodes the image, then replays a cached result
 * or queues a pipeline run. `load` runs only after capacity is reserved, so slow downloads count against it.
 * Progress is streamed on GET /api/translate-page/:id/events.
 */
export async function submitPageJob(load: () => Promise<Buffer>, options: SubmitPageOptions): Promise<SubmitPageResult> {
  const notReady = enginesNotReady();
  if (notReady) return { ok: false, code: 503, error: notReady };
  const missing = missingPipelineModels();
  if (missing.length > 0) {
    return { ok: false, code: 503, error: `Page translation models missing (${missing.join(", ")}) — set TEXT_SEG_MODEL_ENABLED and INPAINT_MODEL_ENABLED so they download at boot` };
  }

  // Reserve capacity before loading so queued jobs can't pile up decoded pages in memory
  if (pendingPages >= MAX_PENDING_PAGES) return { ok: false, code: 429, error: "Too many pages waiting for translation — try again shortly" };
  pendingPages++;
  let queued = false;
  try {
    let page: Buffer;
    try {
      const input = await load();
      // Loaders cap their own reads; this keeps any loader from handing sharp an oversized buffer
      if (input.byteLength > MAX_IMAGE_BYTES) throw new ImageLoadError("image too large (max 15 MB)");
      page = await normalisePage(sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })).png().toBuffer();
    } catch (err) {
      return { ok: false, code: 400, error: err instanceof ImageLoadError ? err.message : "image could not be decoded" };
    }

    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(page);
    const { page: row } = await PageStore.findOrCreate(hasher.digest("hex"), options.source);
    const id = row.id;

    // Check and reserve with no await in between, so concurrent requests for one page share a single job
    const live = translationJobs.get(id);
    if (live && (live.status === "queued" || live.status === "running")) {
      // One job directory per page: a run with other options can only start after this one ends
      if (live.cleanSfx !== options.cleanSfx) return { ok: false, code: 409, error: "This page is already being translated with different options — try again when it finishes" };
      return { ok: true, job_id: id, cached: false };
    }
    translationJobs.create(id, options.cleanSfx);

    try {
      // Same page already translated with the same options: replay the stored result (including Studio edits)
      const resultPath = join(pageDir(id), "result.png");
      if (!options.force && row.status === "done" && row.cleanSfx === options.cleanSfx && existsSync(resultPath)) {
        const result = Buffer.from(await Bun.file(resultPath).arrayBuffer()).toString("base64");
        translationJobs.emit(id, { type: "done", stage: "done", message: "Loaded previous translation", progress: 1, result, result_url: resultUrl(id, row.revision), elapsed_ms: 0 });
        return { ok: true, job_id: id, cached: true };
      }

      await startRun(id, page, options);
      queued = true;
      return { ok: true, job_id: id, cached: false };
    } catch (err) {
      // Never leave the reserved job "queued": it would make every later request for this page wait on it
      const message = err instanceof Error ? err.message : String(err);
      await PageStore.update(id, { status: "error", errorMessage: message }).catch(() => {});
      translationJobs.emit(id, { type: "error", stage: "error", message, error: message });
      throw err;
    }
  } finally {
    if (!queued) pendingPages--;
  }
}
