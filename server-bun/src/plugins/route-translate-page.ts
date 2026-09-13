/**
 * Full-page translation for the browser extension, backed by the shared page pipeline.
 *
 * POST /api/translate-page             { image, clean_sfx?, force? } → 202 { job_id, cached }
 * GET  /api/translate-page/:id/events  SSE: every event replayed from the start, then live (see PageJobEvent)
 * GET  /api/translate-page/:id         status snapshot
 * GET  /api/translate-page/:id/result  result.png
 *
 * Stage files stay in data/jobs/<id>/ (original, mask, crops, clean-text, patches, result) for review in the Studio.
 */
import Elysia, { t } from "elysia";
import sharp from "sharp";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { bootState } from "@/boot-state";
import { childLogger } from "@/lib/logger";
import { ErrBody } from "@/lib/schemas";
import { inferenceQueue } from "@/queue/inference-queue";
import { JobStore } from "@/stores/job-store";
import { translationJobs, type PageJobEvent } from "@/stores/translation-job-store";
import {
  missingPipelineModels,
  PagePipeline,
  type PageJob,
  type PageStage,
  type PipelineEngines,
  type ProgressUpdate,
} from "@/services/page-pipeline";

const log = childLogger("translate-page");

const DATA_DIR = "./data/jobs";
/** ~15 MB decoded. */
const MAX_BASE64_LENGTH = 20 * 1024 * 1024;
/** Up to MAX_PENDING_PAGES decodes run at once, each ~4 bytes per pixel raw. 40 MP still fits a 5000×8000 scan. */
const MAX_INPUT_PIXELS = 40_000_000;

/** Share of overall progress each stage covers. */
const STAGE_SPAN: Record<PageStage, [number, number]> = {
  detecting: [0, 0.15],
  ocr: [0.15, 0.45],
  translating: [0.45, 0.6],
  cleaning: [0.6, 0.85],
  typesetting: [0.85, 1],
};

const IdParams = t.Object({ id: t.String({ pattern: "^[A-Za-z0-9-]+$" }) });

const resultUrl = (id: string): string => `/api/translate-page/${id}/result`;

/** OCR and translation go through the inference queue so page jobs don't race single bubble requests. */
const engines: PipelineEngines = {
  ocr: async (image) => (await inferenceQueue.enqueue<{ imageBuffer: Buffer }, { text: string }>("ocr", { imageBuffer: image })).text,
  translate: async (text) => {
    const out = await inferenceQueue.enqueue<{ text: string }, { translatedText: string; engine: string }>("translate", { text });
    return { text: out.translatedText, engine: out.engine };
  },
};

/** Page jobs run one at a time: every stage is CPU-bound and shares the same models. */
let pageQueue: Promise<void> = Promise.resolve();
function runExclusive(task: () => Promise<void>): void {
  pageQueue = pageQueue.then(task, task);
}

/** Requests being decoded or waiting in `pageQueue`; each holds a decoded page in memory. */
const MAX_PENDING_PAGES = 8;
let pendingPages = 0;

/** Options a finished job was produced with, so a cached result is only reused for the same options. */
const OPTIONS_FILE = "options.json";
interface PageJobOptions {
  clean_sfx: boolean;
}

async function readJobOptions(dir: string): Promise<PageJobOptions | null> {
  const file = Bun.file(join(dir, OPTIONS_FILE));
  return (await file.exists()) ? ((await file.json()) as PageJobOptions) : null;
}

/** Record the page's text blocks for the Studio portal. */
async function persistBlocks(id: string, job: PageJob): Promise<void> {
  const textBlocks = job.blocks.filter((b) => b.kind === "text");
  await JobStore.deleteAllBubbles(id);
  for (const b of textBlocks) {
    await JobStore.insertBubble({
      jobId: id,
      bubbleIndex: b.id,
      x: b.x,
      y: b.y,
      width: b.w,
      height: b.h,
      rotation: 0,
      sourceText: b.source_text,
      translatedText: b.translated_text,
      patchImagePath: b.render ? `patches/${b.id}.png` : null,
    });
  }
  await JobStore.update(id, {
    totalBubbles: textBlocks.length,
    processedBubbles: textBlocks.length,
    textSegBlocks: JSON.stringify(job.blocks.map((b) => ({
      id: String(b.id),
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      source_text: b.source_text,
      translated_text: b.translated_text,
    }))),
  });
}

