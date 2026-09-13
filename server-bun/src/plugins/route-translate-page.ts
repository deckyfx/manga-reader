/**
 * Full-page translation for the browser extension, backed by the shared page pipeline.
 *
 * POST /api/translate-page             { image, clean_sfx?, force? } → 202 { job_id, cached }
 * GET  /api/translate-page/:id/events  SSE: every event replayed from the start, then live (see PageJobEvent)
 * GET  /api/translate-page/:id/live    SSE: page-updated when the page is published from the Studio (see PageLiveEvent)
 * GET  /api/translate-page/:id         status snapshot
 * GET  /api/translate-page/:id/result  result.png
 *
 * The job id is the Studio page id. Stage images stay in data/jobs/<id>/; blocks and stage state are in SQLite.
 */
import Elysia, { t } from "elysia";
import sharp from "sharp";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { childLogger } from "@/lib/logger";
import { ErrBody } from "@/lib/schemas";
import { runExclusive } from "@/queue/page-queue";
import { enginesNotReady, pageEngines as engines } from "@/services/page-engines";
import { pageDir, PageStore, type StageName } from "@/stores/page-store";
import { pageLive } from "@/stores/page-live-channel";
import { translationJobs, type PageJobEvent } from "@/stores/translation-job-store";
import {
  missingPipelineModels,
  PagePipeline,
  type PageStage,
  type ProgressUpdate,
} from "@/services/page-pipeline";

const log = childLogger("translate-page");

/** ~15 MB decoded. */
const MAX_BASE64_LENGTH = 20 * 1024 * 1024;
/** Up to MAX_PENDING_PAGES decodes run at once, each ~4 bytes per pixel raw. 40 MP still fits a 5000×8000 scan. */
const MAX_INPUT_PIXELS = 40_000_000;
/** Comment sent on idle live streams so proxies and the browser keep the connection open. */
const KEEPALIVE_MS = 25_000;

/** Share of overall progress each stage covers. */
const STAGE_SPAN: Record<PageStage, [number, number]> = {
  detecting: [0, 0.15],
  ocr: [0.15, 0.45],
  translating: [0.45, 0.6],
  cleaning: [0.6, 0.85],
  typesetting: [0.85, 1],
};

const IdParams = t.Object({ id: t.String({ pattern: "^[A-Za-z0-9-]+$" }) });

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/** Public URL of a page's result.png; `revision` busts browser caches after a Studio publish. */
export const resultUrl = (id: string, revision?: number): string =>
  `/api/translate-page/${id}/result${revision ? `?rev=${revision}` : ""}`;

/** Requests being decoded or waiting in the page queue; each holds a decoded page in memory. */
const MAX_PENDING_PAGES = 8;
let pendingPages = 0;

/** Runs every pipeline stage for one page, recording stage state and streaming progress; failures end the job with an error event. */
async function runJob(id: string, page: Buffer, cleanSfx: boolean): Promise<void> {
  const started = Date.now();
  const emit = (event: PageJobEvent): void => translationJobs.emit(id, event);
  const onProgress = ({ stage, message, fraction, detail }: ProgressUpdate): void => {
    const [from, to] = STAGE_SPAN[stage];
    emit({ type: detail ? "progress" : "log", stage, message, progress: Math.round((from + (to - from) * fraction) * 1000) / 1000 });
  };
  const pipeline = new PagePipeline(pageDir(id), onProgress, PageStore.repository(id));
  let current: StageName = "detect";
  const stage = async (name: StageName, run: () => Promise<unknown>): Promise<void> => {
    current = name;
    await run();
    await PageStore.setStage(id, name, "fresh");
  };

  try {
    await PageStore.update(id, { status: "running", cleanSfx, errorMessage: null });
    await PageStore.clearStages(id);
    const { job } = await pipeline.detect(page, "upload");
    await PageStore.setStage(id, "detect", "fresh");
    await stage("ocr", () => pipeline.ocr(job, engines.ocr));
    await stage("translate", () => pipeline.translate(job, engines.translate));
    await stage("clean_text", () => pipeline.clean(job, "text"));
    if (cleanSfx) await stage("clean_sfx", () => pipeline.clean(job, "sfx"));
    await stage("render", () => pipeline.render(job));
    await PageStore.update(id, { status: "done" });

    const result = Buffer.from(await Bun.file(pipeline.path("result.png")).arrayBuffer()).toString("base64");
    emit({ type: "done", stage: "done", message: "Translation complete", progress: 1, result, result_url: resultUrl(id), elapsed_ms: Date.now() - started });
    log.info({ jobId: id, ms: Date.now() - started }, "Page translated");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, jobId: id, stage: current }, "Page translation failed");
    await PageStore.setStage(id, current, "error", message).catch(() => {});
    await PageStore.update(id, { status: "error", errorMessage: message }).catch(() => {});
    emit({ type: "error", stage: "error", message, error: message });
  }
}

export const routeTranslatePage = new Elysia()
  .post(
    "/api/translate-page",
    async ({ body, status }) => {
      const notReady = enginesNotReady();
      if (notReady) return status(503, { error: notReady });
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
        const { page: row } = await PageStore.findOrCreate(hasher.digest("hex"), "upload");
        const id = row.id;
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
          // Same page already translated with the same options: replay the stored result (including Studio edits)
          const resultPath = join(pageDir(id), "result.png");
          if (!body.force && row.status === "done" && row.cleanSfx === cleanSfx && existsSync(resultPath)) {
            const result = Buffer.from(await Bun.file(resultPath).arrayBuffer()).toString("base64");
            translationJobs.emit(id, { type: "done", stage: "done", message: "Loaded previous translation", progress: 1, result, result_url: resultUrl(id, row.revision), elapsed_ms: 0 });
            return status(202, { job_id: id, cached: true });
          }

          translationJobs.emit(id, { type: "log", stage: "queued", message: "Queued for translation", progress: 0 });
          await rm(pageDir(id), { recursive: true, force: true });
          await mkdir(pageDir(id), { recursive: true });
          await PageStore.update(id, { status: "queued", errorMessage: null });
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
          await PageStore.update(id, { status: "error", errorMessage: message }).catch(() => {});
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
      const row = await PageStore.findById(params.id);
      if (!row) return status(404, { error: "not found" });
      const done = row.status === "done" && existsSync(join(pageDir(row.id), "result.png"));
      return {
        job_id: row.id,
        status: done ? "done" : row.status === "error" ? "error" : "unknown",
        stage: done ? "done" : row.status,
        progress: done ? 1 : 0,
        error: row.errorMessage,
        result_url: done ? resultUrl(row.id, row.revision) : null,
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
      const file = Bun.file(join(pageDir(params.id), "result.png"));
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
      return new Response(stream, { headers: SSE_HEADERS });
    },
    { params: IdParams },
  )

  .get(
    "/api/translate-page/:id/live",
    async ({ params, status }) => {
      if (!(await PageStore.findById(params.id))) return status(404, { error: "page not found" });
      const encoder = new TextEncoder();
      let stop = (): void => {};
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (chunk: string): void => {
            try {
              controller.enqueue(encoder.encode(chunk));
            } catch {
              stop();
            }
          };
          const unsubscribe = pageLive.subscribe(params.id, (event) => send(`data: ${JSON.stringify(event)}\n\n`));
          const keepalive = setInterval(() => send(": keepalive\n\n"), KEEPALIVE_MS);
          stop = () => {
            clearInterval(keepalive);
            unsubscribe();
          };
          send(": connected\n\n");
        },
        cancel() {
          stop();
        },
      });
      return new Response(stream, { headers: SSE_HEADERS });
    },
    { params: IdParams },
  );
