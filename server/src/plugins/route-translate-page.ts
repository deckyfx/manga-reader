/**
 * Full-page translation for the browser extension, backed by the shared page jobs (see services/page-jobs.ts).
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
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ErrBody } from "@/lib/schemas";
import { decodeBase64Image, ImageLoadError, resultUrl, submitPageJob } from "@/services/page-jobs";
import { pageDir, PageStore } from "@/stores/page-store";
import { pageLive, type PageLiveEvent } from "@/stores/page-live-channel";
import { translationJobs } from "@/stores/translation-job-store";

/** Comment sent on idle live streams so proxies and the browser keep the connection open. */
const KEEPALIVE_MS = 25_000;

const IdParams = t.Object({ id: t.String({ pattern: "^[A-Za-z0-9-]+$" }) });

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export const routeTranslatePage = new Elysia()
  .post(
    "/api/translate-page",
    async ({ body, status }) => {
      let bytes: Buffer;
      try {
        bytes = decodeBase64Image(body.image);
      } catch (err) {
        return status(400, { error: err instanceof ImageLoadError ? err.message : "image must be valid base64" });
      }
      const result = await submitPageJob(async () => bytes, { source: "upload", cleanSfx: body.clean_sfx ?? false, force: body.force ?? false });
      if (result.ok) return status(202, { job_id: result.job_id, cached: result.cached });
      switch (result.code) {
        case 400: return status(400, { error: result.error });
        case 409: return status(409, { error: result.error });
        case 429: return status(429, { error: result.error });
        case 503: return status(503, { error: result.error });
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
        async start(controller) {
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
          // Catch-up: a publish between the tab swapping its image and connecting here would otherwise be missed.
          // Subscribed first, so nothing falls in between; a publish meanwhile only repeats the same revision, which the tab ignores.
          const current = await PageStore.findById(params.id).catch(() => undefined);
          if (current && current.revision > 0) {
            const event: PageLiveEvent = { type: "page-updated", page_id: current.id, revision: current.revision, result_url: resultUrl(current.id, current.revision) };
            send(`data: ${JSON.stringify(event)}\n\n`);
          }
        },
        cancel() {
          stop();
        },
      });
      return new Response(stream, { headers: SSE_HEADERS });
    },
    { params: IdParams },
  );