async function runJob(id: string, page: Buffer, cleanSfx: boolean): Promise<void> {
  const started = Date.now();
  const emit = (event: PageJobEvent): void => translationJobs.emit(id, event);
  const onProgress = ({ stage, message, fraction, detail }: ProgressUpdate): void => {
    const [from, to] = STAGE_SPAN[stage];
    emit({ type: detail ? "progress" : "log", stage, message, progress: Math.round((from + (to - from) * fraction) * 1000) / 1000 });
  };
  const pipeline = new PagePipeline(join(DATA_DIR, id), onProgress);

  try {
    await JobStore.setStatus(id, "processing");
    const { job } = await pipeline.detect(page, "upload");
    await pipeline.ocr(job, engines.ocr);
    await pipeline.translate(job, engines.translate);
    await pipeline.clean(job, "text");
    if (cleanSfx) await pipeline.clean(job, "sfx");
    await pipeline.render(job);
    await Bun.write(pipeline.path(OPTIONS_FILE), JSON.stringify({ clean_sfx: cleanSfx } satisfies PageJobOptions));
    await persistBlocks(id, job);
    await JobStore.setStatus(id, "done");

    const result = Buffer.from(await Bun.file(pipeline.path("result.png")).arrayBuffer()).toString("base64");
    emit({ type: "done", stage: "done", message: "Translation complete", progress: 1, result, result_url: resultUrl(id), elapsed_ms: Date.now() - started });
    log.info({ jobId: id, ms: Date.now() - started }, "Page translated");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, jobId: id }, "Page translation failed");
    await JobStore.setStatus(id, "error", message).catch(() => {});
    emit({ type: "error", stage: "error", message, error: message });
  }
}

/** DB row for this page: reuses the row of a page seen before (its files are regenerated). */
async function jobIdForImage(imageHash: string): Promise<{ id: string; previousStatus: string | null }> {
  const existing = await JobStore.findByImageHash(imageHash);
  if (existing) return { id: existing.id, previousStatus: existing.status };
  try {
    const row = await JobStore.insert({ imageHash, sourcePath: "upload", status: "queued", inpaintEnabled: true, bubbleEnabled: true });
    return { id: row.id, previousStatus: null };
  } catch {
    // Unique constraint: a concurrent request just inserted this page
    const raced = await JobStore.findByImageHash(imageHash);
    if (!raced) throw new Error("failed to create job");
    return { id: raced.id, previousStatus: raced.status };
  }
}

export const routeTranslatePage = new Elysia()
  .post(
    "/api/translate-page",
    async ({ body, status }) => {
      if (!bootState.ocrReady || !bootState.translateReady) return status(503, { error: "Server not ready — models still loading" });
      const missing = missingPipelineModels();
      if (missing.length > 0) {
        return status(503, { error: `Page translation models missing (${missing.join(", ")}) — set TEXT_SEG_MODEL_ENABLED and INPAINT_MODEL_ENABLED so they download at boot` });
      }

      const base64 = body.image.slice(body.image.indexOf(",") + 1);
      if (base64.length > MAX_BASE64_LENGTH) return status(400, { error: "image payload too large (max ~15 MB)" });
      if (base64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return status(400, { error: "image must be valid base64" });

      // Reserve capacity before decoding so queued jobs can't pile up decoded pages in memory
      if (pendingPages >= MAX_PENDING_PAGES) return status(429, { error: "Too many pages waiting for translation — try again shortly" });
      pendingPages++;
      let queued = false;
      try {
        let page: Buffer;
        try {
          page = await sharp(Buffer.from(base64, "base64"), { limitInputPixels: MAX_INPUT_PIXELS }).png().toBuffer();
        } catch {
          return status(400, { error: "image could not be decoded" });
        }

        const hasher = new Bun.CryptoHasher("sha256");
        hasher.update(page);
        const { id, previousStatus } = await jobIdForImage(hasher.digest("hex"));
        const cleanSfx = body.clean_sfx ?? false;

        // Check and reserve with no await in between, so concurrent requests for one page share a single job
        const live = translationJobs.get(id);
        if (live && (live.status === "queued" || live.status === "running")) {
          // One job directory per page: a run with other options can only start after this one ends
          if (live.cleanSfx !== cleanSfx) return status(409, { error: "This page is already being translated with different options — try again when it finishes" });
          return status(202, { job_id: id, cached: false });
        }
        translationJobs.create(id, cleanSfx);

        try {
          // Same page already translated with the same options: replay the stored result
          const dir = join(DATA_DIR, id);
          const resultPath = join(dir, "result.png");
          if (!body.force && previousStatus === "done" && existsSync(resultPath) && (await readJobOptions(dir))?.clean_sfx === cleanSfx) {
            const result = Buffer.from(await Bun.file(resultPath).arrayBuffer()).toString("base64");
            translationJobs.emit(id, { type: "done", stage: "done", message: "Loaded previous translation", progress: 1, result, result_url: resultUrl(id), elapsed_ms: 0 });
            return status(202, { job_id: id, cached: true });
          }

          translationJobs.emit(id, { type: "log", stage: "queued", message: "Queued for translation", progress: 0 });
          await rm(dir, { recursive: true, force: true });
          await mkdir(dir, { recursive: true });
          await JobStore.update(id, { status: "queued", errorMessage: null });
          runExclusive(async () => {
            try {
              await runJob(id, page, cleanSfx);
            } finally {
              pendingPages--;
            }
          });
          queued = true;
          return status(202, { job_id: id, cached: false });
        } catch (err) {
          // Never leave the reserved job "queued": it would make every later request for this page wait on it
          const message = err instanceof Error ? err.message : String(err);
          await JobStore.setStatus(id, "error", message).catch(() => {});
          translationJobs.emit(id, { type: "error", stage: "error", message, error: message });
          throw err;
        }
      } finally {
        if (!queued) pendingPages--;
      }
    },
    {
      body: t.Object({
        image: t.String(),
        /** Also remove sound effects (can soften detailed artwork). */
        clean_sfx: t.Optional(t.Boolean()),
        /** Re-run even when this page was translated before. */
        force: t.Optional(t.Boolean()),
      }),
      response: {
        202: t.Object({ job_id: t.String(), cached: t.Boolean() }),
        400: ErrBody,
        409: ErrBody,
        429: ErrBody,
        503: ErrBody,
      },
    },
  )

  .get(
    "/api/translate-page/:id",
    async ({ params, status }) => {
      const live = translationJobs.get(params.id);
      if (live) {
        return {
          job_id: live.id,
          status: live.status,
          stage: live.stage,
          progress: live.progress,
          error: live.error,
          result_url: live.status === "done" ? resultUrl(live.id) : null,
        };
      }
      const row = await JobStore.findById(params.id);
      if (!row) return status(404, { error: "not found" });
      const done = row.status === "done" && existsSync(join(DATA_DIR, row.id, "result.png"));
      return {
        job_id: row.id,
        status: done ? "done" : row.status === "error" ? "error" : "unknown",
        stage: done ? "done" : row.status,
        progress: done ? 1 : 0,
        error: row.errorMessage,
        result_url: done ? resultUrl(row.id) : null,
      };
    },
    {
      params: IdParams,
      response: {
        200: t.Object({
          job_id: t.String(),
          status: t.String(),
          stage: t.String(),
          progress: t.Number(),
          error: t.Nullable(t.String()),
          result_url: t.Nullable(t.String()),
        }),
        404: ErrBody,
      },
    },
  )

  .get(
    "/api/translate-page/:id/result",
    async ({ params, status, set }) => {
      const file = Bun.file(join(DATA_DIR, params.id, "result.png"));
      if (!(await file.exists())) return status(404, { error: "result not found" });
      set.headers["Cache-Control"] = "no-cache";
      return file;
    },
    { params: IdParams },
  )

  .get(
    "/api/translate-page/:id/events",
    ({ params, status }) => {
      if (!translationJobs.get(params.id)) return status(404, { error: "job not found or expired" });
      const encoder = new TextEncoder();
      let unsubscribe = (): void => {};
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          unsubscribe = translationJobs.subscribe(params.id, (event) => {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              if (event.type === "done" || event.type === "error") controller.close();
            } catch {
              // Client already disconnected
            }
          });
        },
        cancel() {
          unsubscribe();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    },
    { params: IdParams },
  );
